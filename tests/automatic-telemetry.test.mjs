import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { stripTypeScriptTypes } from 'node:module';
import { DatabaseSync } from 'node:sqlite';
import { createServer } from 'node:http';
import { spawn } from 'node:child_process';
import vm from 'node:vm';

// Execute the actual intake, storage, analyser and scheduled report code against
// SQLite. Only the unrelated legacy router fallback is stubbed.
const fallback = `const currentApp={fetch:async()=>new Response('fallback',{status:404})};`;
const dataURL = source => 'data:text/javascript;base64,' + Buffer.from(stripTypeScriptTypes(source)+'\n//# sourceURL=telemetry-under-test.js').toString('base64');
const storage = readFileSync(new URL('../worker/router-telemetry-ready.ts', import.meta.url), 'utf8')
  .replace('import currentApp from "./router-month-end";', fallback);
const automation=readFileSync(new URL('../worker/telemetry-automation.ts',import.meta.url),'utf8');
const automationModule=await import(dataURL(automation));
const router = readFileSync(new URL('../worker/router-telemetry-ingestion-v2.ts', import.meta.url), 'utf8')
  .replace('"./router-telemetry-ready"', JSON.stringify(dataURL(storage)))
  .replace('"./telemetry-automation"', JSON.stringify(dataURL(automation)));
const app = (await import(dataURL(router))).default;
const digest = async v => Buffer.from(await crypto.subtle.digest('SHA-256', new TextEncoder().encode(v))).toString('hex');
const ctx = { waitUntil() {}, passThroughOnException() {} };

function database() {
  const sql = new DatabaseSync(':memory:');
  sql.exec(`CREATE TABLE companies(id INTEGER PRIMARY KEY,name TEXT);
    CREATE TABLE machines(id INTEGER PRIMARY KEY,company_id INTEGER,fleet_number TEXT,operating_hours REAL,next_service_hours REAL,site TEXT,status TEXT,category TEXT,created_at TEXT);
    CREATE TABLE contractor_accounts(id INTEGER PRIMARY KEY,company_id INTEGER,role TEXT,full_name TEXT,status TEXT,email TEXT);
    CREATE TABLE contractor_sessions(company_id INTEGER,account_id INTEGER,token_hash TEXT,active_role TEXT,expires_at TEXT);
    INSERT INTO companies VALUES(1,'Test One'),(2,'Test Two');
    INSERT INTO machines(id,company_id,fleet_number,operating_hours,next_service_hours,site,status) VALUES(1,1,'SAS ADT 027',1000,1500,'North','active'),(2,2,'SECOND',2000,2500,'South','active');
    INSERT INTO contractor_accounts VALUES(1,1,'engineer','Engineer One','active','one@example.test'),(2,2,'engineer','Engineer Two','active','two@example.test');`);
  let failure=null;
  const DB = { prepare(query) {
    let values = [];
    return { bind(...args) { values = args; return this; },
      async first() { return sql.prepare(query).get(...values) ?? null; },
      async all() { return { results: sql.prepare(query).all(...values) }; },
      async run() { if(failure&&query.includes(failure)){failure=null;throw Error('Injected transient database failure')} const r = sql.prepare(query).run(...values); return {meta:{last_row_id:Number(r.lastInsertRowid),changes:Number(r.changes)}}; }
    };
  }};
  return {sql,env:{DB},failNext:query=>{failure=query}};
}
const count = (sql, table) => sql.prepare('SELECT COUNT(*) n FROM '+table).get().n;
async function intake(env, payload, source='test-source', token='test-token') {
  return app.fetch(new Request('https://test.invalid/api/telemetry/v2', {method:'POST',headers:{'content-type':'application/json','x-telemetry-source':source,authorization:'Bearer '+token},body:JSON.stringify(payload)}),env,ctx);
}
async function configure(env, sql) {
  assert.equal((await intake(env,{})).status,401);
  sql.prepare(`INSERT INTO telemetry_connections_v2(company_id,provider,connection_name,source_key,token_hash,status,created_by,created_at) VALUES(1,'other','Test','test-source',?,'active',1,?)`).run(await digest('test-token'),new Date().toISOString());
  sql.exec(`INSERT INTO telemetry_machine_map_v2(company_id,connection_id,external_machine_id,machine_id,created_at) VALUES(1,1,'EXT-ONE','SAS ADT 027','now');`);
}
const reading = (extra={}) => ({external_machine_id:'EXT-ONE',event_id:crypto.randomUUID(),timestamp:new Date().toISOString(),test_data:true,engine_hours:1245,coolant_temperature:110,fault_codes:[{spn:110,fmi:0}],...extra});

test('fresh intake creates storage, normalizes J1939, deduplicates and isolates simulation', async()=>{
  const {sql,env}=database(); await configure(env,sql);
  const p=reading(); const body=await (await intake(env,p)).json();
  assert.equal(body.results[0].status,'accepted',JSON.stringify(body));
  assert.equal(sql.prepare('SELECT fault_code FROM machine_telemetry_v1').get().fault_code,'SPN 110 FMI 0');
  assert.equal((await (await intake(env,p)).json()).results[0].status,'duplicate');
  assert.equal(count(sql,'machine_telemetry_v1'),1);
  assert.equal(sql.prepare('SELECT operating_hours FROM machines WHERE id=1').get().operating_hours,1000);
  assert.equal(count(sql,'telemetry_alerts_v1'),0);
  assert.match(sql.prepare('SELECT source FROM machine_telemetry_v1').get().source,/SIMULATED|staging-test/);
});

test('invalid readings quarantine rather than contaminating stored measurements',async()=>{
  const {sql,env}=database(); await configure(env,sql);
  for(const extra of [{external_machine_id:'SECOND'},{coolant_temperature:'broken'},{latitude:'bad'},{rpm:'NaN'},{engine_hours:-1},{fuel_level:101},{timestamp:'bad'}]){
    const body=await (await intake(env,reading(extra))).json();
    assert.equal(body.results[0].status,'quarantined',JSON.stringify(extra));
  }
  assert.equal(count(sql,'machine_telemetry_v1'),0);
  assert.equal(count(sql,'telemetry_quarantine_v2'),7);
});

test('scheduler completes intake -> storage -> findings -> daily/weekly/monthly reports without UI requests',async()=>{
  const {sql,env}=database(); await configure(env,sql);
  assert.equal((await (await intake(env,reading())).json()).results[0].status,'accepted');
  const controller={scheduledTime:Date.now(),cron:'*/15 * * * *',noRetry(){}};
  await app.scheduled(controller,env,ctx);
  assert.equal(sql.prepare('SELECT last_status FROM telemetry_simulator_v2 WHERE company_id=1').get().last_status,'accepted');
  assert.ok(count(sql,'telemetry_condition_findings_v2')>=2);
  assert.equal(count(sql,'telemetry_report_snapshots_v2'),3);
  assert.equal(count(sql,'telemetry_report_documents_v2'),3);
  const report=JSON.parse(sql.prepare('SELECT report_json FROM telemetry_report_documents_v2 LIMIT 1').get().report_json);
  assert.ok(report.findings.some(f=>f.diagnostic_code==='SPN 110 FMI 0'));
  assert.equal(report.source_mode,'simulation');
  const finding=sql.prepare("SELECT * FROM telemetry_condition_findings_v2 WHERE diagnostic_code='SPN 110 FMI 0'").get();
  assert.match(finding.details,/Engine coolant temperature/);
  assert.equal(finding.source_mode,'simulation');
  const before=count(sql,'machine_telemetry_v1');
  await app.scheduled(controller,env,ctx);
  assert.equal(count(sql,'machine_telemetry_v1'),before,'replayed cron must not duplicate readings');
  assert.equal(sql.prepare('SELECT last_status FROM telemetry_simulator_v2 WHERE company_id=1').get().last_status,'accepted');
  assert.equal(count(sql,'telemetry_report_snapshots_v2'),3);
  assert.equal(sql.prepare('SELECT operating_hours FROM machines WHERE id=1').get().operating_hours,1000);
});

