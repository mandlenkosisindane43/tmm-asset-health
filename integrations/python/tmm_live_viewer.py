#!/usr/bin/env python3
"""Live TMM pipeline viewer. Run from repository root:
python3 integrations/python/tmm_live_viewer.py
Python 3.10+ and Node 24+; standard library only. Open port 8001.
"""
import argparse
from collections import deque
from datetime import datetime, timedelta, timezone
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
import json
from pathlib import Path
import shutil
import subprocess
import tempfile
import threading
import time
import urllib.request
from tmm_source_adapter import SourceAdapter
from tmm_telemetry_bridge import Outbox, normalize, send

ROOT = Path(__file__).resolve().parents[2]

class Viewer:
    def __init__(self, ready, interval, start_delay):
        self.ready = ready
        self.interval = interval
        self.start_delay = start_delay
        self.lock = threading.RLock()
        self.stop = threading.Event()
        self.events = deque(maxlen=150)
        self.observations = []
        self.backend = {'readings': [], 'receipts': [], 'findings': [], 'reports': [], 'cycles': 0}
        self.phase = 'Waiting for automatic source'
        self.error = None
        self.retries = 0
        self.pending = 0
        self.duplicate = False
        self.completed = False
        self.last_backend_at = None
        self.started = datetime.now(timezone.utc).isoformat()
        self.counter = 0

    def log(self, stage, message, event_id=None):
        with self.lock:
            self.counter += 1
            self.events.appendleft({'id': self.counter, 'time': datetime.now(timezone.utc).isoformat(),
                                    'stage': stage, 'message': message, 'event_id': event_id})

    def poll_backend(self):
        with urllib.request.urlopen(self.ready['url'] + '/demo/state', timeout=5) as response:
            result = json.load(response)
        if result.get('schedulerError'):
            raise RuntimeError(result['schedulerError'])
        with self.lock:
            old = self.backend
            self.backend = result
            self.last_backend_at = datetime.now(timezone.utc).isoformat()
            for name, stage in [('readings', 'storage'), ('receipts', 'analysis')]:
                delta = len(result[name]) - len(old[name])
                if delta > 0:
                    self.log(stage, ('Stored' if name == 'readings' else 'Analysed') + ' ' + str(delta) + ' new observation(s)')
            old_reports = {r['period']: r.get('generated_at') for r in old['reports']}
            for report in result['reports']:
                if old_reports.get(report['period']) != report.get('generated_at'):
                    # Show updates only when the covered reading count changes.
                    old_count = next((r['reading_count'] for r in old['reports'] if r['period'] == report['period']), None)
                    if old_count != report['reading_count']:
                        self.log('reports', report['period'].title() + ' report saved: ' + str(report['reading_count']) + ' readings')
            for finding in result['findings'][len(old['findings']):]:
                self.log('analysis', str(finding.get('diagnostic_code') or finding['category']) + ': ' + finding['details'])

    def watch(self):
        while not self.stop.is_set():
            try:
                self.poll_backend()
            except Exception as error:
                with self.lock:
                    self.error = 'Backend monitoring: ' + str(error)
                self.log('error', str(error))
            self.stop.wait(.5)

    def produce(self):
        try:
            fields = {'external_machine_id': 'device.id', 'event_id': 'message.id',
                      'timestamp': {'path': 'message.time', 'type': 'iso8601'}}
            for key, unit in {'engine_hours': 'h', 'scheduled_hours': 'h', 'available_hours': 'h',
                              'productive_hours': 'h', 'production_tonnes': 't',
                              'coolant_temperature': 'degC', 'hydraulic_pressure': 'bar'}.items():
                fields[key] = {'path': 'readings.' + key, 'type': 'number', 'unit': unit}
                if key.endswith('_hours') or key == 'production_tonnes':
                    fields[key]['counter_semantics'] = 'cumulative'
            adapter = SourceAdapter({'version': 1, 'name': 'Live viewer synthetic source',
                                     'test_data': True, 'fields': fields,
                                     'faults': {'spn_path': 'fault.spn', 'fmi_path': 'fault.fmi', 'codes_path': 'fault.vendor'}})
            self.log('source', 'Synthetic source starts automatically in ' + str(self.start_delay) + ' seconds; six readings, spaced for visibility.')
            if self.stop.wait(self.start_delay):
                return
            now = datetime.now(timezone.utc).replace(microsecond=0)
            with tempfile.TemporaryDirectory(prefix='tmm-live-outbox-') as directory:
                queue = Outbox(str(Path(directory) / 'outbox.sqlite3'))
                try:
                    for i in range(6):
                        if self.stop.is_set():
                            return
                        event = 'live-viewer-' + str(i + 1)
                        raw = {'device': {'id': 'PY-DEVICE-001'},
                               'message': {'id': event, 'time': (now - timedelta(minutes=31 - 6*i)).isoformat()},
                               'readings': {'engine_hours': 1000 + .08*i, 'scheduled_hours': .1*i,
                                            'available_hours': .09*i, 'productive_hours': .07*i,
                                            'production_tonnes': 10*i,
                                            'coolant_temperature': [80,84,88,95,106,110][i],
                                            'hydraulic_pressure': [140,142,145,143,146,145][i]},
                               'fault': {'spn':110,'fmi':0,'vendor':['DEMO-UNKNOWN']} if i >= 4 else {}}
                        with self.lock:
                            self.observations.append({'event_id': event, 'raw': raw, 'status': 'collecting'})
                            self.phase = 'Collecting observation ' + str(i + 1) + ' of 6'
                        self.log('source', 'Collected ' + event + ' from simulated PY-DEVICE-001', event)
                        if self.stop.wait(.7):
                            return
                        reading = normalize(adapter.translate(raw))
                        with self.lock:
                            self.observations[-1]['translated'] = reading
                            self.observations[-1]['status'] = 'queued'
                            self.pending = 1
                            self.phase = 'Transferring ' + event
                        queue.enqueue(reading)
                        self.log('pipeline', 'Translated field names and units; saved in durable outbox', event)
                        if self.stop.wait(.7):
                            return
                        def retry_delay(seconds):
                            with self.lock:
                                self.retries += 1
                                self.phase = 'Connection interrupted; retrying automatically'
                            self.log('pipeline', 'Injected HTTP 503. Reading stays queued; automatic retry in ' + str(seconds) + ' second(s)', event)
                            if self.stop.wait(seconds):
                                raise RuntimeError('Viewer stopped')
                        count = queue.flush(self.ready['url']+'/api/telemetry/v2', 'python-demo', self.ready['token'],
                                            retry_limit=2, delay=retry_delay)
                        if count != 1:
                            raise RuntimeError('Transfer was not accepted; inspect mapping')
                        with self.lock:
                            self.pending = 0
                            self.observations[-1]['status'] = 'accepted'
                            self.phase = 'Waiting for automatic analysis'
                        self.log('pipeline', 'Intake acknowledged reading; removed from outbox', event)
                        if self.stop.wait(self.interval):
                            return
                    duplicate = send(self.ready['url']+'/api/telemetry/v2', 'python-demo', self.ready['token'], [reading])
                    with self.lock:
                        self.duplicate = duplicate['results'][0]['status'] == 'duplicate'
                    if not self.duplicate:
                        raise RuntimeError('Duplicate replay was not recognised')
                    self.log('pipeline', 'Replayed final event: server returned duplicate; no second reading stored', event)
                finally:
                    queue.close()
            deadline = time.monotonic() + 30
            while time.monotonic() < deadline and not self.stop.is_set():
                with self.lock:
                    ready = (len(self.backend['receipts']) == 6 and len(self.backend['reports']) == 3
                             and all(r['reading_count'] == 6 for r in self.backend['reports']))
                if ready:
                    break
                self.stop.wait(.5)
            with self.lock:
                state = self.backend
                if len(state['readings']) != 6 or len(state['receipts']) != 6:
                    raise RuntimeError('Not all observations were stored and analysed')
                if len(state['reports']) != 3 or any(r['reading_count'] != 6 for r in state['reports']):
                    raise RuntimeError('Saved reports have not covered all six readings')
                metrics = state['reports'][0]['metrics']
                if (metrics['availability_percent'], metrics['utilisation_percent'], metrics['production_tonnes']) != (90, 77.78, 50):
                    raise RuntimeError('Received-counter calculation did not match the synthetic fixture')
                if not any(f.get('diagnostic_code') == 'SPN 110 FMI 0' for f in state['findings']):
                    raise RuntimeError('Expected J1939 finding missing')
                if not any(f.get('diagnostic_code') == 'DEMO-UNKNOWN' and 'definition required' in f['details'] for f in state['findings']):
                    raise RuntimeError('Unknown code was not disclosed')
                if state['registeredHourMeter'] != 1000 or state['deliveries']:
                    raise RuntimeError('Simulation isolation failed')
                self.completed = True
                self.phase = 'Complete — all six readings analysed; three reports saved'
            self.log('complete', 'PASS: storage, analysis, reports, automatic retry, duplicate prevention and simulation isolation.')
        except Exception as error:
            with self.lock:
                self.error = str(error)
                self.phase = 'Needs attention'
            self.log('error', str(error))

    def snapshot(self):
        with self.lock:
            return {'started': self.started, 'phase': self.phase, 'error': self.error,
                    'completed': self.completed, 'pending': self.pending, 'retries': self.retries,
                    'duplicate': self.duplicate, 'observations': self.observations,
                    'events': list(self.events), 'backend': self.backend, 'last_backend_at': self.last_backend_at,
                    'source_mode': 'simulation'}
            
