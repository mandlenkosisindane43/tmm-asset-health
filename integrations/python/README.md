# TMM source adapter structure

For operation outside Codespaces, see [independent operation](../../docs/INDEPENDENT_OPERATION.md)
and `tmm_transfer_service.py`. The supplied Linux service watches completed NDJSON
exports, preserves its queue across restarts and retries unattended. A real source
reader, permanent host and authorised cloud connection still need configuration.

This is a reusable Python translation layer for a future authorised company data hub, OEM export or device feed. It is **not an Exxaro connector** and does not yet fetch an unknown company's API or database.

- `tmm_source_adapter.py`: translates a JSON object using configuration; no network, credentials, code execution or machine commands.
- `tmm_telemetry_bridge.py`: receives NDJSON from a file or stdin, translates it when `--mapping` is supplied, validates it and uses the existing durable SQLite transfer queue.
- `examples/central-hub.mapping.json`: illustrative field names, conversions and diagnostic paths, explicitly marked as test data.
- `examples/central-hub.sample.ndjson`: one fictional source record. Its timestamp is fixed; replace it with the actual observation time for any future intake test. Do not automatically timestamp old readings as new.

## Try the structure without sending anything

From the repository root:

```sh
python3 integrations/python/tmm_telemetry_bridge.py \
  --mapping integrations/python/examples/central-hub.mapping.json \
  --dry-run integrations/python/examples/central-hub.sample.ndjson
```

For unattended transfer later, use the same command without `--dry-run`, supply the existing `TMM_TELEMETRY_ENDPOINT`, `TMM_TELEMETRY_SOURCE` and `TMM_TELEMETRY_TOKEN` environment variables, and use a durable `--spool` path unique to that connection. Omit the filename for a continuous NDJSON stream from the authorised source reader. Run the bridge and source reader under a service manager for startup and recovery. No supplier endpoint or credential is embedded in the examples.

Existing canonical-input bridge commands remain supported without `--mapping`. Invalid configuration stops before input/transfer. Invalid records in live transfer are retained in the bridge's rejected table; dry-run stops with an error. Inspect quarantined/rejected records when changing mappings. Network retries and stable observation identities continue to use the existing bridge. No external test messages are sent by the adapter tests.

## Mapping contract

`version` is `1`. `fields` maps a supported TMM target to a dot-separated **object key path**, or a rule with `path`, `type`, optional numeric `scale`/`offset`, `unit`, `counter_semantics` and `required`. No expressions, scripts, wildcards or array traversal are evaluated. Source keys containing literal dots need an upstream flattening adapter.

Conversion types: `text`, `number`, `iso8601`, `unix_seconds`, `unix_milliseconds`. Timestamp format must be explicit; ISO timestamps need a timezone. Missing optional values stay absent. Declare final output units alongside conversions; the adapter never guesses units or operating thresholds. Cumulative counters require their true semantics, not a convenience setting. Identity fields preserve supplied text, including leading zeros.

Use `asset.serial_number`, `asset.manufacturer`, `asset.model`, `asset.machine_type`, `asset.next_service_hours` and `asset.service_reference` for source identity/service details. Missing schedules are not filled with a default interval. External machine ID and timestamp are required. An unknown machine still needs sufficient identity metadata for TMM discovery and a one-time site assignment.

`faults` supports paired `spn_path`/`fmi_path` and `codes_path` for a string or list of vendor identifiers. SPN/FMI ranges are validated. Unknown vendor codes are preserved unchanged; diagnostic definitions belong in TMM's verified diagnostic library. This structure does not decode proprietary binary messages or invent private code meanings. Other diagnostic layouts will require a documented mapping extension after a sample is available.

## When the company provides information

1. Obtain an anonymised export, API/database access specification and authorised read permissions.
2. Confirm unique machine identity, timestamps/timezone, units, counter meanings, code dictionary and service schedule source.
3. Copy the example mapping and replace its paths/conversions with verified ones. Set `test_data` deliberately; keep test feeds separate from live equipment.
4. Implement the read-only source reader for their actual interface. API authentication, pagination/cursors, polling, database drivers and source-side buffering are source-specific work, not implemented here.
5. Validate known records offline, then test the authorised intake, machine mapping/discovery and automatic report outputs.

This is the prepared adapter framework; company compatibility and live operation are not certified by these examples.

## Watch the complete pipeline locally

From the repository root, with Python 3.10+ and Node 24+ installed:

```sh
python3 integrations/python/tmm_pipeline_demo.py
```

Open `docs/python-demo/latest-run/report.html` afterward. The run also saves
`evidence.json`, the source mapping, and synthetic NDJSON observations. No packages,
cloud credentials, or machine connection are needed. Start the command once; no
Capture, Analyse or Generate Report buttons are involved.

This uses the existing Python source adapter and SQLite outbox, then HTTP transfer
to the actual TMM Worker intake, analyser and scheduled report code. The local host
binds only to loopback and uses a disposable in-memory central database. Its
two-second background timer accelerates the deployed schedule for demonstration.
A deliberate HTTP 503 verifies automatic transfer retry; replay verifies deduplication.
Assertions check six stored/analysed readings, recognised SPN 110 FMI 0, an unknown
code requiring definition, and three saved daily/weekly/monthly rolling reports.
The synthetic cumulative counters also verify 90% availability, 77.78% utilisation
and 50 tonnes over the observed half-hour. These are not real operating results.

The backend remains JavaScript/TypeScript; Python supplies collection simulation,
translation and reliable transfer. This does not prove a real OEM protocol, device
acquisition, all supported metrics or external email delivery. It neither connects
to nor deletes anything from staging or production. The temporary local queue and
central database are discarded on exit; generated evidence remains available.