async function signIn(sql, company=1){
  const secret='session-'+company;
  sql.prepare("INSERT INTO contractor_sessions VALUES(?,?,?,'engineer',?)").run(company,company,await digest(secret),new Date(Date.now()+3600000).toISOString());
  return {cookie:'sas_contractor_v2='+secret};
}

test('pre-generated report pages, status and diagnostic views share company-isolated records',async()=>{
  const {sql,env}=database();await configure(env,sql);
  await intake(env,reading({fault_codes:[{spn:110,fmi:0},{spn:99999,fmi:2},'CAT-UNKNOWN']}));
  await app.scheduled({scheduledTime:Date.now(),cron:'*/15 * * * *'},env,ctx);
  const headers=await signIn(sql),otherHeaders=await signIn(sql,2);
  const id=sql.prepare('SELECT id FROM telemetry_report_snapshots_v2 LIMIT 1').get().id;
  const get=(path,h=headers)=>app.fetch(new Request('https://test.invalid'+path,{headers:h}),env,ctx);
  const saved=await (await get('/telemetry/connections/report-document?id='+id+'&format=json')).json();
  assert.ok(saved.findings.some(f=>f.diagnostic_code==='CAT-UNKNOWN'&&f.details.includes('OEM definition required')));
  assert.ok(saved.findings.some(f=>f.diagnostic_code==='SPN 99999 FMI 2'&&f.details.includes('not yet verified')));
  assert.equal((await get('/telemetry/connections/report-document?id='+id,otherHeaders)).status,404);
  assert.equal((await get('/telemetry/connections/report-document?id='+id,{})).status,303);
  const html=await (await get('/telemetry/connections/report-document?id='+id)).text();
  assert.match(html,/generated and saved automatically/);
  assert.match(html,/Engine coolant temperature/);
  const status=await (await get('/telemetry/connections/pipeline-status?format=json')).json();
  assert.equal(status.complete_simulation_cycle_observed,true);
  const other=await (await get('/telemetry/connections/pipeline-status?format=json',otherHeaders)).json();
  assert.equal(other.storage.n,0);assert.equal(other.reports.length,0);
  for(const path of ['/telemetry/connections/scheduled-reports','/telemetry/connections/automatic-analysis','/telemetry/connections/diagnostic-library?code=SPN%20110%20FMI%200'])assert.equal((await get(path)).status,200);
});

test('disabled simulator remains disabled and normal cron retries do not duplicate findings',async()=>{
  const {sql,env}=database();await configure(env,sql);await intake(env,reading());
  const controller={scheduledTime:Date.now(),cron:'*/15 * * * *'};
  await app.scheduled(controller,env,ctx);
  const findings=count(sql,'telemetry_condition_findings_v2');
  await app.scheduled(controller,env,ctx);
  assert.equal(count(sql,'telemetry_condition_findings_v2'),findings);
  sql.exec('UPDATE telemetry_simulator_v2 SET enabled=0');
  const readings=count(sql,'machine_telemetry_v1');
  await app.scheduled({...controller,scheduledTime:Date.now()+900000},env,ctx);
  assert.equal(count(sql,'machine_telemetry_v1'),readings);
});

test('Python bridge transfers structured fault codes to actual intake and reports partial rejection',async()=>{
  const {sql,env}=database();await configure(env,sql);
  const server=createServer(async(req,res)=>{
    try{
      let body='';for await(const part of req)body+=part;
      const response=await app.fetch(new Request('https://test.invalid'+req.url,{method:req.method,headers:req.headers,body}),env,ctx);
      res.writeHead(response.status,{'content-type':'application/json'});res.end(await response.text());
    }catch(error){res.writeHead(500);res.end(JSON.stringify({error:error.message}));}
  });
  await new Promise(resolve=>server.listen(0,'127.0.0.1',resolve));
  const endpoint='http://127.0.0.1:'+server.address().port+'/api/telemetry/v2';
  const run=record=>new Promise((resolve,reject)=>{
    // HTTP is used only inside this local integration harness; the CLI requires HTTPS.
    const code=`import importlib.util,json,sys; s=importlib.util.spec_from_file_location('bridge','integrations/python/tmm_telemetry_bridge.py');m=importlib.util.module_from_spec(s);s.loader.exec_module(m);r=m.normalize(json.loads(sys.stdin.readline()));print(json.dumps(m.send(sys.argv[1],'test-source','test-token',[r])))`;
    const child=spawn('python',['-c',code,endpoint],{cwd:new URL('..',import.meta.url)});
    let output='';child.stdout.on('data',b=>output+=b);child.stderr.on('data',b=>output+=b);child.on('error',reject);child.on('close',exit=>resolve({exit,output}));child.stdin.end(JSON.stringify(record)+'\n');
  });
  try{
    const good=await run(reading());assert.equal(good.exit,0,good.output);
    assert.equal(sql.prepare('SELECT fault_code FROM machine_telemetry_v1').get().fault_code,'SPN 110 FMI 0');
    assert.match(sql.prepare('SELECT source FROM machine_telemetry_v1').get().source,/SIMULATED/);
    const bad=await run(reading({external_machine_id:'UNMAPPED'}));assert.notEqual(bad.exit,0);assert.match(bad.output,/did not accept every reading/);
  }finally{await new Promise(resolve=>server.close(resolve));}
});

test('failed transfers recover on replay, including failure after telemetry was saved',async()=>{
  for(const stage of ['INSERT OR IGNORE INTO machine_telemetry_v1',"UPDATE telemetry_ingest_v2 SET status='accepted'"]){
    const {sql,env,failNext}=database();await configure(env,sql);
    const p=reading();failNext(stage);
    const failed=await (await intake(env,p)).json();assert.equal(failed.results[0].status,'failed');
    const recovered=await (await intake(env,p)).json();assert.equal(recovered.results[0].status,'accepted',JSON.stringify(recovered));
    assert.equal(count(sql,'machine_telemetry_v1'),1);
    assert.equal(count(sql,'telemetry_ingest_v2'),1);
    assert.equal(sql.prepare('SELECT status,error FROM telemetry_ingest_v2').get().error,null);
  }
});

