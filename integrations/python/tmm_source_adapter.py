"""Configuration-only source translation. No network access, credentials or machine commands.

Use through tmm_telemetry_bridge.py --mapping CONFIG.json --dry-run INPUT.ndjson.
Paths traverse JSON objects with dot-separated keys; no expressions are evaluated.
"""
import json
import math
from datetime import datetime, timezone
from pathlib import Path

TARGETS = set("external_machine_id event_id timestamp engine_hours ignition_status fuel_level hydraulic_pressure hydraulic_oil_level engine_oil_pressure coolant_temperature battery_voltage rpm engine_load latitude longitude hydraulic_temperature transmission_temperature idle_hours production_tonnes fuel_litres odometer scheduled_hours available_hours productive_hours fault_code serial_number manufacturer model machine_type next_service_hours service_interval_hours last_service_hours service_reference".split())
TARGETS.update("asset." + k for k in "serial_number manufacturer model machine_type next_service_hours service_interval_hours last_service_hours service_reference".split())
REQUIRED = {"external_machine_id", "timestamp"}


def get_path(record, path):
    value = record
    for key in path.split("."):
        if not isinstance(value, dict) or key not in value:
            return None
        value = value[key]
    return value


def finite_number(value):
    if isinstance(value, bool) or not isinstance(value, (str, float, int)):
        raise ValueError("Expected a numeric measurement")
    result = float(value)
    if not math.isfinite(result):
        raise ValueError("Measurement must be finite")
    return result


