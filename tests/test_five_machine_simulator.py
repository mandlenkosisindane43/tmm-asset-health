import importlib.util
import unittest
from datetime import datetime, timedelta, timezone
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
spec = importlib.util.spec_from_file_location("fleet_simulator", ROOT / "integrations/python/five_machine_simulator.py")
simulator = importlib.util.module_from_spec(spec)
spec.loader.exec_module(simulator)
spec = importlib.util.spec_from_file_location("bridge", ROOT / "integrations/python/tmm_telemetry_bridge.py")
bridge = importlib.util.module_from_spec(spec)
spec.loader.exec_module(bridge)


class FiveMachineTest(unittest.TestCase):
    def test_registration_identity_and_bridge_compatibility(self):
        start = datetime(2026, 11, 14, tzinfo=timezone.utc)
        initial = simulator.observations(start, start)
        self.assertEqual(len({r["external_machine_id"] for r in initial}), 5)
        self.assertEqual({r["asset"]["machine_type"] for r in initial}, {"ADT", "GRADER", "FEL", "TLB", "EXCAVATOR"})
        for row in initial:
            normalized = bridge.normalize(row)
            self.assertTrue(normalized["test_data"])
            self.assertEqual(normalized["asset"], row["asset"])
            self.assertEqual(normalized["engine_hours"], row["engine_hours"])

    def test_meter_fault_lifecycle_and_replayed_slot_identity(self):
        start = datetime(2026, 11, 14, tzinfo=timezone.utc)
        batches = [simulator.observations(start + timedelta(minutes=15*i), start) for i in range(6)]
        for machine in range(5):
            first = batches[0][machine]
            self.assertEqual(batches[1][machine]["engine_hours"] - first["engine_hours"], .25)
            self.assertFalse(first["fault_codes"])
            self.assertEqual(batches[1][machine]["fault_codes"], batches[2][machine]["fault_codes"])
            self.assertTrue(batches[1][machine]["fault_codes"])
            self.assertFalse(batches[3][machine]["fault_codes"])
            self.assertTrue(batches[5][machine]["fault_codes"])
        self.assertEqual(batches[0], simulator.observations(start + timedelta(seconds=30), start))
        for batch in batches:
            for row in batch:
                bridge.normalize(row)


if __name__ == "__main__":
    unittest.main()