test('replaying a quarantined event never reports success; event IDs cannot change payload',async()=>{
  const {sql,env}=database();await configure(env,sql);
  const bad=reading({external_machine_id:'UNKNOWN'});
  assert.equal((await (await intake(env,bad)).json()).ok,false);
  const replay=await (await intake(env,bad)).json();assert.equal(replay.ok,false);assert.equal(replay.results[0].status,'quarantined');
  const good=reading();await intake(env,good);
  const changed=await (await intake(env,{...good,coolant_temperature:90})).json();assert.equal(changed.results[0].status,'rejected');
  assert.equal(count(sql,'machine_telemetry_v1'),1);
});

test('multiple machines and companies produce separate reports and simulation never enters live fleet metrics',async()=>{
  const {sql,env}=database();await configure(env,sql);
  sql.exec("INSERT INTO machines(id,company_id,fleet_number,operating_hours,next_service_hours,site,status) VALUES(3,1,'FIRST-SECOND',1500,1750,'North','active'); INSERT INTO telemetry_machine_map_v2(company_id,connection_id,external_machine_id,machine_id,created_at) VALUES(1,1,'EXT-TWO','FIRST-SECOND','now');");
  sql.prepare("INSERT INTO telemetry_connections_v2(company_id,provider,connection_name,source_key,token_hash,status,created_by,created_at) VALUES(2,'other','Second','second-source',?,'active',2,'now')").run(await digest('second-token'));
  sql.exec("INSERT INTO telemetry_machine_map_v2(company_id,connection_id,external_machine_id,machine_id,created_at) VALUES(2,2,'EXT-THREE','SECOND','now')");
  await intake(env,reading());
  await intake(env,reading({external_machine_id:'EXT-TWO',fault_codes:['UNKNOWN-TWO']}));
  await intake(env,reading({external_machine_id:'EXT-THREE',fault_codes:[{spn:110,fmi:1}]}),'second-source','second-token');
  await app.scheduled({scheduledTime:Date.now(),cron:'*/15 * * * *'},env,ctx);
  assert.equal(count(sql,'telemetry_report_documents_v2'),9);
  const reports=sql.prepare('SELECT company_id,report_json FROM telemetry_report_documents_v2').all();
  for(const row of reports){
    const report=JSON.parse(row.report_json);
    assert.ok(report.findings.every(f=>report.machine_id==='SECOND'?f.diagnostic_code!=='UNKNOWN-TWO':f.diagnostic_code!=='SPN 110 FMI 1'));
    assert.equal(report.company_id,row.company_id);
  }
  const headers=await signIn(sql);
  const metrics=await app.fetch(new Request('https://test.invalid/api/telemetry/fleet-metrics',{headers}),env,ctx);
  assert.equal(metrics.status,200);
  const data=await metrics.json();
  assert.equal(data.coverage.machines_with_readings,0);
  assert.equal(data.summary.operating_hours,null);
});

async function deliverySettings(sql,enabled=1){
 sql.prepare("INSERT INTO telemetry_automation_settings_v3(company_id,recipients_json,delivery_enabled,report_hour_sast,updated_by,updated_at) VALUES(1,?, ?,0,1,?)").run(JSON.stringify(['engineer@example.test']),enabled,new Date().toISOString());
}

test('live intake automatically produces sourced fault findings, approved-limit alerts and saved live reports',async()=>{
 const {sql,env}=database();await configure(env,sql);await deliverySettings(sql);
 sql.prepare("INSERT INTO telemetry_machine_limits_v3(company_id,machine_id,metric,unit,comparison,warning_value,critical_value,reference,approved_by,updated_at) VALUES(1,'SAS ADT 027','coolant_temperature','degC','high',100,108,'Test-only approved specification',1,?)").run(new Date().toISOString());
 const p=reading({test_data:false,fault_codes:[{spn:100,fmi:1},'UNMAPPED-OEM'],units:{coolant_temperature:'degC'}});
 assert.equal((await (await intake(env,p)).json()).ok,true);
 await app.scheduled({scheduledTime:Date.now(),cron:'*/15 * * * *'},env,ctx);
 const reports=sql.prepare("SELECT report_json FROM telemetry_report_documents_v2").all().map(r=>JSON.parse(r.report_json));
 assert.equal(reports.length,3);assert.ok(reports.every(r=>r.source_mode==='live'));
 assert.ok(reports[0].findings.some(f=>f.diagnostic_code==='SPN 100 FMI 1'&&f.details.includes('Engine oil pressure')));
 assert.ok(reports[0].findings.some(f=>f.diagnostic_code==='UNMAPPED-OEM'&&f.details.includes('definition required')));
 assert.ok(reports[0].findings.some(f=>f.category==='configured_limit'&&f.severity==='critical'));
 assert.equal(count(sql,'telemetry_alerts_v1'),0,'unconfigured legacy numeric rules must not create guessed alarms');
 const outbox=count(sql,'telemetry_delivery_outbox_v3');assert.ok(outbox>=4);
 assert.equal(sql.prepare("SELECT COUNT(*) n FROM telemetry_delivery_outbox_v3 WHERE status='sent'").get().n,0,'no provider credentials means no send claims');
 await app.scheduled({scheduledTime:Date.now(),cron:'*/15 * * * *'},env,ctx);
 assert.equal(count(sql,'telemetry_delivery_outbox_v3'),outbox,'replayed processing must not duplicate notification jobs');
 const headers=await signIn(sql);
 const page=await app.fetch(new Request('https://test.invalid/telemetry/connections/report-document?id=1',{headers}),env,ctx);
 assert.match(await page.text(),/LIVE RECEIVED TELEMETRY/);
 const data=await (await app.fetch(new Request('https://test.invalid/api/telemetry/automatic?site=North',{headers}),env,ctx)).json();
 assert.equal(data.machines[0].reading_count,1);assert.equal(data.machines[0].production_tonnes,null);assert.equal(data.analysis_pending,0);
 const wrongSite=await (await app.fetch(new Request('https://test.invalid/api/telemetry/automatic?site=South',{headers}),env,ctx)).json();assert.equal(wrongSite.machines.length,0);
});

test('missing source units and stopped engines never produce configured pressure alarms',async()=>{
 const {sql,env}=database();await configure(env,sql);
 sql.exec("INSERT INTO telemetry_machine_limits_v3(company_id,machine_id,metric,unit,comparison,warning_value,critical_value,reference,approved_by,updated_at) VALUES(1,'SAS ADT 027','engine_oil_pressure','kPa','low',150,100,'Test-only pressure reference',1,'now')");
 await intake(env,reading({test_data:false,fault_codes:[],engine_oil_pressure:1,ignition_status:'off',rpm:0,units:{engine_oil_pressure:'kPa'}}));
 await intake(env,reading({test_data:false,fault_codes:[],engine_oil_pressure:1,ignition_status:'on',rpm:1000,units:{engine_oil_pressure:'psi'}}));
 await app.scheduled({scheduledTime:Date.now(),cron:'*/15 * * * *'},env,ctx);
 assert.equal(sql.prepare("SELECT COUNT(*) n FROM telemetry_condition_findings_v2 WHERE category='configured_limit'").get().n,0);
 assert.equal(sql.prepare("SELECT COUNT(*) n FROM telemetry_condition_findings_v2 WHERE category='units_required'").get().n,1);
});

