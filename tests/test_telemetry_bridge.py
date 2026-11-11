import importlib.util
import tempfile
import unittest
import urllib.error
from pathlib import Path
from unittest.mock import patch

spec = importlib.util.spec_from_file_location("bridge", Path(__file__).parents[1] / "integrations/python/tmm_telemetry_bridge.py")
bridge = importlib.util.module_from_spec(spec)
spec.loader.exec_module(bridge)


class BridgeReliabilityTests(unittest.TestCase):
    def observation(self):
        return bridge.normalize({"machine_id": "EXT-ONE", "timestamp": "2026-11-11T08:00:00Z", "test_data": True, "fault_codes": [{"spn": 110, "fmi": 0}]})

    def test_normalization_preserves_codes_and_has_stable_replay_identity(self):
        first, second = self.observation(), self.observation()
        self.assertEqual(first["event_id"], second["event_id"])
        self.assertEqual(first["fault_codes"], [{"spn": 110, "fmi": 0}])
        self.assertIs(first["test_data"], True)

    def test_network_outage_retries_automatically(self):
        with tempfile.TemporaryDirectory() as root:
            queue = bridge.Outbox(str(Path(root) / "queue.sqlite3"))
            queue.enqueue(self.observation())
            with patch.object(bridge, "send", side_effect=[urllib.error.URLError("offline"), {"ok": True}]) as send:
                self.assertEqual(queue.flush("unused", "source", "token", delay=lambda _: None), 1)
                self.assertEqual(send.call_count, 2)
            self.assertEqual(queue.db.execute("SELECT COUNT(*) FROM pending").fetchone()[0], 0)
            queue.close()

    def test_unacknowledged_observation_survives_restart(self):
        with tempfile.TemporaryDirectory() as root:
            path = str(Path(root) / "queue.sqlite3")
            queue = bridge.Outbox(path)
            queue.enqueue(self.observation())
            with patch.object(bridge, "send", side_effect=urllib.error.URLError("offline")):
                with self.assertRaises(urllib.error.URLError):
                    queue.flush("unused", "source", "token", retry_limit=0)
            queue.close()
            restarted = bridge.Outbox(path)
            with patch.object(bridge, "send", return_value={"ok": True}):
                self.assertEqual(restarted.flush("unused", "source", "token"), 1)
            restarted.close()

    def test_partial_rejection_stays_queued(self):
        with tempfile.TemporaryDirectory() as root:
            queue = bridge.Outbox(str(Path(root) / "queue.sqlite3"))
            queue.enqueue(self.observation())
            with patch.object(bridge, "send", side_effect=RuntimeError("quarantined")):
                with self.assertRaises(RuntimeError):
                    queue.flush("unused", "source", "token")
            self.assertEqual(queue.db.execute("SELECT COUNT(*) FROM pending").fetchone()[0], 1)
            queue.close()


if __name__ == "__main__":
    unittest.main()
