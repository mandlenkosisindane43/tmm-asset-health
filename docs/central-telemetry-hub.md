# TMM Asset Health — Central Telemetry Hub (isolated light staging)

For the current live/simulation architecture, see [Automatic operation](automatic-operation.md). For the earlier automatic v2 flow and test evidence, see [Automatic pipeline verification](automatic-pipeline-verification.md). The v1 endpoint and setup below describe the earlier relay.

## What is implemented
- A company-isolated machine-monitoring page: `/contractor?view=machine-monitoring`.
- A central intake API: `POST /api/telemetry/ingest`, protected by `TMM_INGEST_TOKEN`.
- An append-only D1 telemetry store with deduplication by company, machine, source, timestamp and fault code.
- A Python standard-library relay accepting newline-delimited JSON from OEM adapters or a sensor gateway.
- A machine selector, real readings, fault/event history, a JavaScript canvas chart and a printable report.

**No OEM API is connected yet.** No CAT data, oil readings, GPS or production figures should be shown until a real authorised source supplies them.

## Staging setup (one time)
1. In Cloudflare D1, select **tmm-asset-health-light-staging-db**, not production.
2. Run the SQL statements from `migrations/light-staging-telemetry-v1.sql` in the D1 console, or use `wrangler d1 execute tmm-asset-health-light-staging-db --remote --config wrangler.light-staging.jsonc --file migrations/light-staging-telemetry-v1.sql`.
3. Set a **secret** named `TMM_INGEST_TOKEN` for the staging Worker using Cloudflare Settings → Variables and Secrets. Generate a long random value and never put it in source control. Do not use the owner password.
4. Deploy the staging workflow `.github/workflows/deploy-light-staging.yml`.
5. Configure your Python relay locally:
   - `TMM_INGEST_URL=https://tmm-asset-health-light-staging.mandlenkosisindane43.workers.dev/api/telemetry/ingest`
   - `TMM_INGEST_TOKEN=<same staging secret>`
6. Send actual authorised observations, one JSON object per line, to `python scripts/tmm_oem_relay.py`.

## Common data contract
Each observation must have:
- `company_id`: numeric company ID in the staging database.
- `machine_id`: stable fleet number / equipment ID.
- `source`: e.g. `cat-authorised-api`, `arduino-gateway` or `other-oem`.
- `recorded_at`: timestamp with timezone, ISO 8601.

Optional numeric fields: `engine_hours`, `working_hours`, `idle_hours`, `fuel_litres`, `hydraulic_pressure_bar`, `hydraulic_oil_temp_c`, `coolant_temp_c`, `payload_tonnes`, `latitude`, `longitude`.

Optional event fields: `fault_code`, `fault_description`, `severity` (`info`, `warning`, `critical`).

For a **local contract test only**, an example shape (not a real machine reading) is:
```json
{"company_id":1,"machine_id":"TEST-01","source":"test-adapter","recorded_at":"2026-11-09T12:00:00Z","engine_hours":1200.5,"working_hours":7.5,"idle_hours":1.0,"hydraulic_oil_temp_c":61.2,"fault_code":"EXAMPLE-001","fault_description":"Synthetic test event","severity":"info"}
```
Do not mix synthetic test events into customer reports. Use an isolated test company.

## Next engineering phases
- Connect a real OEM's documented, authorised API, or an Arduino gateway with appropriate industrial electrical isolation and sensor calibration.
- Normalise manufacturer-specific diagnostic codes against manufacturer-specific definitions. Never assume a code means the same thing across brands.
- Implement event-state tracking for verified breakdown start/end and true downtime; faults alone do not establish downtime.
- Compute daily, weekly and monthly aggregates with timestamp quality checks and separate engine hours from productive hours.
- Introduce per-company/per-device ingestion credentials, rotation, replay protection, rate limiting and audit logs before production.
- Add fleet metadata mapping, alerts and production-ready reporting.

**Safety:** No modifications to machine ECU, CAN wiring or OEM safety systems are implied by this software. Obtain OEM/site authorisation for machine data acquisition.
