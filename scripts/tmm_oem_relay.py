#!/usr/bin/env python3
"""Compatibility entry point for the durable telemetry v2 bridge.

Configure TMM_TELEMETRY_ENDPOINT, TMM_TELEMETRY_SOURCE and TMM_TELEMETRY_TOKEN.
Old TMM_INGEST_URL/TMM_SOURCE_KEY/TMM_INGEST_TOKEN names are also accepted.
A registered, company-scoped connection replaces the obsolete shared token.
Reads continuous authorised JSON observations from stdin by default.
"""
import importlib.util
import os
from pathlib import Path

for target, old in (("TMM_TELEMETRY_ENDPOINT", "TMM_INGEST_URL"),
                    ("TMM_TELEMETRY_SOURCE", "TMM_SOURCE_KEY"),
                    ("TMM_TELEMETRY_TOKEN", "TMM_INGEST_TOKEN")):
    if not os.getenv(target) and os.getenv(old):
        os.environ[target] = os.environ[old]

if __name__ == "__main__":
    spec = importlib.util.spec_from_file_location("tmm_bridge", Path(__file__).resolve().parents[1] / "integrations/python/tmm_telemetry_bridge.py")
    bridge = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(bridge)
    try:
        bridge.main()
    except (OSError, RuntimeError, ValueError) as error:
        raise SystemExit("Pipeline failed: " + str(error))