test('delivery retries retain the same provider idempotency key; simulation never queues external mail',async()=>{
 const {sql,env}=database();await configure(env,sql);await deliverySettings(sql);
 await intake(env,reading({test_data:false}));
 await app.scheduled({scheduledTime:Date.now(),cron:'*/15 * * * *'},env,ctx);
 const job=sql.prepare('SELECT * FROM telemetry_delivery_outbox_v3 ORDER BY id LIMIT 1').get();
 sql.prepare("UPDATE telemetry_delivery_outbox_v3 SET status='cancelled' WHERE id<>?").run(job.id);
 const at=new Date(Date.now()+16*60000).toISOString(),requests=[];
 env.RESEND_API_KEY='test-only-not-a-real-key';
 const failing=async(url,options)=>{requests.push(options);return Response.json({message:'Temporary outage'},{status:503})};
 await automationModule.dispatchDeliveries(env,at,failing);
 assert.equal(sql.prepare('SELECT status FROM telemetry_delivery_outbox_v3 WHERE id=?').get(job.id).status,'retry');
 const success=async(url,options)=>{requests.push(options);return Response.json({id:'fake-provider-accepted'})};
 await automationModule.dispatchDeliveries(env,new Date(Date.parse(at)+900000).toISOString(),success);
 assert.equal(sql.prepare('SELECT status FROM telemetry_delivery_outbox_v3 WHERE id=?').get(job.id).status,'sent');
 assert.equal(requests[0].headers['Idempotency-Key'],requests[1].headers['Idempotency-Key']);
 assert.equal(requests[0].body,requests[1].body);
 await automationModule.dispatchDeliveries(env,new Date(Date.parse(at)+1800000).toISOString(),success);assert.equal(requests.length,2);
 delete env.RESEND_API_KEY;
 const before=count(sql,'telemetry_delivery_outbox_v3');await intake(env,reading({test_data:true}));
 await app.scheduled({scheduledTime:Date.now(),cron:'*/15 * * * *'},env,ctx);assert.equal(count(sql,'telemetry_delivery_outbox_v3'),before);
});

test('provider acceptance followed by a database failure recovers with the same request identity',async()=>{
 const {sql,env,failNext}=database();await configure(env,sql);await deliverySettings(sql);await intake(env,reading({test_data:false}));
 await app.scheduled({scheduledTime:Date.now(),cron:'*/15 * * * *'},env,ctx);
 const job=sql.prepare('SELECT * FROM telemetry_delivery_outbox_v3 ORDER BY id LIMIT 1').get();sql.prepare("UPDATE telemetry_delivery_outbox_v3 SET status='cancelled' WHERE id<>?").run(job.id);
 env.RESEND_API_KEY='test-only';const calls=[];const provider=async(url,opts)=>{calls.push(opts);return Response.json({id:'same-provider-id'})};
 const at=new Date(Date.now()+16*60000).toISOString();failNext("UPDATE telemetry_delivery_outbox_v3 SET status='sent'");
 await automationModule.dispatchDeliveries(env,at,provider);await automationModule.dispatchDeliveries(env,new Date(Date.parse(at)+900000).toISOString(),provider);
 assert.equal(calls.length,2);assert.equal(calls[0].headers['Idempotency-Key'],calls[1].headers['Idempotency-Key']);
 assert.equal(sql.prepare('SELECT provider_id FROM telemetry_delivery_outbox_v3 WHERE id=?').get(job.id).provider_id,'same-provider-id');
});

test('measurement calculations require valid meter intervals and explicit counter semantics',()=>{
 const m=automationModule.measuredMetrics([
  {id:1,recorded_at:'2026-11-11T01:00:00Z',engine_hours:100,raw_json:JSON.stringify({idle_hours:10,production_tonnes:100,counter_semantics:{idle_hours:'cumulative',production_tonnes:'cumulative'}})},
  {id:2,recorded_at:'2026-11-11T02:00:00Z',engine_hours:100.75,raw_json:JSON.stringify({idle_hours:10.2,production_tonnes:125,counter_semantics:{idle_hours:'cumulative',production_tonnes:'cumulative'}})}
 ]);
 assert.equal(m.operating_hours,.75);assert.equal(m.engine_runtime_percent,75);assert.equal(m.idle_hours,.2);assert.equal(m.production_tonnes,25);assert.equal(m.confirmed_downtime_hours,null);assert.equal(m.availability_percent,null);
 const invalid=automationModule.measuredMetrics([{recorded_at:'2026-11-11T01:00:00Z',engine_hours:100},{recorded_at:'2026-11-11T02:00:00Z',engine_hours:90}]);assert.equal(invalid.operating_hours,null);
});

test('configuration is company-scoped, administrator-only and protected against cross-origin requests',async()=>{
 const {sql,env}=database();await configure(env,sql);const headers=await signIn(sql);
 const csrf=await digest('session-1'),post=(h,values)=>app.fetch(new Request('https://test.invalid/telemetry/connections/automation',{method:'POST',headers:h,body:new URLSearchParams({csrf,action:'delivery',recipients:'engineer@example.test',hour:'18',...values})}),env,ctx);
 assert.equal((await post({...headers,origin:'https://test.invalid'})).status,403);
 sql.exec("UPDATE contractor_accounts SET role='company_admin' WHERE id=1;UPDATE contractor_sessions SET active_role='company_admin' WHERE company_id=1");
 assert.equal((await post({...headers,origin:'https://evil.invalid'})).status,403);
 assert.equal((await post({...headers,origin:'https://test.invalid'},{csrf:'bad'})).status,403);
 assert.equal((await post({...headers,origin:'https://test.invalid'},{enabled:'on'})).status,303);
 assert.equal(sql.prepare('SELECT delivery_enabled FROM telemetry_automation_settings_v3 WHERE company_id=1').get().delivery_enabled,1);
 assert.equal(count(sql,'telemetry_delivery_outbox_v3'),0,'configuration must not itself send or fabricate a report');
});

test('report scheduling rotates through more than ten machines instead of starving later machines',async()=>{
 const {sql,env}=database();await configure(env,sql);
 const data=[];
 for(let i=0;i<25;i++){
  const fleet='ROTATE-'+String(i).padStart(2,'0'),external='EXT-'+fleet;
  sql.prepare("INSERT INTO machines(company_id,fleet_number,operating_hours,next_service_hours,site,status) VALUES(1,?,1000,1500,'North','active')").run(fleet);
  sql.prepare("INSERT INTO telemetry_machine_map_v2(company_id,connection_id,external_machine_id,machine_id,created_at) VALUES(1,1,?,?,'now')").run(external,fleet);
  data.push(reading({external_machine_id:external,fault_codes:[]}));
 }
 assert.equal((await (await intake(env,data)).json()).ok,true);
 for(let i=0;i<3;i++)await app.scheduled({scheduledTime:Date.now(),cron:'*/15 * * * *'},env,ctx);
 assert.equal(count(sql,'telemetry_analysis_receipts_v3'),25);
 assert.equal(count(sql,'telemetry_report_documents_v2'),75);
});

