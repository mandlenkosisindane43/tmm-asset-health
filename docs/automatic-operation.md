# TMM automatic operation

## Routine flow

One scheduled TypeScript engine, `worker/telemetry-automation.ts`, now processes authorised live readings and explicitly labelled simulation readings through the same workflow:

`provider/device → scoped authenticated intake → central D1 storage → durable analysis receipts → findings and configured-limit alerts → saved report documents → configured delivery queue`

The existing Cloudflare schedule runs every 15 minutes without an open dashboard. This staging scheduler now delegates only to the central telemetry engine, rather than running the old missing-manual-daily-report scans. `TMM_AUTOMATIC_MODE=true` in the isolated staging configuration also suppresses legacy manual-report reminders following administrative writes. The parallel legacy telemetry-email dispatcher is retired; its status link opens the authenticated delivery audit. Known historical admin-test and explicitly marked simulation readings are labelled as simulation during the one-time storage migration. Intake aliases `/api/telemetry/v2`, `/api/telemetry` and `/api/telemetry/ingest` all enter the same intake and require the registered connection's source key and bearer token. The company is taken from the authenticated connection, never trusted from the submitted company ID.

## Manual setup and confirmation

Administrators still register companies, users, machines, sites and source-to-fleet mappings. They configure service thresholds, notification recipients and approved sensor limits once. Engineers still record recommendations and confirm maintenance work, repairs, root cause and breakdown downtime. These facts are not fabricated from a fault observation.

Routine operation does not require Capture, Analyse, Refresh or Generate Report buttons. The default contractor dashboard, daily, production, maintenance, alerts, machine-monitoring and reports dashboard destinations now open the central automatic monitoring workspace. Machine Health and Machine History use the same data. Fleet registration, account management, engineer recommendations and explicit historical/manual maintenance records remain available.

## Data and calculations

- Live and simulation remain separate in analysis, snapshots, dashboards and delivery. Simulation never queues external messages.
- Engine runtime uses chronologically valid meter intervals, rejects decreasing meters and implausible increases, and discloses coverage. It is not productive time or confirmed availability.
- Production and idle totals require explicit cumulative-counter semantics. The bridge preserves these declarations. Missing unsupported counters remain unavailable.
- Service forecasts use the latest received meter and registered service threshold, not an invented meter.
- Pressure screening requires a reported running engine; every configured sensor rule requires matching source units and a recorded OEM/site reference. Unknown units create a review finding instead of a guessed operational alarm.
- Supported parameter references now include SPNs 92, 94, 100, 101, 102, 105, 108, 109, 110, 111, 158, 168, 174, 175, 183, 190, 247 and 250. FMI descriptions remain generic. Proprietary and unknown identifiers automatically say that a definition is required; this is not a complete OEM service library.

Reference sources (parameter identities, not universal alarm limits or repair instructions):

