# Live Python pipeline viewer

Run inside the repository's Codespace terminal (Python 3.10+ and Node 24+):

```sh
python3 integrations/python/tmm_live_viewer.py
```

Open port **8001** using **Open in Browser**, or the Codespaces **Ports** tab.
Keep the forwarded port **Private**. The old static report server on port 8000
can remain running in another terminal.

The source begins automatically after 12 seconds and sends six labelled synthetic
readings over roughly one minute. There are no Capture, Analyse or Generate Report
buttons. Leave the terminal running to keep the viewer and background pipeline alive.
If you open the page after the run finishes, press Ctrl+C in the terminal and start
the command again for a fresh demonstration.

## What to inspect

- **Machine source:** Python-generated records with unfamiliar field names.
- **Transfer pipeline:** mapping, durable SQLite outbox, HTTP acknowledgement,
  deliberate first-transfer HTTP 503 and automatic retry, duplicate replay.
- **Central pot:** actual accepted records in the disposable SQLite TMM database.
- **Fault analysis:** actual TMM analysis receipts, SPN 110 FMI 0 and an unknown code
  explicitly requiring an OEM definition.
- **Saved reports:** actual daily/weekly/monthly JSON documents, automatically updated
  by the existing two-second local test scheduler.
- **Reading journey:** follows each stable event ID across storage, analysis and report coverage.

Tabs inspect records; they do not start processing. Polling only reads current state.
Processing continues without an open viewer page while the Python process runs.
The animated emphasis accompanies observed events; counters and tables use actual state.

At completion, checks verify six unique readings, six analysis receipts, three reports
covering all six readings, automatic retry, duplicate prevention, expected synthetic
KPIs, unchanged fleet meter and no external deliveries.

```sh
python3 integrations/python/tmm_live_viewer.py --self-test
```

The fast headless check also verifies that the viewer HTTP endpoint returns completed
state. Use --port 8002 if 8001 is already occupied; --interval and --start-delay
control presentation pacing.

## Boundaries

Python runs the viewer, simulated source, adapter and transfer queue. The existing
JavaScript/TypeScript TMM backend performs intake, analysis and reporting, using
tools/python_demo_host.mjs. The application is not rewritten in Python.

Recorded timestamps cover a synthetic half-hour; delivery is accelerated playback.
Expected values are 90% availability, 77.78% utilisation, 50 tonnes and 1000.4 h.
These are demonstration values, not a real machine's performance. One source, one
mapped machine and selected metrics are exercised; real company APIs, device
acquisition, external email and confirmed root causes remain untested.

No cloud credentials are read, no network destination is user-supplied, and no staging
or production data is accessed or deleted. The viewer and local backend bind to
127.0.0.1. Only synthetic evidence is exposed by the viewer; the backend's throwaway
test token stays inside the Python process. Local queues and central storage are
disposable when stopped. Download /evidence.json to retain a particular run.