test('concurrent dispatchers claim a queued notification once',async()=>{
 const {sql,env}=database();await configure(env,sql);await deliverySettings(sql);await intake(env,reading({test_data:false}));
 await app.scheduled({scheduledTime:Date.now(),cron:'*/15 * * * *'},env,ctx);
 const job=sql.prepare('SELECT id FROM telemetry_delivery_outbox_v3 ORDER BY id LIMIT 1').get();sql.prepare("UPDATE telemetry_delivery_outbox_v3 SET status='cancelled' WHERE id<>?").run(job.id);
 env.RESEND_API_KEY='test-only';let calls=0;const provider=async()=>{calls++;return Response.json({id:'accepted-once'})};const at=new Date(Date.now()+16*60000).toISOString();
 await Promise.all([automationModule.dispatchDeliveries(env,at,provider),automationModule.dispatchDeliveries(env,at,provider)]);
 assert.equal(calls,1);assert.equal(sql.prepare('SELECT status FROM telemetry_delivery_outbox_v3 WHERE id=?').get(job.id).status,'sent');
});

test('all telemetry intake aliases use connection-scoped authentication and the same central table',async()=>{
 const {sql,env}=database();await configure(env,sql);
 for(const path of ['/api/telemetry','/api/telemetry/ingest','/api/telemetry/v2']){
  const headers={'content-type':'application/json','x-telemetry-source':'test-source',authorization:'Bearer test-token'};
  const response=await app.fetch(new Request('https://test.invalid'+path,{method:'POST',headers,body:JSON.stringify(reading())}),env,ctx);
  assert.equal((await response.json()).ok,true);
 }
 assert.equal(count(sql,'machine_telemetry_v1'),3);
});

test('equivalent and repeated J1939 identifiers share one finding and notification group',async()=>{
 const {sql,env}=database();await configure(env,sql);await deliverySettings(sql);
 await intake(env,reading({test_data:false,fault_codes:[' spn 000110 fmi 00 ','SPN 110 FMI 0','spn110fmi0']}));
 await intake(env,reading({test_data:false,fault_codes:['SPN 110 FMI 0']}));
 await app.scheduled({scheduledTime:Date.now(),cron:'*/15 * * * *'},env,ctx);
 const alerts=sql.prepare("SELECT * FROM telemetry_auto_alerts_v3 WHERE source_mode='live' AND rule_key LIKE 'diagnostic_code:%'").all();
 assert.equal(alerts.length,1);assert.equal(alerts[0].occurrences,2);
 assert.equal(sql.prepare("SELECT COUNT(*) n FROM telemetry_condition_findings_v2 WHERE source_mode='live'").get().n,2);
 assert.equal(sql.prepare("SELECT COUNT(*) n FROM telemetry_delivery_outbox_v3 WHERE kind='alert'").get().n,1);
});

test('invalid numeric shapes, simulation flags and timestamp metadata are quarantined',async()=>{
 const {sql,env}=database();await configure(env,sql);
 const cases=[{engine_hours:[]},{rpm:'   '},{fuel_litres:true},{battery_voltage:false},{engine_hours:'0x10'},{test_data:'true'},{units:[]},{counter_semantics:'cumulative'},{timestamp:new Date().toISOString().replace('Z','')},{fault_codes:[{spn:-1,fmi:0}]}];
 for(const extra of cases){const result=await (await intake(env,reading(extra))).json();assert.equal(result.results[0].status,'quarantined',JSON.stringify(extra));}
 assert.equal(count(sql,'machine_telemetry_v1'),0);
});

test('a transient analysis failure is retried automatically without blocking other readings',async()=>{
 const {sql,env,failNext}=database();await configure(env,sql);
 await intake(env,reading({test_data:false,event_id:'FAIL-FIRST'}));
 await intake(env,reading({test_data:false,event_id:'PASS-SECOND'}));
 failNext('INSERT OR IGNORE INTO telemetry_condition_findings_v2');
 const at=Date.now();await automationModule.runTelemetryAutomation(env,()=>({code:'SPN 110 FMI 0',meaning:'Engine coolant temperature',system:'Engine cooling',severity:'review',verified:true}),at);
 assert.equal(count(sql,'telemetry_analysis_receipts_v3'),1);assert.equal(count(sql,'telemetry_analysis_failures_v3'),1);
 await automationModule.runTelemetryAutomation(env,()=>({code:'SPN 110 FMI 0',meaning:'Engine coolant temperature',system:'Engine cooling',severity:'review',verified:true}),at+16*60000);
 assert.equal(count(sql,'telemetry_analysis_receipts_v3'),2);assert.equal(count(sql,'telemetry_analysis_failures_v3'),0);
});

test('historical replay cannot replace the most recent alert state or double-count old observations',async()=>{
 const {sql,env}=database();await configure(env,sql);
 const now=Date.now();
 await intake(env,reading({test_data:false,timestamp:new Date(now).toISOString()}));
 await intake(env,reading({test_data:false,timestamp:new Date(now-7200000).toISOString()}));
 await app.scheduled({scheduledTime:now,cron:'*/15 * * * *'},env,ctx);
 const alert=sql.prepare("SELECT * FROM telemetry_auto_alerts_v3 WHERE source_mode='live'").get();
 assert.equal(alert.first_seen,new Date(now-7200000).toISOString());assert.equal(alert.last_seen,new Date(now).toISOString());
 assert.equal(alert.latest_telemetry_id,1);assert.equal(alert.occurrences,2);
});

async function dashboardHarness(search,fetcher){
 const html=await automationModule.automaticDashboard('UI Test',new URL('https://test.invalid/telemetry/automatic'+search)).text();
 const fields=Object.fromEntries(Object.entries({section:'dashboard',mode:'live',from:'',to:'',site:'',machine:''}).map(([name,value])=>[name,{name,value}]));
 const form={...fields,elements:Object.values(fields),addEventListener(name,callback){this.onchange=callback}};
 const nodes=Object.fromEntries(['status','cards','overviewCharts','machineCharts','coverageStrip','machineIdentity','attention','fleet','daily','sensors','findings','reports','notes'].map(name=>['#'+name,{textContent:'',innerHTML:''}]));
 const panels=['coverage','identity','overview','attention','machineCharts','definitions','fleet','daily','sensors','findings','reports','notes'].map(section=>({dataset:{section},hidden:false}));
 const timers=[];let interval;
 const context=vm.createContext({URLSearchParams,AbortController,FormData:class{constructor(f){this.f=f}*[Symbol.iterator](){for(const field of this.f.elements)yield[field.name,field.value]}},document:{querySelector:s=>s==='#filters'?form:nodes[s],querySelectorAll:()=>panels},location:{search},history:{replaceState(){}},fetch:fetcher,setTimeout(callback,delay){timers.push({callback,delay});return timers.length},clearTimeout(){},setInterval(callback){interval=callback},console});
 vm.runInContext(html.match(/<script>([\s\S]*?)<\/script>/)[1],context);
 const settle=()=>new Promise(resolve=>setImmediate(resolve));await settle();
 return {html,form,nodes,panels,timers,interval,settle};
}
function dashboardResponse(mode='live',to='2026-11-11'){return {ok:true,json:async()=>({source_mode:mode,filters:{from:'2026-11-04',to},sites:['North'],machines:[],reports:[],notes:[],analysis_pending:0,analysis_retrying:0,run:{}})}}

