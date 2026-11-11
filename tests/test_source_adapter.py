import copy
import importlib.util
import json
import subprocess
import sys
import unittest
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
spec = importlib.util.spec_from_file_location('source_adapter', ROOT / 'integrations/python/tmm_source_adapter.py')
module = importlib.util.module_from_spec(spec)
spec.loader.exec_module(module)
SourceAdapter = module.SourceAdapter


class AdapterTests(unittest.TestCase):
    def setUp(self):
        self.config = json.loads((ROOT / 'integrations/python/examples/central-hub.mapping.json').read_text())
        self.sample = json.loads((ROOT / 'integrations/python/examples/central-hub.sample.ndjson').read_text())

    def test_example_maps_identity_units_faults_and_source_service_without_changing_input(self):
        original = copy.deepcopy(self.sample)
        result = SourceAdapter(self.config).translate(self.sample)
        self.assertEqual(result['external_machine_id'], 'EXAMPLE-ADT-027')
        self.assertEqual(result['engine_hours'], 1245)
        self.assertEqual(result['engine_oil_pressure'], 420)
        self.assertEqual(result['units']['engine_oil_pressure'], 'kPa')
        self.assertEqual(result['timestamp'], '2026-11-11T13:00:00.000Z')
        self.assertEqual(result['fault_codes'], [{'spn': 110, 'fmi': 0}, 'PRIVATE-E742'])
        self.assertEqual(result['asset']['next_service_hours'], 1500)
        self.assertEqual(self.sample, original)

    def test_missing_measurements_stay_missing_and_identity_time_are_required(self):
        source = {'equipment': {'id': '000027'}, 'message': {'time': '2026-11-11T13:00:00Z'}}
        result = SourceAdapter(self.config).translate(source)
        self.assertEqual(result['external_machine_id'], '000027')
        self.assertNotIn('engine_hours', result)
        self.assertNotIn('asset', result)
        for incomplete in ({}, {'equipment': {'id': 'A'}}):
            with self.assertRaises(ValueError):
                SourceAdapter(self.config).translate(incomplete)

    def test_numeric_conversion_handles_offsets_and_declared_counters_without_accepting_booleans(self):
        self.config['fields']['scheduled_hours'] = {'path': 'schedule', 'type': 'number', 'unit': 'h', 'counter_semantics': 'cumulative', 'scale': 0.5, 'offset': 2}
        self.sample['schedule'] = 10
        result = SourceAdapter(self.config).translate(self.sample)
        self.assertEqual(result['scheduled_hours'], 7)
        self.assertEqual(result['counter_semantics']['scheduled_hours'], 'cumulative')
        for invalid in (True, [], {}, 'NaN', 'Infinity'):
            self.sample['schedule'] = invalid
            with self.assertRaises(ValueError):
                SourceAdapter(self.config).translate(self.sample)

    def test_time_formats_require_explicit_timezone_or_epoch_units(self):
        self.sample['message']['time'] = '2026-11-11T13:00:00'
        with self.assertRaises(ValueError):
            SourceAdapter(self.config).translate(self.sample)
        self.config['fields']['timestamp']['type'] = 'unix_milliseconds'
        self.sample['message']['time'] = 0
        self.assertEqual(SourceAdapter(self.config).translate(self.sample)['timestamp'], '1970-01-01T00:00:00.000Z')

    def test_invalid_mappings_and_incomplete_fault_pairs_fail_explicitly(self):
        for target in ('company_id', 'token', 'eval'):
            config = copy.deepcopy(self.config)
            config['fields'][target] = 'anything'
            with self.assertRaises(ValueError):
                SourceAdapter(config)
        self.sample['diagnostics']['FMI'] = 32
        with self.assertRaises(ValueError):
            SourceAdapter(self.config).translate(self.sample)
        del self.sample['diagnostics']['FMI']
        with self.assertRaises(ValueError):
            SourceAdapter(self.config).translate(self.sample)

    def test_source_simulation_marker_cannot_be_downgraded_by_live_configuration(self):
        self.config['test_data'] = False
        self.sample['test_data'] = True
        self.assertTrue(SourceAdapter(self.config).translate(self.sample)['test_data'])
        self.sample['test_data'] = 'false'
        with self.assertRaises(ValueError):
            SourceAdapter(self.config).translate(self.sample)

    def test_existing_bridge_cli_consumes_mapping_without_network_or_credentials(self):
        args = [sys.executable, str(ROOT / 'integrations/python/tmm_telemetry_bridge.py'), '--mapping', str(ROOT / 'integrations/python/examples/central-hub.mapping.json'), '--dry-run', str(ROOT / 'integrations/python/examples/central-hub.sample.ndjson')]
        run = subprocess.run(args, check=True, capture_output=True, text=True)
        result = json.loads(run.stdout.splitlines()[0])
        self.assertEqual(result['engine_oil_pressure'], 420)
        self.assertTrue(result['event_id'])
        self.assertTrue(result['test_data'])
        self.assertIn('Validated 1 readings', run.stdout)


if __name__ == '__main__':
    unittest.main()
