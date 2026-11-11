import importlib
import json
from pathlib import Path
import sys
import tempfile
import unittest
from unittest.mock import patch
import urllib.error

sys.path.insert(0, str(Path(__file__).parents[1] / 'integrations/python'))
service = importlib.import_module('tmm_transfer_service')
bridge = importlib.import_module('tmm_telemetry_bridge')


class UnattendedTransferTests(unittest.TestCase):
    def reading(self, event='event-1'):
        return {'machine_id': 'EXT-1', 'event_id': event, 'timestamp': '2026-11-11T08:00:00Z',
                'engine_hours': 1234, 'test_data': True}

    def make(self, root):
        return service.TransferService(root / 'incoming', root / 'state',
                                       'https://test.invalid/api/telemetry/v2', 'test-source', 'not-a-real-token')

    def put(self, root, name, records):
        path = root / 'incoming' / name
        path.write_text(''.join(json.dumps(r) + '\n' for r in records), encoding='utf-8')
        return path

    def test_outage_restart_and_repeated_export_preserve_one_durable_event(self):
        with tempfile.TemporaryDirectory() as temp:
            root = Path(temp)
            worker = self.make(root)
            self.put(root, 'ready.ndjson', [self.reading()])
            with patch.object(bridge, 'send', side_effect=urllib.error.URLError('offline')):
                self.assertEqual(worker.cycle()['pending'], 1)
            worker.close()
            restarted = self.make(root)
            try:
                # Same export under another filename must not be collected twice.
                self.put(root, 'copied.ndjson', [self.reading()])
                with patch.object(bridge, 'send', return_value={'results': [{'status': 'accepted'}]}) as send:
                    status = restarted.cycle()
                    restarted.cycle()
                self.assertEqual(status['pending'], 0)
                self.assertEqual(send.call_count, 1)
                self.assertEqual(restarted.queue.db.execute('SELECT COUNT(*) FROM service_files').fetchone()[0], 1)
            finally:
                restarted.close()

    def test_partial_exports_ignored_and_invalid_exports_retained_for_correction(self):
        with tempfile.TemporaryDirectory() as temp:
            root = Path(temp)
            worker = self.make(root)
            try:
                self.put(root, 'writing.tmp', [self.reading()])
                broken = self.put(root, 'broken.ndjson', [{'machine_id': 'EXT-1'}])
                with patch.object(bridge, 'send') as send:
                    status = worker.cycle()
                    self.assertEqual(status['pending'], 0)
                    self.assertEqual(status['rejected_files'], 1)
                    send.assert_not_called()
                self.assertTrue(broken.exists())
                self.put(root, 'corrected.ndjson', [self.reading()])
                with patch.object(bridge, 'send', return_value={'results': [{'status': 'accepted'}]}) as send:
                    self.assertEqual(worker.cycle()['sent_this_cycle'], 1)
                    send.assert_called_once()
            finally:
                worker.close()

    def test_identity_conflict_cannot_replace_the_observation_awaiting_transfer(self):
        with tempfile.TemporaryDirectory() as temp:
            root = Path(temp)
            worker = self.make(root)
            try:
                self.put(root, 'first.ndjson', [self.reading()])
                with patch.object(bridge, 'send', side_effect=urllib.error.URLError('offline')):
                    worker.cycle()
                    changed = self.reading()
                    changed['engine_hours'] = 9999
                    self.put(root, 'conflict.ndjson', [changed])
                    status = worker.cycle()
                self.assertEqual(status['pending'], 1)
                self.assertEqual(status['rejected_files'], 1)
                payload = json.loads(worker.queue.db.execute('SELECT payload FROM pending').fetchone()[0])
                self.assertEqual(payload['engine_hours'], 1234)
            finally:
                worker.close()

    def test_crash_after_enqueue_before_file_receipt_replays_safely(self):
        with tempfile.TemporaryDirectory() as temp:
            root = Path(temp)
            worker = self.make(root)
            self.put(root, 'ready.ndjson', [self.reading()])
            worker.queue.enqueue(bridge.normalize(self.reading()))
            worker.close()
            restarted = self.make(root)
            try:
                with patch.object(bridge, 'send', return_value={'results': [{'status': 'accepted'}]}) as send:
                    self.assertEqual(restarted.cycle()['pending'], 0)
                    send.assert_called_once()
            finally:
                restarted.close()

    def test_status_file_contains_counts_without_credentials_or_machine_payloads(self):
        with tempfile.TemporaryDirectory() as temp:
            root = Path(temp)
            worker = self.make(root)
            try:
                status = worker.cycle()
                text = (root / 'state' / 'status.json').read_text()
                self.assertEqual(json.loads(text)['status'], 'running')
                self.assertIn('updated_at', status)
                self.assertNotIn('not-a-real-token', text)
                self.assertNotIn('https://', text)
            finally:
                worker.close()