test('dashboard date windows roll automatically and explicit site/date filters persist',async()=>{
 const calls=[];let day='2026-11-11';
 const h=await dashboardHarness('?site=North',async url=>{calls.push(new URL(url,'https://test.invalid'));return dashboardResponse('live',day)});
 assert.match(h.html,/<option value="North" selected>/);assert.equal(calls[0].searchParams.get('site'),'North');assert.equal(calls[0].searchParams.has('from'),false);
 day='2026-11-12';await h.interval();assert.equal(h.form.to.value,day);assert.equal(calls[1].searchParams.has('to'),false);
 h.form.from.value='2026-11-01';h.form.onchange({target:h.form.from});await h.settle();assert.equal(calls.at(-1).searchParams.get('from'),'2026-11-01');
});

test('changing dashboard filters aborts the old refresh and ignores stale responses',async()=>{
 let resolveOld;const calls=[];
 const h=await dashboardHarness('',(url,options)=>{calls.push({url,options});return calls.length===1?new Promise(resolve=>{resolveOld=resolve}):Promise.resolve(dashboardResponse('simulation'))});
 h.form.site.value='New site';h.form.onchange({target:h.form.site});await h.settle();
 assert.equal(calls[0].options.signal.aborted,true);assert.match(h.nodes['#status'].textContent,/SIMULATED/);
 resolveOld(dashboardResponse('live'));await h.settle();assert.match(h.nodes['#status'].textContent,/SIMULATED/);
 await h.interval();assert.equal(calls.length,3);
});

test('dashboard refresh timeouts release the loop for automatic recovery',async()=>{
 let calls=0;
 const h=await dashboardHarness('',(url,options)=>{calls++;return calls===1?new Promise((resolve,reject)=>options.signal.addEventListener('abort',()=>reject(Object.assign(new Error('timeout'),{name:'AbortError'})))):Promise.resolve(dashboardResponse())});
 assert.equal(h.timers[0].delay,20000);h.timers[0].callback();await h.settle();assert.match(h.nodes['#status'].textContent,/automatic retry/);
 await h.interval();assert.equal(calls,2);assert.match(h.nodes['#status'].textContent,/LIVE SOURCE/);
});

test('partial persisted analysis and report failures recover without duplicate occurrences or starvation',async()=>{
 const {sql,env,failNext}=database();await configure(env,sql);
 await intake(env,reading({test_data:false,event_id:'FIRST'}));await intake(env,reading({test_data:false,event_id:'SECOND'}));
 const lookup=()=>({code:'SPN 110 FMI 0',meaning:'Engine coolant temperature',system:'Engine cooling',severity:'review',verified:true}),at=Date.now();
 failNext('INSERT INTO telemetry_auto_alerts_v3');await automationModule.runTelemetryAutomation(env,lookup,at);
 await automationModule.runTelemetryAutomation(env,lookup,at+16*60000);
 assert.equal(sql.prepare('SELECT occurrences FROM telemetry_auto_alerts_v3').get().occurrences,2);assert.equal(count(sql,'telemetry_analysis_receipts_v3'),2);
 failNext('INSERT INTO telemetry_report_snapshots_v2');await automationModule.runTelemetryAutomation(env,lookup,at+32*60000);
 assert.match(sql.prepare('SELECT last_error FROM telemetry_automation_runs_v3').get().last_error,/Report retry/);
 await automationModule.runTelemetryAutomation(env,lookup,at+48*60000);assert.equal(count(sql,'telemetry_report_documents_v2'),3);assert.equal(sql.prepare('SELECT last_error FROM telemetry_automation_runs_v3').get().last_error,null);
});

test('reordered JSON objects remain duplicate observations and preserve original audit payloads',async()=>{
 const {sql,env}=database();await configure(env,sql);
 for(const event_id of ['STABLE-JSON',undefined]){
  const original=reading({event_id,units:{coolant_temperature:'degC',rpm:'rpm'}});
  const reordered=Object.fromEntries(Object.entries(original).reverse());reordered.units={rpm:'rpm',coolant_temperature:'degC'};
  assert.equal((await (await intake(env,original)).json()).results[0].status,'accepted');
  assert.equal((await (await intake(env,reordered)).json()).results[0].status,'duplicate');
 }
 assert.equal(count(sql,'machine_telemetry_v1'),2);
});

test('truncated reports retain the latest readings and sensor values',async()=>{
 const {sql,env}=database();await configure(env,sql);
 const insert=sql.prepare("INSERT INTO machine_telemetry_v1(company_id,machine_id,recorded_at,engine_hours,source,raw_json,created_at) VALUES(1,'SAS ADT 027',?,?,'authorised-test',?,?)"),now=Date.now();
 sql.exec('BEGIN');for(let i=0;i<=10000;i++){const at=new Date(now-(10000-i)*1000).toISOString();insert.run(at,1000+i/3600,JSON.stringify({coolant_temperature:80+i/100000,units:{coolant_temperature:'degC'}}),at)}sql.exec('COMMIT');
 await automationModule.runTelemetryAutomation(env,()=>({code:'',meaning:'',system:'',severity:'review',verified:false}),now);
 const report=JSON.parse(sql.prepare('SELECT report_json FROM telemetry_report_documents_v2 LIMIT 1').get().report_json);
 assert.equal(report.readings_truncated,true);assert.equal(report.reading_count,10000);assert.equal(report.latest_sensors.coolant_temperature.value,80.1);
});

test('availability and utilisation use explicit scheduled, available and productive hours with complete coverage',()=>{
 const reading=(at,values,extra={})=>({recorded_at:at,raw_json:JSON.stringify({...values,units:{scheduled_hours:'h',available_hours:'h',productive_hours:'h'},counter_semantics:{scheduled_hours:'cumulative',available_hours:'cumulative',productive_hours:'cumulative'},...extra})});
 const a=reading('2026-11-11T00:00:00Z',{scheduled_hours:100,available_hours:80,productive_hours:60}),b=reading('2026-11-11T10:00:00Z',{scheduled_hours:110,available_hours:88,productive_hours:66});
 const m=automationModule.measuredMetrics([b,a]);assert.equal(m.availability_percent,80);assert.equal(m.utilisation_percent,75);assert.equal(m.scheduled_utilisation_percent,60);assert.equal(m.reported_downtime_hours,2);assert.equal(m.confirmed_downtime_hours,null);assert.equal(m.operating_hours,null,'KPI counters do not invent an engine meter');
 const noProductive=reading('2026-11-11T10:00:00Z',{scheduled_hours:110,available_hours:88});const partial=automationModule.measuredMetrics([a,noProductive]);assert.equal(partial.availability_percent,80);assert.equal(partial.utilisation_percent,null);
 for(const bad of [reading('2026-11-11T10:00:00Z',{scheduled_hours:110,available_hours:91,productive_hours:66}),reading('2026-11-11T10:00:00Z',{scheduled_hours:90,available_hours:88,productive_hours:66}),reading('2026-11-11T10:00:00Z',{scheduled_hours:110,available_hours:88,productive_hours:66},{units:{}}),reading('2026-11-11T10:00:00Z',{scheduled_hours:110,available_hours:88,productive_hours:66},{counter_semantics:{}})])assert.equal(automationModule.measuredMetrics([a,bad]).availability_percent,null);
 const noScheduled=reading('2026-11-11T10:00:00Z',{scheduled_hours:100,available_hours:80,productive_hours:60});assert.equal(automationModule.measuredMetrics([a,noScheduled]).availability_percent,null);
 assert.equal(automationModule.measuredMetrics([a,{recorded_at:'2026-11-11T05:00:00Z'},b]).availability_percent,null,'incomplete coverage must not look complete');
});

