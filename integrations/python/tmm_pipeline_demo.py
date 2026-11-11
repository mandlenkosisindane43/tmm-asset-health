#!/usr/bin/env python3
"""Run from repository root: python3 integrations/python/tmm_pipeline_demo.py
Requires Python 3.10+ and Node 24+. No dependencies, credentials or live connection.
Uses actual Python adapter/queue and TMM Worker intake/analyser/report scheduler.
"""
import argparse
import html
import json
from pathlib import Path
import subprocess
import tempfile
import time
from datetime import datetime, timedelta, timezone
import urllib.request
from tmm_source_adapter import SourceAdapter
from tmm_telemetry_bridge import Outbox, normalize, send

ROOT = Path(__file__).resolve().parents[2]

def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--output', type=Path, default=ROOT / 'docs/python-demo/latest-run')
    args = parser.parse_args()
    args.output.mkdir(parents=True, exist_ok=True)
    process = subprocess.Popen(['node', '--disable-warning=ExperimentalWarning', str(ROOT/'tools/python_demo_host.mjs')], stdout=subprocess.PIPE, text=True)
    try:
        line = process.stdout.readline()
        if not line:
            raise RuntimeError('Local TMM host could not start; check Node 24+ and the error above.')
        ready = json.loads(line)
        endpoint = ready['url'] + '/api/telemetry/v2'
        fields = {'external_machine_id':'device.id', 'event_id':'message.id', 'timestamp':{'path':'message.time','type':'iso8601'}}
        for key, unit in {'engine_hours':'h','scheduled_hours':'h','available_hours':'h','productive_hours':'h','production_tonnes':'t','coolant_temperature':'degC','hydraulic_pressure':'bar'}.items():
            fields[key] = {'path':'readings.'+key,'type':'number','unit':unit}
            if key.endswith('_hours') or key == 'production_tonnes':
                fields[key]['counter_semantics'] = 'cumulative'
        mapping = {'version':1,'name':'Local synthetic demonstration','test_data':True,'fields':fields,'faults':{'spn_path':'fault.spn','fmi_path':'fault.fmi','codes_path':'fault.vendor'}}
        adapter = SourceAdapter(mapping)
        now = datetime.now(timezone.utc).replace(microsecond=0)
        raw = []
        for i in range(6):
            raw.append({'device':{'id':'PY-DEVICE-001'},'message':{'id':f'python-demo-{i}','time':(now-timedelta(minutes=31-6*i)).isoformat()},'readings':{'engine_hours':1000+.08*i,'scheduled_hours':.1*i,'available_hours':.09*i,'productive_hours':.07*i,'production_tonnes':10*i,'coolant_temperature':[80,84,88,95,106,110][i],'hydraulic_pressure':[140,142,145,143,146,145][i]},'fault':({'spn':110,'fmi':0,'vendor':['DEMO-UNKNOWN']} if i>=4 else {})})
        readings = [normalize(adapter.translate(record)) for record in raw]
        print('1. COLLECTED 6 synthetic observations; source fields translated by Python.')
        with tempfile.TemporaryDirectory(prefix='tmm-python-demo-') as temp:
            queue = Outbox(str(Path(temp)/'outbox.sqlite3'))
            try:
                for reading in readings: queue.enqueue(reading)
                print('2. QUEUED 6 observations on disk before transfer.')
                retries = []
                sent = queue.flush(endpoint,'python-demo',ready['token'],retry_limit=1,delay=lambda seconds: retries.append(seconds))
                pending = queue.db.execute('SELECT COUNT(*) FROM pending').fetchone()[0]
                assert retries == [1] and sent == 6 and pending == 0
                print('3. TRANSFERRED 6 after automatic recovery from an injected HTTP 503 outage.')
                duplicate = send(endpoint,'python-demo',ready['token'],[readings[0]])
                assert duplicate['results'][0]['status'] == 'duplicate'
            finally:
                queue.close()
        deadline = time.monotonic()+30
        while time.monotonic()<deadline:
            with urllib.request.urlopen(ready['url']+'/demo/state',timeout=5) as response:
                state=json.load(response)
            if state['schedulerError']: raise RuntimeError(state['schedulerError'])
            if len(state['receipts'])==6 and len(state['reports'])==3: break
            time.sleep(.25)
        assert len(state['readings'])==6, 'Stored reading count differs'
        assert len(state['receipts'])==6, 'Automatic analysis did not complete'
        assert len(state['reports'])==3, 'Automatic reports did not complete'
        assert all(r['source_mode']=='simulation' for r in state['reports'])
        assert any(f['diagnostic_code']=='SPN 110 FMI 0' and 'Engine coolant temperature' in f['details'] for f in state['findings'])
        assert any(f['diagnostic_code']=='DEMO-UNKNOWN' and 'definition required' in f['details'] for f in state['findings'])
        assert state['registeredHourMeter']==1000 and not state['deliveries']
        metrics = state['reports'][0]['metrics']
        assert metrics['availability_percent'] == 90
        assert metrics['utilisation_percent'] == 77.78
        assert metrics['production_tonnes'] == 50
        assert {r['period'] for r in state['reports']} == {'daily','weekly','monthly'}
        print('4. STORED 6 unique readings; duplicate replay rejected safely.')
        print('5. ANALYSED all 6 automatically; J1939 recognised; unknown code flagged for definition.')
        print('6. REPORTED 3 saved reports through the timer-driven TMM scheduler; no processing button.')
        evidence={'run_at':now.isoformat(),'scope':'Isolated local simulation using actual TMM modules; no staging or production writes','checks':{'automatic_retry':True,'pending_queue':pending,'duplicate_prevention':True,'analysed':6,'saved_reports':3,'no_external_email':True,'live_meter_unchanged':True},'source_records':raw,'translated_readings':readings,'result':state}
        (args.output/'evidence.json').write_text(json.dumps(evidence,indent=2),encoding='utf8')
        (args.output/'mapping.json').write_text(json.dumps(mapping,indent=2),encoding='utf8')
        (args.output/'source.ndjson').write_text(''.join(json.dumps(r)+'\n' for r in raw),encoding='utf8')
        findings=''.join('<tr><td>'+html.escape(str(f.get('diagnostic_code') or f['category']))+'</td><td>'+html.escape(f['details'])+'</td></tr>' for f in state['findings'])
        report=html.escape(json.dumps(state['reports'],indent=2))
        document=f'''<!doctype html><meta charset="utf-8"><title>TMM Python pipeline evidence</title><style>body{{font:17px system-ui;background:#eef3f8;color:#16324b;margin:0}}main{{max-width:1100px;margin:auto;padding:40px}}h1{{font-size:36px}}.badge{{color:#087d75;font-weight:750}}section{{background:white;padding:26px;border-radius:16px;margin:20px 0}}.grid{{display:grid;grid-template-columns:repeat(3,1fr);gap:16px}}strong{{display:block;font-size:32px}}td,th{{text-align:left;padding:12px;border-bottom:1px solid #dde5ef}}pre{{white-space:pre-wrap;overflow-wrap:anywhere;font-size:14px}}@media(max-width:700px){{.grid{{grid-template-columns:1fr}}}}</style><main><p class="badge">TMM ASSET HEALTH · PYTHON INTEGRATION · SIMULATED DATA</p><h1>One automatic pipeline. Verified locally.</h1><p>Run: {now.isoformat()}. Actual Python adapter and transfer queue → actual TMM intake, storage, fault analysis and scheduled reporting.</p><div class="grid"><section><strong>6 / 6</strong>Readings stored and analysed</section><section><strong>3</strong>Automatically saved reports</section><section><strong>PASS</strong>Retry and duplicate protection</section></div><section><h2>What happened automatically</h2><ol><li>Generated six labelled synthetic machine observations.</li><li>Translated source fields and units through the Python adapter.</li><li>Saved observations in a durable queue before sending.</li><li>Recovered from a deliberate temporary transfer failure.</li><li>Stored six unique readings; recognised a replay as duplicate.</li><li>The background timer analysed readings and saved three reports.</li></ol></section><section><h2>Calculated from the received counters</h2><table><tr><th>Availability</th><th>Utilisation</th><th>Production</th><th>Latest hour meter</th></tr><tr><td>{metrics['availability_percent']}%</td><td>{metrics['utilisation_percent']}%</td><td>{metrics['production_tonnes']} t</td><td>{state['reports'][0]['last_hours']} h</td></tr></table><p>These are synthetic values over a 30-minute observation window, not a full working day. Availability = available ÷ scheduled hours; utilisation = productive ÷ available hours.</p></section><section><h2>Fault findings from the actual analyser</h2><table><tr><th>Code / category</th><th>Finding</th></tr>{findings}</table></section><section><h2>Scope of this proof</h2><p>This ran in a disposable local SQLite database. Your online software was not changed. Python handles collection simulation, translation and transfer; the existing JavaScript/TypeScript TMM backend handles analysis and reporting. The local demonstration timer runs every two seconds; deployment uses its configured schedule.</p><p>No actual machine, company API, external email delivery or confirmed root cause was tested. No records were deleted from your software. Unknown fault definitions remain unknown.</p></section><section><h2>Saved engineering report contents</h2><details><summary>Read the three generated reports</summary><pre>{report}</pre></details></section></main>'''
        (args.output/'report.html').write_text(document,encoding='utf8')
        print('PASS — Evidence: '+str(args.output/'report.html'))
    finally:
        process.terminate()
        try: process.wait(timeout=5)
        except subprocess.TimeoutExpired:
            process.kill();process.wait()

if __name__ == '__main__': main()
