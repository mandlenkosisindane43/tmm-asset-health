# TMM operation without a developer workspace

## Current evidence and the remaining activation

The development branch's `.github/workflows/deploy-light-staging.yml` builds,
tests and deploys the isolated Cloudflare Worker. It forwards scheduled events
and requires a 15-minute staging cron with dedicated D1 and R2 bindings.
Those cloud components do not require a laptop, browser or Codespace to stay open.
This is configuration evidence; check current deployment/scheduler logs to verify
the running release. It is not certification of real machine acquisition.

The root production `wrangler.jsonc` uses a different entry point and a daily cron.
Do not assume the development branch's telemetry schedule is active in production.
Promoting the verified telemetry implementation, bindings and schedule to production
is a separate release; this change does not modify production or enable a live feed.

The Python viewer and its disposable database remain demonstrations. Neither is
the hosted central pot. Do not deploy `tmm_live_viewer.py` as the operational
collector or use Codespaces for permanent operation.

## Permanent Python transfer service

`integrations/python/tmm_transfer_service.py` runs without a browser or buttons.
It watches a directory for completed authorised NDJSON exports, applies the existing
adapter, persists observations in the existing SQLite outbox, and transfers them to
the registered HTTPS TMM intake. A failed network or authentication attempt retains
the pending records. Its file receipts and queue survive process restarts.

An upstream source reader must deliver immutable files: write a unique `.tmp` file,
close it, then rename it atomically to `.ndjson` in the incoming directory.
Temporary files are ignored. Every observation needs its original timestamp and a
stable, unique event identity; preserve IDs during retries. Identical completed
exports are skipped even if renamed. Source files are never deleted by this service.
Keep exports below 8 MiB and 10000 observations per file. Retain or archive source
files according to the agreed policy; monitor disk capacity and queue size.

Malformed or conflicting exports remain on disk and are recorded as rejected in
the local `service_files` table. Correct the source and deliver a corrected file;
the changed content is reconsidered. Historical rejection counts remain visible
for audit. Server-rejected readings remain in the existing outbox `rejected` table.
The service never silently overwrites a conflicting queued event.

This is a completed-file transfer service, **not a generic OEM API reader**. The
actual company reader, authentication, pagination, polling and units still depend
on their authorised interface. Sources that push directly to TMM's cloud intake
do not need this Python gateway. A gateway reading physical machine interfaces
must run at the machine/site; a remote server cannot access an unconnected CAN bus.

### Linux service installation, once a host is selected

Use Python 3.10+ on a permanent Linux server or gateway with persistent storage and
outbound HTTPS. Node is not required for this service: it sends to the hosted TMM
backend instead of starting the local demonstration backend.

1. Install a reviewed source release under `/opt/tmm-transfer/releases/<commit>`.
   Keep code read-only to the service account; link `/opt/tmm-transfer/current` to
   that release. Create a dedicated `tmm-transfer` user/group.
2. Create `/var/lib/tmm-transfer/incoming` and `/var/lib/tmm-transfer/state`, owned
   by that account. Use a separate state directory and service instance for every
   source/company. Never reuse a queue for a different company.
3. Put the verified mapping in `/etc/tmm-transfer/source.mapping.json`. The existing
   sample is fictional and test-labelled; it is not a live company mapping.
4. Copy `integrations/python/deploy/connection.env.example` to
   `/etc/tmm-transfer/connection.env`, supply the authorised HTTPS intake, registered
   source key and token, and restrict access to root. Never commit this populated
   file, paste its contents into chat, or include it in backups without encryption.
5. Review and install `integrations/python/deploy/tmm-transfer.service` as
   `/etc/systemd/system/tmm-transfer.service`. Then run:

```sh
sudo systemctl daemon-reload
sudo systemctl enable --now tmm-transfer
sudo systemctl status tmm-transfer
sudo journalctl -u tmm-transfer -n 30 --no-pager
```

The unit starts after boot, restarts after failures, and grants writes only to the
service's data directory. It opens no inbound web port. The source reader needs
its own supervised service and narrowly scoped access to the incoming directory.

`/var/lib/tmm-transfer/state/status.json` contains a heartbeat, pending/rejected
counts and transfer status without credentials or payloads. Monitor heartbeat age,
pending growth, rejections, service state and available disk space using the host's
monitoring system. A status file alone is not an external alerting system.

Before real activation, test the selected host's reboot/restart behavior, persistent
disk, network outage/recovery and authorised source-to-cloud-to-report path. The
repository tests mock HTTP for crash/retry cases; they do not claim a host was rebooted
or a real OEM endpoint was reached. No permanent host has been provisioned by this change.

## Ownership, updates and rollback

- Keep the GitHub repository, Cloudflare account, domain and gateway host under
  Sindane Asset Solutions' control. Retain account recovery and billing ownership.
- Develop and test in staging. Deploy a reviewed release; do not run arbitrary
  production updates from a dashboard user's machine.
- For gateway updates, stop the service gracefully, retain incoming files, mapping,
  credentials, file receipts and SQLite outbox, switch `current` to the reviewed
  release, then restart and inspect the heartbeat/queue. Never replace the data
  directory when replacing application code.
- For rollback, switch to a compatible prior release. If a release changes database
  formats, verify compatibility or restore a tested backup; code rollback alone
  cannot undo an incompatible database migration.
- Back up the central D1 data and R2 reports/files independently from source code.
  Back up the gateway state with the service stopped, or use SQLite's online backup
  facility. Test restoration before relying on the backup. A GitHub commit does
  not back up customer data or prove disaster recovery.
- Verify a saved cloud report after closing development tools. Confirm the next
  scheduled cycle happens without a page request. Keep delivery, source freshness
  and failed-processing monitoring separate from visual dashboard refreshes.

## Activation dependencies

Choose the permanent gateway/server (if a gateway is required), provide its authorised
administration access, configure the real data connection, and verify the production
release and backups. These details cannot be inferred from the Python simulation.
Until they are supplied and verified, the permanent Python service is prepared and
tested locally, not claimed as running unattended on a new host.