test('legacy fleet content keeps authorised forms and scripts inside the shared automatic shell',async()=>{
 const html='<html><head><style>.old{}</style><script>headInit()</script></head><body><aside>Old sidebar</aside><main class="main"><div class="content"><h1>Fleet</h1><form method="post" action="/company-admin/fleet/add"><input name="fleetNumber"></form><script>formInit()</script></div><footer class="foot">Old footer</footer></main><script>tailInit()</script></body></html>';
 const content=automationModule.companyPageContent(html);assert.match(content,/action="\/company-admin\/fleet\/add"/);assert.match(content,/headInit/);assert.match(content,/formInit/);assert.match(content,/tailInit/);assert.doesNotMatch(content,/Old sidebar|Old footer|\.old/);
 const shell=await automationModule.automationShell('Company',content,'simulation').text();assert.match(shell,/data-tmm-shell="automatic"/);assert.match(shell,/view=fleet&mode=simulation/);assert.match(shell,/Availability|Fleet/);assert.equal(automationModule.companyPageContent('<h1>Login</h1>'),null);
});

test('operational hour counters survive authenticated intake and flow into saved automatic report metrics',async()=>{
 const {sql,env}=database();await configure(env,sql);
 const now=Date.now(),values=[{scheduled_hours:100,available_hours:80,productive_hours:60},{scheduled_hours:101,available_hours:80.8,productive_hours:60.6}];
 for(let i=0;i<2;i++){const response=await intake(env,{external_machine_id:'EXT-ONE',event_id:'kpi-'+i,timestamp:new Date(now-3600000+i*3600000).toISOString(),...values[i],units:{scheduled_hours:'h',available_hours:'h',productive_hours:'h'},counter_semantics:{scheduled_hours:'cumulative',available_hours:'cumulative',productive_hours:'cumulative'}});const receipt=await response.json();assert.equal(receipt.results[0].status,"accepted",JSON.stringify(receipt));}
 await app.scheduled({},env,ctx);
 const reports=sql.prepare('SELECT report_json FROM telemetry_report_documents_v2').all().map(r=>JSON.parse(r.report_json));assert.ok(reports.length>=3);assert.equal(reports[0].metrics.availability_percent,80);assert.equal(reports[0].metrics.utilisation_percent,75);
});

async function discoveryAdmin(sql){const headers=await signIn(sql);sql.exec("UPDATE contractor_accounts SET role='company_admin' WHERE id=1;UPDATE contractor_sessions SET active_role='company_admin' WHERE company_id=1");return headers;}
const discoveryReading=(extra={})=>reading({external_machine_id:'NEW-SERIAL-42',test_data:false,asset:{serial_number:'SER-42',manufacturer:'Example',model:'Model 42',machine_type:'ADT',next_service_hours:1500,service_reference:'Source schedule'},engine_hours:1245,...extra});
const assignSite=async(env,headers,id,site,origin='https://test.invalid')=>app.fetch(new Request('https://test.invalid/telemetry/connections/discovered',{method:'POST',headers:{...headers,origin},body:new URLSearchParams({id:String(id),site,csrf:await digest('session-1')})}),env,ctx);

test('discovered machine registers from a site once and retained readings automatically reach reports despite interrupted replay',async()=>{
 const {sql,env,failNext}=database();await configure(env,sql);const p=discoveryReading();const receipt=await (await intake(env,p)).json(),id=receipt.results[0].discovery_id;assert.equal(receipt.results[0].status,'discovered');
 assert.equal((await (await intake(env,p)).json()).results[0].status,'discovered');assert.equal(count(sql,'telemetry_discovered_assets_v1'),1);assert.equal(count(sql,'machines'),2);
 // Subsequent readings need not resend identity metadata.
 const subsequent=discoveryReading({event_id:'next-before-site',timestamp:new Date(Date.now()+1000).toISOString(),asset:undefined,engine_hours:1246});assert.equal((await (await intake(env,subsequent)).json()).results[0].status,'discovered');
 const headers=await discoveryAdmin(sql);assert.equal((await assignSite(env,headers,id,'Mine North')).status,303);assert.equal((await assignSite(env,headers,id,'Mine North')).status,303);assert.equal(count(sql,'machines'),3);
 const machine=sql.prepare("SELECT * FROM machines WHERE site='Mine North'").get();assert.equal(machine.operating_hours,1246);assert.equal(machine.next_service_hours,1500);assert.equal(machine.category,'ADT');
 failNext("UPDATE telemetry_ingest_v2 SET status='accepted'");await app.scheduled({scheduledTime:Date.now()},env,ctx);await app.scheduled({scheduledTime:Date.now()},env,ctx);
 assert.equal(sql.prepare('SELECT status FROM telemetry_ingest_v2 WHERE event_key=?').get('1:'+p.event_id).status,'accepted');assert.equal(sql.prepare('SELECT COUNT(*) n FROM machine_telemetry_v1 WHERE machine_id=?').get(machine.fleet_number).n,2);assert.equal(sql.prepare('SELECT COUNT(*) n FROM telemetry_report_snapshots_v2 WHERE machine_id=?').get(machine.fleet_number).n,3);
 const newer=discoveryReading({timestamp:new Date(Date.now()+2000).toISOString(),asset:{next_service_hours:1750},engine_hours:1247});assert.equal((await (await intake(env,newer)).json()).results[0].status,'accepted');assert.equal(sql.prepare('SELECT next_service_hours FROM machines WHERE id=?').get(machine.id).next_service_hours,1750);
 assert.equal((await (await intake(env,discoveryReading({asset:{serial_number:'CHANGED'}}))).json()).results[0].status,'quarantined');
});

test('discovery is company-scoped and site assignment requires admin, same origin and valid token; unknown service is never 250 h',async()=>{
 const {sql,env}=database();await configure(env,sql);const id=(await (await intake(env,discoveryReading({asset:{model:'Unknown schedule'},engine_hours:null}))).json()).results[0].discovery_id;
 let headers=await signIn(sql);assert.equal((await assignSite(env,headers,id,'North')).status,403);headers=await discoveryAdmin(sql);assert.equal((await assignSite(env,headers,id,'North','https://evil.invalid')).status,403);assert.equal((await assignSite(env,headers,id+999,'North')).status,400);
 const bad=await app.fetch(new Request('https://test.invalid/telemetry/connections/discovered',{method:'POST',headers:{...headers,origin:'https://test.invalid'},body:new URLSearchParams({id:String(id),site:'North',csrf:'bad'})}),env,ctx);assert.equal(bad.status,403);
 const second=await signIn(sql,2),html=await (await app.fetch(new Request('https://test.invalid/telemetry/connections/discovered',{headers:second}),env,ctx)).text();assert.doesNotMatch(html,/Unknown schedule/);
 assert.equal((await assignSite(env,headers,id,'North')).status,303);assert.equal(sql.prepare("SELECT next_service_hours FROM machines WHERE fleet_number LIKE 'AUTO-%'").get().next_service_hours,null);
 assert.equal((await (await intake(env,discoveryReading({external_machine_id:'BAD-ASSET',asset:{model:'Bad',next_service_hours:-1}}))).json()).results[0].status,'quarantined');
});

