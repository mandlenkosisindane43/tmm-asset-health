#!/usr/bin/env python3
"""TMM Asset Health: read-only OEM/device telemetry forwarder (STAGING).

No machinery commands are sent. No credentials are embedded.
Requires a registered connection and external-machine-to-fleet mapping.
Usage:
  export TMM_TELEMETRY_URL='https://tmm-asset-health-light-staging.mandlenkosisindane43.workers.dev/api/telemetry/v2'
  export TMM_TELEMETRY_SOURCE='<source key from OEM Connections>'
  export TMM_TELEMETRY_TOKEN='<connection token>'
  python3 tools/telemetry_pipeline.py --file readings.jsonl --dry-run
  python3 tools/telemetry_pipeline.py --file readings.jsonl --send
  python3 tools/telemetry_pipeline.py --simulate --machine-id TEST-001 --dry-run
  python3 tools/telemetry_pipeline.py --simulate --machine-id TEST-001 --send

JSONL input: one JSON object per line. Use external_machine_id and recorded_at.
Only authorised test equipment or data should be transmitted.
"""
import argparse
import datetime as dt
import json
import os
import sys
import time
import urllib.error
import urllib.request

DEFAULT_URL = "https://tmm-asset-health-light-staging.mandlenkosisindane43.workers.dev/api/telemetry/v2"
ALLOWED_FIELDS = {
    "event_id", "external_machine_id", "recorded_at", "engine_hours", "test_data",
    "ignition_status", "latitude", "longitude", "fuel_level", "odometer",
    "hydraulic_pressure", "hydraulic_oil_level", "engine_oil_pressure",
    "coolant_temperature", "rpm", "engine_load", "fault_code", "fault_codes",
}
MAX_BATCH = 50


def load_jsonl(path):
    with open(path, encoding="utf-8") as source:
        for line_no, line in enumerate(source, 1):
            if not line.strip():
                continue
            try:
                reading = json.loads(line)
            except json.JSONDecodeError as exc:
                raise ValueError(f"Invalid JSON at line {line_no}: {exc}") from exc
            if not isinstance(reading, dict):
                raise ValueError(f"Line {line_no} must be a JSON object")
            yield reading


def normalize(reading):
    # Never invent missing measurements or infer a breakdown from a fault code.
    item = {k: v for k, v in reading.items() if k in ALLOWED_FIELDS and v is not None}
    if not item.get("external_machine_id") or not item.get("recorded_at"):
        raise ValueError("Each reading needs external_machine_id and recorded_at")
    return item


def simulated(machine):
    now = dt.datetime.now(dt.timezone.utc).isoformat().replace("+00:00", "Z")
    return {
        "test_data": True,
        "event_id": f"SIMULATED-{machine}-{int(time.time())}",
        "external_machine_id": machine,
        "recorded_at": now,
        "engine_hours": 1200.5,
        "ignition_status": "on",
        "fuel_level": 65,
        "hydraulic_pressure": 175,
        "coolant_temperature": 86,
        "rpm": 1350,
    }


def send_batch(url, source, token, batch):
    payload = json.dumps(batch).encode("utf-8")
    request = urllib.request.Request(
        url,
        data=payload,
        method="POST",
        headers={
            "Content-Type": "application/json",
            "Authorization": f"Bearer {token}",
            "x-telemetry-source": source,
            "User-Agent": "TMMAssetHealth-PythonTelemetry/1.0",
        },
    )
    try:
        with urllib.request.urlopen(request, timeout=20) as response:
            result = json.load(response)
    except urllib.error.HTTPError as exc:
        body = exc.read(2000).decode("utf-8", "replace")
        raise RuntimeError(f"Telemetry API HTTP {exc.code}: {body}") from exc
    except urllib.error.URLError as exc:
        raise RuntimeError(f"Telemetry API unreachable: {exc.reason}") from exc
    print(json.dumps(result, indent=2))
    failures = [r for r in result.get("results", []) if r.get("status") not in ("accepted", "duplicate")]
    if failures:
        raise RuntimeError(f"{len(failures)} reading(s) rejected/quarantined; check machine mapping and timestamps")


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    mode = parser.add_mutually_exclusive_group(required=True)
    mode.add_argument("--file", help="JSONL file of authorised OEM/device readings")
    mode.add_argument("--simulate", action="store_true", help="Generate ONE clearly simulated reading")
    action = parser.add_mutually_exclusive_group(required=True)
    action.add_argument("--dry-run", action="store_true", help="Validate and print without transmitting")
    action.add_argument("--send", action="store_true", help="Transmit readings to staging API")
    parser.add_argument("--machine-id", help="External machine ID for --simulate")
    args = parser.parse_args()
    if args.simulate and not args.machine_id:
        parser.error("--simulate requires --machine-id")
    records = [normalize(simulated(args.machine_id))] if args.simulate else [normalize(r) for r in load_jsonl(args.file)]
    if not records:
        parser.error("No readings supplied")
    if args.dry_run:
        print("DRY RUN ONLY - NO DATA SENT")
        print(json.dumps(records[:3], indent=2))
        print(f"Validated {len(records)} reading(s)")
        return
    url = os.environ.get("TMM_TELEMETRY_URL", DEFAULT_URL)
    if not url.startswith("https://") or "/api/telemetry/v2" not in url:
        parser.error("TMM_TELEMETRY_URL must be the HTTPS telemetry v2 endpoint")
    source = os.environ.get("TMM_TELEMETRY_SOURCE", "")
    token = os.environ.get("TMM_TELEMETRY_TOKEN", "")
    if not source or not token:
        parser.error("Set TMM_TELEMETRY_SOURCE and TMM_TELEMETRY_TOKEN environment variables")
    for start in range(0, len(records), MAX_BATCH):
        send_batch(url, source, token, records[start:start + MAX_BATCH])


if __name__ == "__main__":
    try:
        main()
    except (OSError, ValueError, RuntimeError) as exc:
        print(f"ERROR: {exc}", file=sys.stderr)
        sys.exit(1)
