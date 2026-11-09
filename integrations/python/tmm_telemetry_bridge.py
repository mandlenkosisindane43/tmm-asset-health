"""Read-only OEM/Arduino adapter for TMM Asset Health telemetry v2.

Input: newline-delimited JSON records from an authorised upstream gateway.
Output: authenticated batches to TMM's existing /api/telemetry/v2 endpoint.
No machinery control commands, no demo data, no credentials in source code.
"""
import argparse
import json
import os
import sys
import time
import urllib.error
import urllib.request

FIELDS = {
    "machine_id": ("machine_id", "machineId", "serial", "device_id"),
    "timestamp": ("timestamp", "recorded_at", "time"),
    "engine_hours": ("engine_hours", "engineHours", "hour_meter"),
    "ignition_status": ("ignition_status", "ignition"),
    "fuel_level": ("fuel_level", "fuel_percent"),
    "hydraulic_pressure": ("hydraulic_pressure",),
    "hydraulic_oil_level": ("hydraulic_oil_level",),
    "engine_oil_pressure": ("engine_oil_pressure",),
    "coolant_temperature": ("coolant_temperature", "coolant_c"),
    "fault_code": ("fault_code", "diagnostic_code"),
}
NUMERIC = {"engine_hours", "fuel_level", "hydraulic_pressure", "hydraulic_oil_level", "engine_oil_pressure", "coolant_temperature"}


def normalize(record):
    if not isinstance(record, dict):
        raise ValueError("Each reading must be a JSON object")
    out = {}
    for key, aliases in FIELDS.items():
        value = next((record[a] for a in aliases if a in record and record[a] is not None), None)
        if value is not None:
            if key in NUMERIC:
                value = float(value)
                if not -1e12 < value < 1e12:
                    raise ValueError("Out-of-range numeric field: " + key)
            out[key] = value
    if not out.get("machine_id"):
        raise ValueError("machine_id / device_id / serial required")
    if not out.get("timestamp"):
        raise ValueError("timestamp required; do not fabricate timestamps")
    return out


def send(endpoint, source, token, readings):
    payload = json.dumps({"readings": readings}).encode("utf-8")
    req = urllib.request.Request(
        endpoint, data=payload, method="POST",
        headers={"Content-Type": "application/json", "x-telemetry-source": source,
                 "Authorization": "Bearer " + token},
    )
    with urllib.request.urlopen(req, timeout=20) as response:
        return json.loads(response.read().decode("utf-8"))


def main():
    parser = argparse.ArgumentParser(description="Forward authorised OEM readings to TMM")
    parser.add_argument("file", help="NDJSON file exported by authorised OEM/Arduino gateway")
    parser.add_argument("--dry-run", action="store_true", help="Validate and display normalized records without sending")
    args = parser.parse_args()
    endpoint = os.getenv("TMM_TELEMETRY_ENDPOINT", "").strip()
    source = os.getenv("TMM_TELEMETRY_SOURCE", "").strip()
    token = os.getenv("TMM_TELEMETRY_TOKEN", "").strip()
    if not args.dry_run and (not endpoint.startswith("https://") or not source or not token):
        parser.error("Set TMM_TELEMETRY_ENDPOINT (https), TMM_TELEMETRY_SOURCE and TMM_TELEMETRY_TOKEN")
    batch = []
    count = 0
    with open(args.file, encoding="utf-8") as stream:
        for lineno, line in enumerate(stream, 1):
            if not line.strip():
                continue
            try:
                reading = normalize(json.loads(line))
            except (ValueError, TypeError) as exc:
                raise SystemExit("Invalid record on line %s: %s" % (lineno, exc))
            if args.dry_run:
                print(json.dumps(reading))
                continue
            batch.append(reading)
            if len(batch) == 100:
                print(json.dumps(send(endpoint, source, token, batch)))
                count += len(batch)
                batch.clear()
    if batch:
        print(json.dumps(send(endpoint, source, token, batch)))
        count += len(batch)
    print("Validated" if args.dry_run else "Submitted", count if not args.dry_run else "all", "readings")


if __name__ == "__main__":
    try:
        main()
    except (OSError, urllib.error.URLError) as exc:
        print("Pipeline failed:", exc, file=sys.stderr)
        sys.exit(1)
