#!/usr/bin/env python3
"""Unattended transfer of immutable authorised NDJSON exports; no source API reader.

Run with --incoming and --state on persistent storage. An upstream reader must write
to a temporary name, close the file, then atomically rename it to *.ndjson.
"""
import argparse
import hashlib
import json
import os
from pathlib import Path
import signal
import threading
from urllib.parse import urlsplit

from tmm_source_adapter import SourceAdapter
from tmm_telemetry_bridge import Outbox, normalize

MAX_FILE_BYTES = 8 * 1024 * 1024
MAX_RECORDS = 10000


class TransferService:
    def __init__(self, incoming, state, endpoint, source, token, adapter=None):
        self.incoming, self.state = Path(incoming), Path(state)
        self.incoming.mkdir(parents=True, exist_ok=True)
        self.state.mkdir(parents=True, exist_ok=True)
        self.endpoint, self.source, self.token, self.adapter = endpoint, source, token, adapter
        self.queue = Outbox(str(self.state / 'outbox.sqlite3'))
        self.queue.db.execute('CREATE TABLE IF NOT EXISTS service_files(digest TEXT PRIMARY KEY,name TEXT NOT NULL,status TEXT NOT NULL,detail TEXT,processed_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP)')
        self.queue.db.commit()

    def ingest_file(self, path):
        # Completed files must be immutable; partial .tmp files are ignored.
        if path.is_symlink() or not path.is_file():
            return False
        if path.stat().st_size > MAX_FILE_BYTES:
            raise ValueError('Input export exceeds 8 MiB; split it upstream')
        with path.open('rb') as stream:
            content = stream.read(MAX_FILE_BYTES + 1)
        if len(content) > MAX_FILE_BYTES:
            raise ValueError('Input export exceeds 8 MiB; split it upstream')
        digest = hashlib.sha256(content).hexdigest()
        if self.queue.db.execute('SELECT 1 FROM service_files WHERE digest=?', (digest,)).fetchone():
            return False
        try:
            lines = [line for line in content.decode('utf-8').splitlines() if line.strip()]
            if len(lines) > MAX_RECORDS:
                raise ValueError('Export exceeds 10000 records; split it upstream')
            batch = {}
            for line in lines:
                raw = json.loads(line)
                reading = normalize(self.adapter.translate(raw) if self.adapter else raw)
                payload = json.dumps(reading, sort_keys=True)
                event = reading['event_id']
                if event in batch and batch[event][1] != payload:
                    raise ValueError('Conflicting event identity inside export')
                existing = self.queue.db.execute('SELECT payload FROM pending WHERE event_id=?', (event,)).fetchone()
                if existing and existing[0] != payload:
                    raise ValueError('Event identity conflicts with a pending observation')
                batch[event] = reading, payload
        except (ValueError, TypeError, UnicodeError) as error:
            # Retain the source file. A corrected file has a new digest and is retried.
            self.queue.db.execute('INSERT INTO service_files(digest,name,status,detail) VALUES(?,?,?,?)',
                                  (digest, path.name, 'rejected', type(error).__name__ + ': export requires validation or identity correction'))
            self.queue.db.commit()
            return True
        # enqueue() commits each reading before the file receipt. A crash replays stable
        # identities; it cannot acknowledge a file before its observations are durable.
        for reading, _ in batch.values():
            self.queue.enqueue(reading)
        self.queue.db.execute('INSERT INTO service_files(digest,name,status) VALUES(?,?,?)', (digest, path.name, 'queued'))
        self.queue.db.commit()
        return True

    def cycle(self):
        file_errors = 0
        processed = 0
        for path in sorted(self.incoming.glob('*.ndjson')):
            if processed >= 1000:
                break
            try:
                processed += int(self.ingest_file(path))
            except (OSError, ValueError):
                file_errors += 1
        transport_error = None
        sent = 0
        try:
            sent = self.queue.flush(self.endpoint, self.source, self.token, retry_limit=0)
        except (OSError, RuntimeError):
            # Authentication/configuration errors also retain pending records for repair.
            # Do not echo credentials, endpoints or incoming payloads into service logs.
            transport_error = 'Transfer not acknowledged; pending records retained'
        counts = {table: self.queue.db.execute('SELECT COUNT(*) FROM ' + table).fetchone()[0]
                  for table in ('pending', 'rejected')}
        rejected_files = self.queue.db.execute("SELECT COUNT(*) FROM service_files WHERE status='rejected'").fetchone()[0]
        from datetime import datetime, timezone
        status = {'updated_at': datetime.now(timezone.utc).isoformat(), 'pending': counts['pending'],
                  'rejected_readings': counts['rejected'], 'rejected_files': rejected_files,
                  'file_scan_errors': file_errors, 'sent_this_cycle': sent,
                  'status': 'attention' if transport_error or rejected_files or counts['rejected'] or file_errors else 'running',
                  'transport_error': transport_error}
        temporary = self.state / 'status.json.tmp'
        temporary.write_text(json.dumps(status, indent=2) + '\n', encoding='utf-8')
        temporary.replace(self.state / 'status.json')
        return status

    def close(self):
        self.queue.close()


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--incoming', required=True)
    parser.add_argument('--state', required=True)
    parser.add_argument('--mapping')
    parser.add_argument('--interval', type=float, default=30)
    args = parser.parse_args()
    endpoint = os.getenv('TMM_TELEMETRY_ENDPOINT', '').strip()
    source = os.getenv('TMM_TELEMETRY_SOURCE', '').strip()
    token = os.getenv('TMM_TELEMETRY_TOKEN', '').strip()
    url = urlsplit(endpoint)
    if url.scheme != 'https' or not url.hostname or url.username or url.password or url.query or url.fragment or url.path != '/api/telemetry/v2' or not source or not token:
        parser.error('Configure an HTTPS /api/telemetry/v2 endpoint, source and token through the environment')
    if args.interval < 1:
        parser.error('--interval must be at least 1 second')
    os.umask(0o077)
    state = Path(args.state)
    state.mkdir(parents=True, exist_ok=True)
    # The supplied systemd service targets Linux. One process owns a connection's spool.
    import fcntl
    lock = (state / 'service.lock').open('a')
    try:
        fcntl.flock(lock, fcntl.LOCK_EX | fcntl.LOCK_NB)
    except BlockingIOError:
        parser.error('Another transfer service already owns this state directory')
    adapter = SourceAdapter.from_file(args.mapping) if args.mapping else None
    stop = threading.Event()
    for sig in (signal.SIGTERM, signal.SIGINT):
        signal.signal(sig, lambda *_: stop.set())
    service = TransferService(args.incoming, state, endpoint, source, token, adapter)
    try:
        while not stop.is_set():
            print(json.dumps(service.cycle()), flush=True)
            stop.wait(args.interval)
    finally:
        service.close()
        lock.close()


if __name__ == '__main__':
    main()
