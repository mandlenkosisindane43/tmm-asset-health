#!/usr/bin/env python3
"""TMM Asset Health: OEM/device JSON -> validated central telemetry hub.

Reads newline-delimited JSON from stdin (one machine observation per line).
Set TMM_INGEST_URL and TMM_INGEST_TOKEN in your environment. Never commit tokens.
A manufacturer-specific adapter should transform its authorised API response into
the common observation format before sending it here.
"""
import json
import os
import sys
import urllib.error
import urllib.request

FIELDS = {"company_id","machine_id","source","recorded_at","engine_hours",
          "working_hours","idle_hours","fuel_litres","hydraulic_pressure_bar",
          "hydraulic_oil_temp_c","coolant_temp_c","payload_tonnes","latitude",
          "longitude","fault_code","fault_description","severity"}

def send(observation):
    url = os.environ.get("TMM_INGEST_URL", "").strip()
    token = os.environ.get("TMM_INGEST_TOKEN", "").strip()
    if not url.startswith("https://") or not token:
        raise RuntimeError("Set HTTPS TMM_INGEST_URL and TMM_INGEST_TOKEN first")
    if not isinstance(observation, dict):
        raise ValueError("Expected a JSON object")
    unknown = set(observation) - FIELDS
    if unknown:
        raise ValueError("Unsupported fields: " + ", ".join(sorted(unknown)))
    body = json.dumps(observation, separators=(",", ":")).encode("utf-8")
    request = urllib.request.Request(url, data=body, method="POST", headers={
        "Authorization": "Bearer " + token,
        "Content-Type": "application/json",
        "User-Agent": "TMM-Asset-Health-Python-Relay/1.0"
    })
    with urllib.request.urlopen(request, timeout=20) as response:
        return json.load(response)

def main():
    for number, line in enumerate(sys.stdin, 1):
        if not line.strip():
            continue
        try:
            result = send(json.loads(line))
            print(json.dumps({"line": number, "result": result}), flush=True)
        except (ValueError, RuntimeError, urllib.error.URLError) as exc:
            print(json.dumps({"line": number, "error": str(exc)}), file=sys.stderr)
            return 1
    return 0

if __name__ == "__main__":
    sys.exit(main())
