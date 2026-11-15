# Readiness fixes — 15 November 2026

## Delivered changes

- Staging processing runs every minute; the demo collector retains a 15-minute
  collection cadence. Initial trial registration still sends the first batch.
- Analysis drains FIFO work in batches under a wall-time and counted-query budget.
  Report targets rotate under their own reserved time/query headroom. Pending work
  stays durable for the next minute, instead of waiting another quarter hour.
- A local 159-machine burst now drains analysis and produces each machine's reports
  within seven simulated one-minute invocations. The test advances the clock; it
  is not an elapsed-time production benchmark. Keep per-company latency/backlog
  monitoring and verify remote D1 quotas/plan before making a contracted SLA.
- Overlapping draft/approved maintenance slots are rejected atomically on creation;
  approval also rejects conflicts with legacy approved bookings. Adjacent jobs are
  allowed. Approved bookings can be cancelled with retained history.
- Completed service requires administrator sign-off, actual service meter,
  next-service meter, work order, completion notes and OEM/site schedule reference.
  A transactional D1 batch saves evidence, marks the booking complete and advances
  the service threshold. Retries cannot overwrite a later threshold. Failure rolls
  back all three changes. It does not invent a telemetry reading, close a breakdown
  or assert parts/labour were reconciled in another work-order module.
- Delivery configuration can select working days or every day for a 24/7 mine.
  Working-day remains the default for existing accounts; choose the customer's
  calendar explicitly. Simulation remains separate and never sends external mail.

## Remaining external evidence

Real authorised feed connection, actual recipient inbox delivery, backup/restore
exercise, remote fleet-size profiling and physical device tests cannot be replaced
by local unit/runtime tests. OEM adapters remain provider-specific. PDF imports
still record metadata only; original PDF storage/extraction is not implemented.
No production promotion is included.

## Independent device

See `integrations/esp32/README.md`. The new ESP32 route acquires permitted machine
signals itself and posts to TMM, independently of OEM/cloud aggregation sources.
Default mode is a safe, test-labelled bench producer; optional receive-only CAN
mode initially supports verified J1939 engine RPM only. It is not a 21-parameter
or universal machine device, and full firmware/hardware validation remains open.
