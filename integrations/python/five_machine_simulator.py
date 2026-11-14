#!/usr/bin/env python3
"""Five-machine central-pot simulation. Python 3; no third-party packages.

Run from the repository root:
  python3 integrations/python/five_machine_simulator.py
prints five canonical telemetry observations without sending them anywhere.
  python3 integrations/python/five_machine_simulator.py --watch
prints an initial batch and new batches every 900 seconds until Ctrl+C.
Pipe output into tmm_telemetry_bridge.py --dry-run to validate, or the configured
bridge to transfer to an isolated staging connection. Never remove test_data.
This process must stay running; it does not install a server-side scheduler.
"""

import argparse
import json
import sys
import time
from datetime import datetime, timezone

FLEET = (
    ("SIM-ADT-001", "ADT", 4250.0),
    ("SIM-GRADER-001", "GRADER", 3180.0),
    ("SIM-FEL-001", "FEL", 5670.0),
    ("SIM-TLB-001", "TLB", 1890.0),
    ("SIM-EXCAVATOR-001", "EXCAVATOR", 6320.0),
)


def observations(at, started_at):
    """Return deterministic per-slot records; repeated slots retain event identity.

    All engines run in this initial scenario. Meter increases reflect elapsed
    time, not the number of HTTP requests. Faults are automatically introduced
    in slot 1, repeated in slot 2, absent in slot 3, and recur in slot 5.
    Restarting the producer starts a new scenario; this is not a lifetime meter.
    """
    if at.tzinfo is None or started_at.tzinfo is None or at < started_at:
        raise ValueError("Timezone-aware, chronological timestamps required")
    slot = int((at - started_at).total_seconds() // 900)
    elapsed_hours = slot / 4
    stamp = datetime.fromtimestamp(started_at.timestamp() + slot * 900, timezone.utc)
    stamp_text = stamp.isoformat().replace("+00:00", "Z")
    rows = []
    for index, (external_id, machine_type, base_meter) in enumerate(FLEET):
        row = {
            "test_data": True,
            "event_id": f"{external_id}:{stamp_text}",
            "external_machine_id": external_id,
            "timestamp": stamp_text,
            "asset": {
                "serial_number": external_id + "-SERIAL",
                "manufacturer": "SIMULATED manufacturer",
                "model": "SIMULATED " + machine_type,
                "machine_type": machine_type,
            },
            "engine_hours": base_meter + elapsed_hours,
            "ignition_status": "ON",
            "rpm": 1200 + index * 100,
            "coolant_temperature": 80 + index,
            "engine_oil_pressure": 350 + index * 10,
            "fuel_level": max(0, 85 - index * 4 - elapsed_hours * 2),
            "units": {"engine_hours": "h", "rpm": "rpm",
                      "coolant_temperature": "degC", "engine_oil_pressure": "kPa",
                      "fuel_level": "%"},
            "fault_codes": [],
        }
        if slot % 4 in (1, 2):
            # Documented SPN/FMI examples; no assertion of a real OEM connection.
            row["fault_codes"] = [{"spn": 110 if index % 2 == 0 else 102,
                                   "fmi": 3 if index % 2 == 0 else 4}]
        rows.append(row)
    return rows


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--watch", action="store_true", help="Emit every 15 minutes until stopped")
    args = parser.parse_args()
    started_at = datetime.now(timezone.utc)
    try:
        while True:
            for row in observations(datetime.now(timezone.utc), started_at):
                print(json.dumps(row), flush=True)
            if not args.watch:
                return
            # Wait until the next scenario boundary without cumulative drift.
            elapsed = time.time() - started_at.timestamp()
            time.sleep(max(0.1, (int(elapsed // 900) + 1) * 900 - elapsed))
    except (KeyboardInterrupt, BrokenPipeError):
        return


if __name__ == "__main__":
    main()