test('simulation discovery cannot register real equipment; intervals require a source reference and pilot limits still apply',async()=>{
 const {sql,env}=database();await configure(env,sql);const headers=await discoveryAdmin(sql);const id=(await (await intake(env,discoveryReading({test_data:true}))).json()).results[0].discovery_id;assert.equal((await assignSite(env,headers,id,'North')).status,400);
 for(const [external,reference,expected] of [['NO-REF',null,null],['WITH-REF','Approved source schedule',1500]]){const r=await (await intake(env,discoveryReading({external_machine_id:external,asset:{model:'Interval model',service_interval_hours:500,last_service_hours:1000,...(reference?{service_reference:reference}:{})}}))).json();const m=JSON.parse(sql.prepare('SELECT metadata_json FROM telemetry_discovered_assets_v1 WHERE id=?').get(r.results[0].discovery_id).metadata_json);assert.equal(m.next_service_hours,expected);}
 sql.exec('CREATE TABLE company_pilot_limits_v1(company_id INTEGER,max_machines INTEGER,max_sites INTEGER); INSERT INTO company_pilot_limits_v1 VALUES(1,1,1)');const candidate=sql.prepare("SELECT id FROM telemetry_discovered_assets_v1 WHERE external_machine_id='WITH-REF'").get();assert.equal((await assignSite(env,headers,candidate.id,'North')).status,409);
});

test('compact overview uses weighted daily percentages, preserves missing days and limits priority items',()=>{
 const daily=(date,s,a,p,faults)=>({date,scheduled_hours:s,available_hours:a,productive_hours:p,fault_readings:faults});
 const machines=[{machine_id:'ONE',site:'North',daily_summaries:[daily('2026-11-10',10,8,6,2)],hours_to_service:5,service_status:'due_soon',stale:false},{machine_id:'TWO',site:'South',daily_summaries:[daily('2026-11-10',2,1,1,0)],hours_to_service:100,service_status:'on_track',stale:false}];
 const result=automationModule.fleetOverview(machines,'2026-11-09','2026-11-11');assert.equal(result.days.length,3);assert.equal(result.days[0].faults,null);assert.equal(result.days[1].availability,75);assert.equal(result.days[1].utilisation,77.78);assert.equal(result.days[1].faults,2);assert.equal(result.days[2].availability,null);assert.equal(result.attention.length,1);
 const incomplete=automationModule.fleetOverview([machines[0],{...machines[1],daily_summaries:[]}],'2026-11-10','2026-11-10');assert.equal(incomplete.days[0].availability,null);assert.equal(incomplete.days[0].faults,2);
 const large=automationModule.fleetOverview(Array.from({length:12},(_,i)=>({...machines[0],machine_id:'ID-'+i,service_status:i===10?'overdue':'due_soon'})),'2026-01-01','2026-11-11');assert.equal(large.days.length,90);assert.equal(large.days_limited,true);assert.equal(large.attention.length,8);assert.equal(large.attention_total,12);assert.equal(large.attention[0].machine_id,'ID-10');
});

test('dashboard hides detailed sections, renders honest chart empty states and keeps detail routes available',async()=>{
 const h=await dashboardHarness('',async()=>dashboardResponse());assert.equal(h.panels.find(p=>p.dataset.section==='daily').hidden,true);assert.equal(h.panels.find(p=>p.dataset.section==='overview').hidden,false);assert.match(h.nodes['#overviewCharts'].innerHTML,/Awaiting received machine readings/);assert.match(h.nodes['#cards'].innerHTML,/Fault observations<\/small><b aria-label="Unavailable">—/);assert.doesNotMatch(h.html,/<summary>More/);assert.match(h.html,/>Discovered machines<\/span><\/a>/);assert.match(h.html,/>Daily summaries<\/span><\/a>/);assert.match(h.html,/>Pipeline status<\/span><\/a>/);
 const section=await automationModule.automaticDashboard('Company',new URL('https://test.invalid/telemetry/automatic?section=health')).text();assert.match(section,/data-section="overview" hidden/);assert.doesNotMatch(section,/data-section="fleet" hidden/);
});

test('machine charts use received values and preserve gaps when source units change',async()=>{
 const point=(stamp,value,unit)=>({recorded_at:stamp,raw_json:JSON.stringify({coolant_temperature:value,units:{coolant_temperature:unit}})});
 const machine={machine_id:'REAL-READING-1',site:'North',daily_summaries:[],findings:[],readings:[point('2026-11-11T01:00:00Z',80,'degC'),point('2026-11-11T02:00:00Z',200,'unknown'),point('2026-11-11T03:00:00Z',90,'degC')]};
 const response=async()=>({ok:true,json:async()=>({...await dashboardResponse().json(),machines:[machine]})});
 const h=await dashboardHarness('?section=health&machine=REAL-READING-1',response);assert.match(h.nodes['#machineCharts'].innerHTML,/Coolant temperature history in degC/);assert.match(h.nodes['#machineCharts'].innerHTML,/80 degC/);assert.match(h.nodes['#machineCharts'].innerHTML,/90 degC/);assert.doesNotMatch(h.nodes['#machineCharts'].innerHTML,/200 unknown/);assert.match(h.nodes['#machineCharts'].innerHTML,/Awaiting two timestamped readings/,'pressure is not fabricated');
 machine.readings=[point('2026-11-11T01:00:00Z',[],'degC'),point('2026-11-11T02:00:00Z',true,'degC')];await h.interval();assert.doesNotMatch(h.nodes['#machineCharts'].innerHTML,/<circle/);assert.match(h.nodes['#machineCharts'].innerHTML,/Awaiting two timestamped readings/);
});


test('fleet command centre distinguishes freshness from health and labels generic imagery',async()=>{
 const machine={machine_id:'ADT-1',machine_type:'ADT',site:'North',reading_count:2,stale:false,current_hour_meter:1245,hours_to_service:5,daily_summaries:[],findings:[],readings:[]};
 const h=await dashboardHarness('',async()=>({ok:true,json:async()=>({...await dashboardResponse().json(),machines:[machine]})}));
 assert.match(h.nodes['#attention'].innerHTML,/Illustrative articulated dump truck; not an actual asset photo/);
 assert.match(h.nodes['#attention'].innerHTML,/1,245 h/);assert.match(h.nodes['#overviewCharts'].innerHTML,/1 fresh, 0 stale, 0 awaiting data/);
 assert.doesNotMatch(h.nodes['#attention'].innerHTML,/94%|Healthy/);
 machine.machine_type='Unknown';machine.stale=true;await h.interval();
 assert.doesNotMatch(h.nodes['#attention'].innerHTML,/equipment-photo/);assert.match(h.nodes['#attention'].innerHTML,/Photo not supplied/);
 assert.match(h.nodes['#overviewCharts'].innerHTML,/0 fresh, 1 stale, 0 awaiting data/);
});
