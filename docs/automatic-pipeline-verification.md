# Automatic telemetry pipeline — isolated light staging

## Implemented flow

The existing Cloudflare scheduled handler runs every 15 minutes while the dashboard is closed:

1. The opted-in staging simulator submits a labelled observation through the authenticated `/api/telemetry/v2` intake.
2. Intake validates credentials, fleet mapping, timestamps and numeric measurements; invalid observations enter quarantine.
3. Valid observations enter central D1 storage with stable ingestion identities. Accepted replays are deduplicated; failed attempts can recover without duplicating a stored reading.
4. The condition analyser interprets supported J1939 references and records conservative findings. Unknown and proprietary identifiers remain explicitly unmapped.
5. Daily, weekly and monthly rolling summaries and their complete report documents are saved in D1. Report documents include observation windows, counts, stored diagnostic findings and verification recommendations.

Viewing a page is not required for collection, analysis or report generation. Navigation only reads the resulting records. Report, analysis and pipeline status pages refresh automatically every minute. The dashboard Reports destination opens saved automatic reports.

## Connected pages

- `/telemetry/connections/pipeline-status`: company-isolated intake, storage, analysis, scheduler freshness and report evidence. Append `?format=json` for machine-readable status.
- `/telemetry/connections/automatic-analysis`: stored condition findings.
- `/telemetry/connections/scheduled-reports`: automatically generated reports.
- `/telemetry/connections/report-document?id=<snapshot ID>`: saved report with diagnostic findings; append `&format=json` for its saved JSON.
- `/telemetry/connections/diagnostic-library`: lookup of supported diagnostic references.
- `/telemetry`: real telemetry monitoring. Simulated data is excluded from live fleet calculations and monitoring queries.

## Python transfer

`integrations/python/tmm_telemetry_bridge.py` accepts a file or continuous newline-delimited JSON on standard input. It preserves SPN/FMI arrays, simulation labels and stable event IDs. A SQLite outbox persists each observation before sending; temporary network errors retry automatically. An observation leaves the queue only after an accepted/duplicate intake receipt. Pending records are replayed when the bridge restarts.

Configure `TMM_TELEMETRY_ENDPOINT`, `TMM_TELEMETRY_SOURCE` and `TMM_TELEMETRY_TOKEN` once for the registered connection. Never commit credentials. Use a separate `--spool` path for each endpoint/connection. Run the bridge under the gateway's service manager for unattended startup and restart. The bridge itself does not install a machine driver, collect a raw CAN frame, or provision a system service.

## Verification commands

```sh
node --test tests/automatic-telemetry.test.mjs
python3 -m unittest discover -s tests -p test_telemetry_bridge.py
npx vinext build
```

The integration suite executes the actual TypeScript intake, storage, analyser, report writer and authenticated pages against SQLite. Only the unrelated legacy router fallback is replaced. A local HTTP server also receives records from the actual Python bridge. Assertions cover fresh databases, structured J1939 codes, unknown codes, numeric rejection, quarantine replay, event conflicts, deduplication, recovery before/after storage, scheduler replay, simulator disablement, saved reports, company/machine separation and exclusion of simulation from live fleet metrics. Python tests cover stable identities, automatic network retry and durable recovery after restart.

The existing dashboard analytics suite has three baseline failures, reproduced unchanged at starting commit `8cc4c4a`: empty-chart wording, dashboard action expectations and machine-history wording. These are separate from the telemetry suite. Repository-wide TypeScript diagnostics also predate this work, including missing Cloudflare binding types; a successful bundle is not a clean TypeScript check.

## Scope and remaining checks

- These tests verify a simulated software flow, not an attached machine or a live OEM network.
- Staging's clock-triggered execution and saved records must also be observed after deploying this commit. A local test is not deployment evidence.
- The simulator remains explicitly enabled per staging company; existing SAS ADT 027 demo enrollment respects a saved disabled setting. It is not enabled for arbitrary customer equipment.
- Current staging analysis/reporting selects at most ten simulated machines per scheduled run and screens each machine's latest fifty readings. This pilot limit is not a fleet-scale throughput guarantee. Report documents include up to 200 stored findings and disclose truncation.
- Reference definitions currently map SPN 110 and the explicitly listed FMI descriptions. This is not a complete CAT/Volvo/Komatsu diagnostic database or confirmed root-cause diagnosis.
- Real-data collection, live-provider retries, OEM-approved thresholds, device credentials and real-data automatic engineering reports require separate connection validation before production use.
- Reports are saved internally; this change does not email them or create maintenance work orders.
- Real fleets and production bindings are not used by the isolated light-staging deployment workflow.

## Deployment

The existing isolated light-staging GitHub workflow now runs automatically on relevant pushes to `design/modern-light-contractor-dashboard`. It gates deployment on the telemetry tests and build and retains its dedicated D1/R2 binding checks. No application button starts this process.
