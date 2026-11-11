#!/usr/bin/env python3
"""TMM Asset Health staging telemetry feeder (OEM v2).

Dry-run by default. Sends only when --send is supplied. No credentials in source.
Machine must already be registered and mapped in the OEM Connections screen.
"""
import argparse
import json
import os
import sys
import urllib.error
import urllib.request
from datetime import datetime, timedelta, timezone

DEFAULT_URL = "https://tmm-asset-health-light-staging.mandlenkosisindane43.workers.dev/api/telemetry/v2"

def sample(external_id: str, count: int):
    now = datetime.now(timezone.utc)
    rows = []
    for i in range(count):
        at = now - timedelta(minutes=(count - 1 - i) * 5)
        running = (i % 6) != 0
        rows.append({
            "test_data": True,
            "event_id": f"staging-demo-{external_id}-{at.strftime('%Y%m%dT%H%M%SZ')}",
            "external_machine_id": external_id,
            "recorded_at": at.isoformat().replace("+00:00", "Z"),
            "engine_hours": round(1250.0 + i * (5 / 60 if running else 0), 3),
            "ignition_status": "ON" if running else "OFF",
            "fuel_level": round(78 - i * 0.15, 2),
            "hydraulic_pressure": 170 if running else 0,
            "hydraulic_oil_level": 82.0,
            "engine_oil_pressure": 42 if running else 0,
            "coolant_temperature": 83 if running else 44,
            "rpm": 1450 if running else 0,
            "engine_load": 65 if running else 0,
        })
    return rows

def main():
    parser = argparse.ArgumentParser(description="Feed clearly labelled staging telemetry to TMM")
    parser.add_argument("--external-id", required=True, help="OEM/device ID mapped to a registered machine")
    parser.add_argument("--count", type=int, default=12, help="Readings, 1 to 100")
    parser.add_argument("--send", action="store_true", help="Actually POST; otherwise print sample JSON")
    args = parser.parse_args()
    if not 1 <= args.count <= 100:
        parser.error("--count must be between 1 and 100")
    readings = sample(args.external_id, args.count)
    if not args.send:
        print(json.dumps({"mode": "SIMULATED DRY RUN - NOT SENT", "readings": readings}, indent=2))
        return 0
    url = os.environ.get("TMM_INGEST_URL", DEFAULT_URL).strip()
    source = os.environ.get("TMM_SOURCE_KEY", "").strip()
    token = os.environ.get("TMM_INGEST_TOKEN", "").strip()
    if not url.startswith("https://") or not source or not token:
        parser.error("Set HTTPS TMM_INGEST_URL (optional), TMM_SOURCE_KEY and TMM_INGEST_TOKEN")
    if "tmm-asset-health-light-staging" not in url:
        parser.error("This simulated feeder is staging-only; refusing non-staging endpoint")
    request = urllib.request.Request(url, data=json.dumps(readings).encode(), method="POST", headers={
        "Content-Type": "application/json",
        "Authorization": "Bearer " + token,
        "x-telemetry-source": source,
        "User-Agent": "TMM-Staging-Simulator/1.0",
    })
    try:
        with urllib.request.urlopen(request, timeout=30) as response:
            result = json.load(response)
        print(json.dumps(result, indent=2))
        return 0 if result.get("ok") else 1
    except urllib.error.HTTPError as error:
        print(f"HTTP {error.code}: {error.read().decode(errors='replace')}", file=sys.stderr)
        return 1
    except urllib.error.URLError as error:
        print(f"Connection error: {error}", file=sys.stderr)
        return 1

if __name__ == "__main__":
    sys.exit(main())