- [DEIF engine-communication parameter table](https://documentation.deif.com/r/ie-150-agc-150-engine-communication-4189341302-uk/description-of-engine-communication/other/analogue-readings-pgn-and-spn)
- [DEIF AGC 200 Designer's Reference Handbook](https://www.deif.com/media/aq3aiwp0/agc-200-drh-4189340609o-uk.pdf?v=6)

## Reports and delivery

Daily, weekly and monthly rolling monitoring documents are saved in D1, including sensor observations, measured metrics, fault findings, recommendations, backlog and truncation indicators. They are not certified calendar-period production returns. Opening a document reads the stored report.

At `/telemetry/connections/automation`, a company administrator configures recipients, enables delivery and sets the South African report hour. Daily reports queue once each day after that hour, weekly reports on Mondays and monthly reports on the first day. Fresh live fault notifications are deduplicated by machine, rule, severity and day. Historical observations do not create fresh-condition notifications.

The delivery outbox persists a fixed message payload and provider idempotency key before sending. Leases protect concurrent dispatchers. Temporary network/provider errors retry automatically. A provider-accepted request followed by a database failure reuses the same key. Permanent errors and exhausted or ambiguous retries are visible for review, not falsely labelled sent. Configuration and simulation never assert successful external delivery.

The deployed Worker must have `RESEND_API_KEY`, a verified sender domain and appropriate `ALERT_FROM_EMAIL`; set `TMM_APP_ORIGIN` to the deployed app origin when moving beyond this staging environment. Actual inbox delivery has not been tested by the software suite. Only explicit company recipients are used; no addresses are guessed. Removing a recipient or disabling delivery cancels their pending jobs.

Provider retry behavior follows [Resend's idempotency documentation](https://resend.com/changelog/idempotency-keys). Provider acceptance is recorded separately from inbox receipt. Retries stop before the provider's 24-hour idempotency window expires when acceptance is uncertain.

## Python gateway

Use `integrations/python/tmm_telemetry_bridge.py` for the future gateway. It reads continuous NDJSON from stdin by default, preserves structured diagnostic arrays, units and counter declarations, and persists readings in a local SQLite outbox before transfer. Start it under the gateway's service manager for unattended startup/restart. It does not itself install a CAN driver or acquire raw machine signals.

One-time environment:

```sh
export TMM_TELEMETRY_ENDPOINT='https://tmm-asset-health-light-staging.mandlenkosisindane43.workers.dev/api/telemetry/v2'
export TMM_TELEMETRY_SOURCE='<registered connection source key>'
export TMM_TELEMETRY_TOKEN='<registered connection token>'
python3 integrations/python/tmm_telemetry_bridge.py --spool /path/to/device-outbox.sqlite3
```

Give each endpoint/connection its own persistent spool. Keep credentials out of Git. The older `scripts/tmm_oem_relay.py` now delegates to this same durable bridge and accepts the older environment variable names; the old shared global token must be replaced with the scoped connection credential.

Example metadata, only when it accurately describes the source:

```json
{"units":{"coolant_temperature":"degC","engine_oil_pressure":"kPa"},"counter_semantics":{"idle_hours":"cumulative","production_tonnes":"cumulative"}}
```

## Verification

```sh
npx vinext build
node --test tests/*.test.mjs
python3 -m unittest discover -s tests -p test_telemetry_bridge.py
npx tsc worker/telemetry-automation.ts --noEmit --strict --target ES2022 --module esnext --moduleResolution bundler --skipLibCheck
```

Tests exercise actual intake, storage, the live/simulation engine, report saving, configured limits, units, tenant separation, failure recovery, concurrent delivery leases and fixed provider request identities. Provider calls are mocked; no test email is sent. A workerd/Miniflare test exercises the built application's real routes and API with isolated local D1 storage and validates rendered scripts. Local workerd uses its bundled supported compatibility date; deployed compatibility settings remain unchanged.

The old three dashboard test failures were resolved: accessible empty-state wording was corrected, and outdated expectations for manual capture/daily-history wording were aligned with the intended automatic interface. The old rendered-HTML test imported a Cloudflare bundle directly into Node and expected development-only metadata; it is replaced with a real Worker-runtime test.

## Capacity and deployment boundary

Analysis consumes up to 50 queued observations in FIFO order per scheduled invocation. Reports rotate through ten machine/source targets per invocation, rather than silently starving targets after the first ten. Dashboards expose pending analysis; larger fleets need throughput profiling before production. Reports disclose a 10,000-reading and 200-finding document limit; operational dashboard queries also disclose truncation.

The isolated staging deployment is gated on all Node tests, Python tests, the new engine's strict type check and the build. A read-only post-deployment observer waits for the normal scheduler and checks fresh analysis receipts and version-3 report documents. It does not invoke the simulator or report generation.

Actual device collection and OEM connectivity remain the final integration step. No physical machine or external notification delivery is certified by passing software tests. Browser visual QA requires an authenticated preview environment; the local preview's remote AI binding currently requires a Cloudflare login, so the built Worker route tests provide functional rather than visual browser coverage.

## Recorded staging verification — 11 November 2026

Source commit `6251791d5d4ad835a989afecd302cf543326ca6b` passed [deployment #77](https://github.com/mandlenkosisindane43/tmm-asset-health/actions/runs/42982376690). GitHub ran 60 Node tests (60 passed, zero failures), five Python tests and the new engine's strict type check, then deployed to the dedicated light-staging Worker.

At 10:02 SAST the read-only observer confirmed a normal unattended cycle had produced **1 fresh accepted intake linked to storage, 50 analysis receipts and 3 version-3 report documents**. It also found 11 stored SPN 110 FMI 0 findings with the mapped engine-coolant interpretation. The findings count is stored diagnostic evidence, not a claim that all eleven findings came from the single fresh reading. This proves a scheduled batch, not an assertion that every historical backlog item or physical machine has been validated.

The deployed sign-in page was observed loading. Authenticated routes were verified in the isolated built-Worker runtime; live authenticated visual review remains the next user check. External email-provider calls were mocked in tests, and no test email was sent. Actual machine/network collection and actual inbox delivery remain outside this verification.

## Follow-up reliability review

The review adds per-observation analysis retries with backoff, independent report retries, canonical fault grouping and replay-safe occurrence counts. Historical readings cannot overwrite the newest alert state. Intake rejects malformed numeric shapes and timestamps; reordered JSON keys retain the same observation identity while preserving the original audit payload. Reports retain the newest readings when their documented cap is reached.

The Python bridge retains permanent rejections separately and continues processing other machines; pending storage receipts retry automatically. Dashboard filters cancel stale requests, timed-out refreshes recover automatically, default dates roll forward, and source/site filters persist across navigation. Regression tests exercise these failure paths without contacting an email provider or a machine.

### Verified follow-up deployment

Source commit `8420f02880efed49858ebe7db8f991bc2b046ac9` passed [staging deployment #78](https://github.com/mandlenkosisindane43/tmm-asset-health/actions/runs/42992152371): 70 Node tests, 8 Python tests, the automation module strict type check, build and dedicated staging binding checks all passed.

At 11:16 SAST on 11 November 2026, the read-only observer confirmed **1 fresh linked reading, 1 fresh analysis receipt and 3 fresh version-3 saved report documents** from the normal scheduler. It found 12 stored mapped SPN 110 FMI 0 findings in total; that total is not attributed to the single new reading. No application buttons or manual simulator trigger were used. Real machine collection, actual inbox delivery and authenticated browser visual review remain separate checks.

## Shared interface and operational KPIs

Fleet registration and existing administrative forms use the automatic monitoring header and page style. Their authorised POST actions, import controls and scripts are preserved. Connection, diagnostic, pipeline and saved-report pages use the same shell. Registration remains one-time manual setup.

The dashboard shows machine and fleet availability and utilisation alongside runtime. Fleet percentages use the sums of covered time counters, not the arithmetic average of machine percentages. Missing coverage on any selected machine leaves the fleet KPI unavailable. Availability is available / scheduled hours × 100; utilisation is productive / available hours × 100. Saved reports additionally contain productive / scheduled hours. A zero denominator produces Unavailable.

The intake and Python bridge accept `scheduled_hours`, `available_hours` and `productive_hours` as nonnegative cumulative counters. Supply `counter_semantics` with each field declared `cumulative` and `units` with each field set to `h`. Source mappings must define available time as machine-ready time within scheduled time, and productive time within available time. Values must be chronological, monotonic and satisfy productive ≤ available ≤ scheduled ≤ elapsed time for each interval. Counter resets, missing units/semantics, gaps exceeding 24 hours and incomplete interval coverage leave the relevant KPI unavailable. These are source-reported operating KPIs over the covered observation window; fault codes and engine-off time do not confirm breakdown downtime or root cause. Engineer-confirmed downtime remains separate.

## Automatic machine discovery and site assignment

Open **Discovered machines** from the shared navigation or Fleet page. A registered connection sends its usual external machine ID and timestamp plus source identity, either flat fields or an `asset` object. Supply `serial_number`, `manufacturer`, `model` and `machine_type` when available. At least serial number, model or type is required to discover an unmapped external ID; a fault code is never treated as identity. Unsupported payloads retain the existing quarantine behavior.

Example source metadata (illustrative, not a real machine):

```json
{
  "external_machine_id": "SOURCE-EQUIPMENT-42",
  "timestamp": "2026-11-11T12:00:00Z",
  "engine_hours": 1245,
  "asset": {
    "serial_number": "EXAMPLE-SERIAL-42",
    "manufacturer": "Example manufacturer",
    "model": "Example model",
    "machine_type": "ADT",
    "next_service_hours": 1500,
    "service_reference": "Source-supplied machine service schedule"
  }
}
```

The authenticated company and connection determine ownership. Source assertions populate a discovery awaiting site. Its reading is durably retained in the intake with `discovered` status; the Python bridge recognises that acknowledgement and removes its local pending copy. This does not claim the reading has already been analysed. An administrator enters the site and saves once; registration and source mapping are created idempotently. The next normal scheduled run transfers up to 50 retained mapped readings into central telemetry before analysis and reports. Interrupted saves replay with the same ingestion identity. Inactive sources are excluded from automatic replay. Subsequent readings update the received hour meter and supplied service target automatically.

No service schedule is guessed. `next_service_hours` can be supplied directly. Alternatively provide numeric `service_interval_hours`, `last_service_hours` and a nonempty `service_reference`; due is last-service meter plus interval. Missing meter and schedule remain labelled unknown. The legacy register stores a required numeric meter placeholder internally for unknown meters; discovery and operational views do not present that placeholder as a received measurement. Simulation discoveries cannot register real fleet equipment.

Duplicate prevention is per company/connection and case-insensitive external ID. Changed serial/make/model is quarantined for review. Different connections are not silently merged; existing fleet machines must keep explicit source mappings when adding another feed. Registration respects existing pilot fleet/site limits. Site assignment requires administrator role, company ownership, same-origin submission and session CSRF token.