def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--port', type=int, default=8001)
    parser.add_argument('--interval', type=float, default=6, help='Seconds between synthetic observations')
    parser.add_argument('--start-delay', type=float, default=12, help='Seconds allowed to open the viewer')
    parser.add_argument('--self-test', action='store_true', help='Run a quick headless integration check and exit')
    args = parser.parse_args()
    if not 1 <= args.port <= 65535 or args.interval < 0 or args.start_delay < 0:
        parser.error('Check port and nonnegative delays')
    if not shutil.which('node'):
        parser.error('Node 24+ is required alongside Python. In Codespaces use: nvm install 24')
    urllib.request.install_opener(urllib.request.build_opener(urllib.request.ProxyHandler({})))
    process = subprocess.Popen(['node','--disable-warning=ExperimentalWarning',str(ROOT/'tools/python_demo_host.mjs')],
                               stdout=subprocess.PIPE, text=True)
    server = None
    viewer = None
    try:
        line = process.stdout.readline()
        if not line:
            raise RuntimeError('TMM backend did not start; check Node 24+ and the error above.')
        viewer = Viewer(json.loads(line), 0 if args.self_test else args.interval,
                        0 if args.self_test else args.start_delay)
        class Handler(BaseHTTPRequestHandler):
            def do_GET(self):
                path = self.path.split('?',1)[0]
                if path == '/':
                    body = Path(__file__).with_name('tmm_live_viewer.html').read_bytes()
                    content_type = 'text/html; charset=utf-8'
                elif path in ('/api/state','/evidence.json'):
                    body = json.dumps(viewer.snapshot()).encode()
                    content_type = 'application/json; charset=utf-8'
                else:
                    self.send_error(404)
                    return
                self.send_response(200)
                self.send_header('Content-Type', content_type)
                self.send_header('Cache-Control', 'no-store')
                self.send_header('X-Content-Type-Options', 'nosniff')
                self.end_headers()
                try:
                    self.wfile.write(body)
                except (BrokenPipeError, ConnectionResetError):
                    pass
            def log_message(self, *_):
                pass
        try:
            server = ThreadingHTTPServer(('127.0.0.1', 0 if args.self_test else args.port), Handler)
        except OSError as error:
            raise RuntimeError('Cannot open viewer port ' + str(args.port) + '; try --port 8002. ' + str(error)) from error
        port = server.server_address[1]
        threads = [threading.Thread(target=viewer.watch, daemon=True),
                   threading.Thread(target=viewer.produce, daemon=True)]
        for thread in threads:
            thread.start()
        print('TMM Python live viewer: http://127.0.0.1:' + str(args.port), flush=True)
        print('Open port ' + str(args.port) + ' in your Codespaces Ports tab. Keep it Private.', flush=True)
        print('Simulated readings start automatically. Ctrl+C stops the viewer. Online TMM is unchanged.', flush=True)
        if args.self_test:
            serving = threading.Thread(target=server.serve_forever, daemon=True)
            serving.start()
            threads[1].join(timeout=45)
            snapshot = viewer.snapshot()
            if not snapshot['completed'] or snapshot['error']:
                raise RuntimeError(snapshot['error'] or 'Integration check timed out')
            with urllib.request.urlopen('http://127.0.0.1:'+str(args.port)+'/api/state',timeout=5) as response:
                observed = json.load(response)
            if not observed['completed'] or observed['pending'] != 0:
                raise RuntimeError('Viewer endpoint did not expose completed state')
            print('PASS: 6 stored, 6 analysed, 3 complete reports; retry, deduplication, KPIs and isolation verified.', flush=True)
            server.shutdown()
        else:
            server.serve_forever()
    except KeyboardInterrupt:
        print('\nViewer stopped. Disposable local data will be released; online records unchanged.')
    finally:
        if viewer:
            viewer.stop.set()
        if server:
            server.server_close()
        process.terminate()
        try:
            process.wait(timeout=5)
        except subprocess.TimeoutExpired:
            process.kill()
            process.wait()

if __name__ == '__main__':
    main()
