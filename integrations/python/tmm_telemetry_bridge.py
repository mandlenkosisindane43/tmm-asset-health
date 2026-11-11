"""Read-only OEM/Arduino adapter for TMM Asset Health telemetry v2.

Input: newline-delimited JSON records from an authorised upstream gateway.
Output: authenticated batches to TMM's existing /api/telemetry/v2 endpoint.
No machinery control commands, no demo data, no credentials in source code.
"""
import argparse
import contextlib
import hashlib
import json
import os
import sys
import time
import sqlite3
import urllib.error
import urllib.request

FIELDS = {
    "external_machine_id": ("external_machine_id", "machine_id", "machineId", "serial", "device_id"),
    "event_id": ("event_id", "message_id"),
    "test_data": ("test_data",),
    "fault_codes": ("fault_codes", "diagnostics", "activeFaults"),
    "battery_voltage": ("battery_voltage", "batteryVoltage"),
    "rpm": ("rpm", "engine_rpm"),
    "engine_load": ("engine_load", "engineLoad"),
    "latitude": ("latitude", "lat"),
    "longitude": ("longitude", "lon", "lng"),
    "hydraulic_temperature": ("hydraulic_temperature", "hydraulicTemperature"),
    "transmission_temperature": ("transmission_temperature", "transmissionTemperature"),
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
NUMERIC = {"engine_hours", "fuel_level", "hydraulic_pressure", "hydraulic_oil_level", "engine_oil_pressure", "coolant_temperature", "battery_voltage", "rpm", "engine_load", "latitude", "longitude", "hydraulic_temperature", "transmission_temperature"}


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
    if not out.get("external_machine_id"):
        raise ValueError("machine_id / device_id / serial required")
    if not out.get("timestamp"):
        raise ValueError("timestamp required; do not fabricate timestamps")
    if "test_data" in out and not isinstance(out["test_data"], bool):
        raise ValueError("test_data must be a boolean")
    if not out.get("event_id"):
        out["event_id"] = "bridge-" + hashlib.sha256(json.dumps(out, sort_keys=True).encode()).hexdigest()
    return out


def send(endpoint, source, token, readings):
    payload = json.dumps(readings).encode("utf-8")
    req = urllib.request.Request(
        endpoint, data=payload, method="POST",
        headers={"Content-Type": "application/json", "x-telemetry-source": source,
                 "Authorization": "Bearer " + token},
    )
    with urllib.request.urlopen(req, timeout=20) as response:
        result = json.loads(response.read().decode("utf-8"))
        results = result.get("results", [])
        if len(results) != len(readings) or any(r.get("status") not in ("accepted", "duplicate") for r in results):
            raise RuntimeError("Telemetry intake did not accept every reading: " + json.dumps(results))
        return result


class Outbox:
    """Persist before transfer and remove only after a positive intake receipt."""
    def __init__(self, path):
        self.db = sqlite3.connect(path)
        self.db.execute("CREATE TABLE IF NOT EXISTS pending(event_id TEXT PRIMARY KEY,payload TEXT NOT NULL)")
        self.db.commit()

    def enqueue(self, reading):
        payload = json.dumps(reading, sort_keys=True)
        existing = self.db.execute("SELECT payload FROM pending WHERE event_id=?", (reading["event_id"],)).fetchone()
        if existing and existing[0] != payload:
            raise ValueError("Event ID reused with a different queued payload")
        self.db.execute("INSERT OR IGNORE INTO pending VALUES(?,?)", (reading["event_id"], payload))
        self.db.commit()

    def flush(self, endpoint, source, token, retry_limit=5, delay=time.sleep):
        sent = 0
        for event_id, payload in self.db.execute("SELECT event_id,payload FROM pending ORDER BY rowid").fetchall():
            for attempt in range(retry_limit + 1):
                try:
                    send(endpoint, source, token, [json.loads(payload)])
                    break
                except urllib.error.URLError as error:
                    if isinstance(error, urllib.error.HTTPError) and error.code < 500 and error.code != 429:
                        raise
                    if attempt == retry_limit:
                        raise
                    delay(min(30, 2 ** attempt))
            # A crash before this commit replays the same stable event ID safely.
            self.db.execute("DELETE FROM pending WHERE event_id=?", (event_id,))
            self.db.commit()
            sent += 1
        return sent

    def close(self):
        self.db.close()


def main():
    parser = argparse.ArgumentParser(description="Forward authorised OEM readings to TMM")
    parser.add_argument("file", nargs="?", default="-", help="NDJSON file exported by authorised OEM/Arduino gateway")
    parser.add_argument("--dry-run", action="store_true", help="Validate and display normalized records without sending")
    parser.add_argument("--spool", default=os.getenv("TMM_TELEMETRY_SPOOL", "tmm-telemetry-outbox.sqlite3"), help="Durable local queue, replayed automatically on startup")
    parser.add_argument("--retry-limit", type=int, default=5, help="Automatic network retries per observation")
    args = parser.parse_args()
    endpoint = os.getenv("TMM_TELEMETRY_ENDPOINT", "").strip()
    source = os.getenv("TMM_TELEMETRY_SOURCE", "").strip()
    token = os.getenv("TMM_TELEMETRY_TOKEN", "").strip()
    if not args.dry_run and (not endpoint.startswith("https://") or not source or not token):
        parser.error("Set TMM_TELEMETRY_ENDPOINT (https), TMM_TELEMETRY_SOURCE and TMM_TELEMETRY_TOKEN")
    if args.retry_limit < 0:
        parser.error("--retry-limit must be non-negative")
    outbox = None if args.dry_run else Outbox(args.spool)
    count = 0
    try:
        if outbox:
            count += outbox.flush(endpoint, source, token, args.retry_limit)
        with (open(args.file, encoding="utf-8") if args.file != "-" else contextlib.nullcontext(sys.stdin)) as stream:
            for lineno, line in enumerate(stream, 1):
                if not line.strip():
                    continue
                try:
                    reading = normalize(json.loads(line))
                except (ValueError, TypeError) as exc:
                    raise SystemExit("Invalid record on line %s: %s" % (lineno, exc))
                if args.dry_run:
                    print(json.dumps(reading))
                    count += 1
                    continue
                outbox.enqueue(reading)
                count += outbox.flush(endpoint, source, token, args.retry_limit)
                print(json.dumps({"accepted_or_duplicate": count}), flush=True)
    finally:
        if outbox:
            outbox.close()
    print("Validated" if args.dry_run else "Submitted", count, "readings")


if __name__ == "__main__":
    try:
        main()
    except (OSError, RuntimeError, urllib.error.URLError) as exc:
        print("Pipeline failed:", exc, file=sys.stderr)
        sys.exit(1)
