import assert from 'node:assert/strict';
import { test } from 'node:test';
import { Miniflare } from 'miniflare';
import { compatibilityDate } from 'workerd';
import { fileURLToPath } from 'node:url';

// Run the emitted Worker inside workerd, which supports cloudflare:workers.
// Importing a Worker bundle directly into Node is not a valid runtime check.
test('built Worker renders automatic dashboards and uses the same company-isolated telemetry API', async()=>{
 const runtime=new Miniflare({modules:true,scriptPath:fileURLToPath(new URL('../dist/server/index.js',import.meta.url)),modulesRoot:fileURLToPath(new URL('../dist/server',import.meta.url)),modulesRules:[{type:'ESModule',include:['**/*.js']}],compatibilityDate,compatibilityFlags:['nodejs_compat'],d1Databases:{DB:'automation-test'},r2Buckets:['BUCKET']});
 try{
  const login=await runtime.dispatchFetch('https://tmm.test/contractor-login');assert.equal(login.status,200);assert.match(await login.text(),/Sign in/);
  const db=await runtime.getD1Database('DB');
  for(const sql of [
   "CREATE TABLE companies(id INTEGER PRIMARY KEY,name TEXT,licence_status TEXT,expires_at TEXT,grace_days INTEGER)",
   "CREATE TABLE machines(id INTEGER PRIMARY KEY,company_id INTEGER,fleet_number TEXT,site TEXT,status TEXT,operating_hours REAL,next_service_hours REAL,category TEXT,created_at TEXT)",
   "CREATE TABLE contractor_accounts(id INTEGER PRIMARY KEY,company_id INTEGER,role TEXT,full_name TEXT,status TEXT,email TEXT,created_at TEXT)",
   "CREATE TABLE contractor_sessions(company_id INTEGER,account_id INTEGER,token_hash TEXT,active_role TEXT,expires_at TEXT)",
   "INSERT INTO companies VALUES(1,'Worker Test Company','trial','2099-01-01',0)",
   "INSERT INTO machines VALUES(1,1,'WORKER-01','Test Site','active',1000,1250,'ADT','now')",
   "INSERT INTO contractor_accounts VALUES(1,1,'engineer','Test Engineer','active','engineer@example.test','now')"
  ])await db.prepare(sql).run();
  const token='local-worker-session',hash=Buffer.from(await crypto.subtle.digest('SHA-256',new TextEncoder().encode(token))).toString('hex');
  await db.prepare("INSERT INTO contractor_sessions VALUES(1,1,?,'engineer',?)").bind(hash,new Date(Date.now()+3600000).toISOString()).run();
  const headers={cookie:'sas_contractor_v2='+token};
  for(const path of ['/contractor','/contractor?view=daily','/contractor?view=production','/contractor?view=maintenance','/contractor?view=alerts','/telemetry','/fleet-history?machine=WORKER-01']){
   const response=await runtime.dispatchFetch('https://tmm.test'+path,{headers});assert.equal(response.status,200,path);
   const body=await response.text();assert.match(body,/Automatic fleet monitoring/,path);assert.match(body,/Availability/);assert.match(body,/Utilisation/);assert.match(body,/setInterval\(load,60000\)/);assert.ok(!body.includes('Generate report'));
   for(const script of body.matchAll(/<script(?: [^>]*)?>([\s\S]*?)<\/script>/g))new Function(script[1]);
  }
  const fleetPage=await runtime.dispatchFetch('https://tmm.test/contractor?view=fleet&mode=simulation',{headers});const fleetHtml=await fleetPage.text();assert.equal(fleetPage.status,200,fleetHtml);assert.match(fleetHtml,/data-tmm-shell="automatic"/);assert.doesNotMatch(fleetHtml,/<aside/);assert.match(fleetHtml,/WORKER-01/);assert.match(fleetHtml,/view=dashboard&mode=simulation/);
  for(const path of ['/telemetry/connections/discovered','/telemetry/connections/pipeline-status','/telemetry/connections/scheduled-reports','/telemetry/connections/diagnostic-library']){const res=await runtime.dispatchFetch('https://tmm.test'+path,{headers});assert.equal(res.status,200,path);assert.match(await res.text(),/data-tmm-shell="automatic"/,path)}
  await db.prepare("UPDATE contractor_accounts SET role='company_admin' WHERE id=1").run();await db.prepare("UPDATE contractor_sessions SET active_role='company_admin' WHERE account_id=1").run();
  const adminFleet=await (await runtime.dispatchFetch('https://tmm.test/contractor?view=fleet',{headers})).text();assert.match(adminFleet,/data-tmm-shell="automatic"/);assert.match(adminFleet,/action="\/company-admin\/fleet\/add"/);assert.match(adminFleet,/action="\/company-admin\/fleet\/import"/);
  const empty=await runtime.dispatchFetch('https://tmm.test/api/telemetry/automatic',{headers});assert.equal(empty.status,200);const data=await empty.json();assert.equal(data.machines[0].machine_id,'WORKER-01');assert.equal(data.machines[0].operating_hours,null);
  const now=new Date().toISOString();
  await db.prepare("INSERT INTO machine_telemetry_v1(company_id,machine_id,recorded_at,engine_hours,source,raw_json,created_at) VALUES(1,'WORKER-01',?,1100,'authorised-test','{}',?)").bind(now,now).run();
  const refreshed=await (await runtime.dispatchFetch('https://tmm.test/api/telemetry/automatic',{headers})).json();assert.equal(refreshed.machines[0].current_hour_meter,1100);assert.equal(refreshed.machines[0].hours_to_service,150);
  assert.equal((await runtime.dispatchFetch('https://tmm.test/api/telemetry/automatic')).status,401);
 }finally{await runtime.dispose()}
});
