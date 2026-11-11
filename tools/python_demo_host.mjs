// Loopback-only harness: actual TMM Worker code, disposable SQLite, no cloud credentials.
import {readFileSync} from 'node:fs';
import {stripTypeScriptTypes} from 'node:module';
import {DatabaseSync} from 'node:sqlite';
import {createServer} from 'node:http';
import {randomUUID,createHash} from 'node:crypto';
const dataURL=s=>'data:text/javascript;base64,'+Buffer.from(stripTypeScriptTypes(s)).toString('base64');
const storage=readFileSync(new URL('../worker/router-telemetry-ready.ts',import.meta.url),'utf8').replace('import currentApp from "./router-month-end";','const currentApp={fetch:async()=>new Response("Not part of demo",{status:404})};');
const automation=readFileSync(new URL('../worker/telemetry-automation.ts',import.meta.url),'utf8');
const router=readFileSync(new URL('../worker/router-telemetry-ingestion-v2.ts',import.meta.url),'utf8').replace('"./router-telemetry-ready"',JSON.stringify(dataURL(storage))).replace('"./telemetry-automation"',JSON.stringify(dataURL(automation)));
const app=(await import(dataURL(router))).default;
const sql=new DatabaseSync(':memory:');
sql.exec(`CREATE TABLE companies(id INTEGER PRIMARY KEY,name TEXT);
CREATE TABLE machines(id INTEGER PRIMARY KEY,company_id INTEGER,fleet_number TEXT,operating_hours REAL,next_service_hours REAL,site TEXT,status TEXT,category TEXT,created_at TEXT);
CREATE TABLE contractor_accounts(id INTEGER PRIMARY KEY,company_id INTEGER,role TEXT,full_name TEXT,status TEXT,email TEXT);
CREATE TABLE contractor_sessions(company_id INTEGER,account_id INTEGER,token_hash TEXT,active_role TEXT,expires_at TEXT);
INSERT INTO companies VALUES(1,'Python isolated sandbox');
INSERT INTO machines VALUES(1,1,'PY-DEMO-ADT-001',1000,1250,'Python Sandbox','active','ADT','2026-01-01');
INSERT INTO contractor_accounts VALUES(1,1,'engineer','Sandbox engineer','active','sandbox@example.test');`);
const env={DB:{prepare(q){let values=[];return {bind(...v){values=v;return this},async first(){return sql.prepare(q).get(...values)??null},async all(){return {results:sql.prepare(q).all(...values)}},async run(){const r=sql.prepare(q).run(...values);return {meta:{last_row_id:Number(r.lastInsertRowid),changes:Number(r.changes)}}}}}}};
const ctx={waitUntil(){},passThroughOnException(){}};
await app.fetch(new Request('https://sandbox.invalid/api/telemetry/v2',{method:'POST',body:'{}'}),env,ctx);
const token=randomUUID();
sql.prepare(`INSERT INTO telemetry_connections_v2(company_id,provider,connection_name,source_key,token_hash,status,created_by,created_at) VALUES(1,'other','Python local demonstration','python-demo',?,'active',1,?)`).run(createHash('sha256').update(token).digest('hex'),new Date().toISOString());
sql.exec(`INSERT INTO telemetry_machine_map_v2(company_id,connection_id,external_machine_id,machine_id,created_at) VALUES(1,1,'PY-DEVICE-001','PY-DEMO-ADT-001','now')`);
let failure=true,cycles=0,schedulerError=null,busy=false;
const rows=table=>sql.prepare('SELECT * FROM '+table).all();
const server=createServer(async(req,res)=>{try{
 if(req.url==='/demo/state'){
 const tables=new Set(sql.prepare("SELECT name FROM sqlite_master WHERE type='table'").all().map(x=>x.name));
 const read=t=>tables.has(t)?rows(t):[];
 const result={cycles,schedulerError,readings:read('machine_telemetry_v1'),receipts:read('telemetry_analysis_receipts_v3'),findings:read('telemetry_condition_findings_v2'),reports:read('telemetry_report_documents_v2').map(r=>JSON.parse(r.report_json)),deliveries:read('telemetry_delivery_outbox_v3'),registeredHourMeter:rows('machines')[0].operating_hours};
 res.writeHead(200,{'content-type':'application/json'});res.end(JSON.stringify(result));return;
 }
 if(req.url!=='/api/telemetry/v2'){res.writeHead(404);res.end();return;}
 // First transfer deliberately fails to demonstrate durable retry, without losing data.
 if(failure){failure=false;res.writeHead(503);res.end('Demonstration transient outage');return;}
 let body='';for await(const part of req)body+=part;
 const response=await app.fetch(new Request('https://sandbox.invalid'+req.url,{method:req.method,headers:req.headers,body}),env,ctx);
 res.writeHead(response.status,Object.fromEntries(response.headers));res.end(await response.text());
 }catch(e){res.writeHead(500);res.end(String(e));}});
server.listen(0,'127.0.0.1',()=>process.stdout.write(JSON.stringify({url:'http://127.0.0.1:'+server.address().port,token})+'\n'));
const timer=setInterval(async()=>{if(busy)return;busy=true;try{await app.scheduled({scheduledTime:Date.now(),cron:'*/15 * * * *',noRetry(){}},env,ctx);cycles++;}catch(e){schedulerError=String(e);console.error(schedulerError)}finally{busy=false}},2000);
process.on('SIGTERM',()=>{clearInterval(timer);server.close();});