class SourceAdapter:
    def __init__(self, config):
        if not isinstance(config, dict) or (type(config.get("version")) is not int or config.get("version") != 1):
            raise ValueError("Mapping version must be 1")
        if set(config) - {"version", "name", "fields", "faults", "test_data"}:
            raise ValueError("Unknown mapping setting")
        self.fields = config.get("fields")
        if not isinstance(self.fields, dict) or not REQUIRED.issubset(self.fields):
            raise ValueError("Map external_machine_id and timestamp explicitly")
        if set(self.fields) - TARGETS:
            raise ValueError("Mapping includes an unsupported target field")
        self.rules = {}
        for target, rule in self.fields.items():
            rule = {"path": rule} if isinstance(rule, str) else rule
            if not isinstance(rule, dict) or set(rule) - {"path", "type", "scale", "offset", "unit", "counter_semantics", "required"}:
                raise ValueError("Invalid field mapping: " + target)
            if not isinstance(rule.get("path"), str) or not rule["path"] or any(not k for k in rule["path"].split(".")):
                raise ValueError("A source object path is required: " + target)
            kind = rule.get("type", "text")
            if kind not in ("text", "number", "iso8601", "unix_seconds", "unix_milliseconds"):
                raise ValueError("Unsupported conversion type: " + target)
            if target == "timestamp" and kind not in {"iso8601", "unix_seconds", "unix_milliseconds"}:
                raise ValueError("Timestamp mapping requires an explicit time format")
            if target in {"external_machine_id", "event_id"} and kind != "text":
                raise ValueError("Identity fields require text; preserve leading zeroes")
            if ("scale" in rule or "offset" in rule) and kind != "number":
                raise ValueError("Scale and offset require numeric conversion")
            for key in ("scale", "offset"):
                if key in rule:
                    finite_number(rule[key])
            if "unit" in rule and (kind != "number" or not isinstance(rule["unit"], str) or not rule["unit"].strip()):
                raise ValueError("Units require a numeric field and unit name")
            if "counter_semantics" in rule and (kind != "number" or rule["counter_semantics"] not in ("cumulative", "instantaneous", "increment")):
                raise ValueError("Invalid counter semantics")
            if "required" in rule and not isinstance(rule["required"], bool):
                raise ValueError("required must be a boolean")
            self.rules[target] = dict(rule)
        self.faults = config.get("faults", {})
        if not isinstance(self.faults, dict) or set(self.faults) - {"spn_path", "fmi_path", "codes_path"}:
            raise ValueError("Invalid fault mapping")
        if bool(self.faults.get("spn_path")) != bool(self.faults.get("fmi_path")):
            raise ValueError("Configure both SPN and FMI paths")
        if any(not isinstance(v, str) or not v for v in self.faults.values()):
            raise ValueError("Fault paths must be nonempty strings")
        if "test_data" in config and not isinstance(config["test_data"], bool):
            raise ValueError("test_data must be a boolean")
        self.test_data = config.get("test_data")

    @classmethod
    def from_file(cls, path):
        return cls(json.loads(Path(path).read_text(encoding="utf-8")))

    def translate(self, record):
        if not isinstance(record, dict):
            raise ValueError("Source reading must be a JSON object")
        if "test_data" in record and not isinstance(record["test_data"], bool):
            raise ValueError("Source test_data must be a boolean")
        out = {}
        for target, rule in self.rules.items():
            value = get_path(record, rule["path"])
            if value is None or value == "":
                if target in REQUIRED or rule.get("required"):
                    raise ValueError("Required source field missing: " + target)
                continue
            kind = rule.get("type", "text")
            try:
                if kind == "number":
                    value = finite_number(value) * finite_number(rule.get("scale", 1)) + finite_number(rule.get("offset", 0))
                    if not math.isfinite(value):
                        raise ValueError("Converted measurement is not finite")
                elif kind in {"unix_seconds", "unix_milliseconds", "iso8601"}:
                    if kind == "iso8601":
                        if not isinstance(value, str):
                            raise ValueError("Expected an ISO timestamp string")
                        stamp = datetime.fromisoformat(value.replace("Z", "+00:00"))
                        if stamp.tzinfo is None:
                            raise ValueError("Timestamp requires a timezone; do not guess site time")
                    else:
                        stamp = datetime.fromtimestamp(finite_number(value) / (1000 if kind == "unix_milliseconds" else 1), timezone.utc)
                    value = stamp.astimezone(timezone.utc).isoformat(timespec="milliseconds").replace("+00:00", "Z")
                elif not isinstance(value, (str, int)) or isinstance(value, bool):
                    raise ValueError("Expected a text identifier")
                else:
                    value = str(value).strip()
                    if not value:
                        raise ValueError("Identifier is blank")
            except (ValueError, OverflowError, OSError) as error:
                raise ValueError("Invalid source field: " + target + " (" + str(error) + ")") from error
            if target.startswith("asset."):
                out.setdefault("asset", {})[target.split(".", 1)[1]] = value
            else:
                out[target] = value
            if "unit" in rule:
                out.setdefault("units", {})[target] = rule["unit"]
            if "counter_semantics" in rule:
                out.setdefault("counter_semantics", {})[target] = rule["counter_semantics"]
        faults = []
        if "spn_path" in self.faults:
            spn, fmi = (get_path(record, self.faults[k]) for k in ("spn_path", "fmi_path"))
            if spn is not None or fmi is not None:
                spn, fmi = finite_number(spn), finite_number(fmi)
                if not spn.is_integer() or not fmi.is_integer() or not 0 <= spn <= 524287 or not 0 <= fmi <= 31:
                    raise ValueError("Invalid SPN/FMI pair")
                faults.append({"spn": int(spn), "fmi": int(fmi)})
        if "codes_path" in self.faults:
            codes = get_path(record, self.faults["codes_path"])
            if codes is not None:
                codes = codes if isinstance(codes, list) else [codes]
                for code in codes:
                    if not isinstance(code, str) or not code.strip():
                        raise ValueError("Vendor fault identifiers must be nonempty strings")
                    faults.append(code.strip())  # Preserve unknown identifiers; do not invent definitions.
        if len(faults) > 50:
            raise ValueError("At most 50 fault identifiers per observation")
        if self.faults:
            out["fault_codes"] = faults
        if self.test_data is not None or "test_data" in record:
            out["test_data"] = self.test_data is True or record.get("test_data") is True
        return out
