import test from 'node:test';
import assert from 'node:assert/strict';
import {DatabaseSync} from 'node:sqlite';
import {build} from 'esbuild';
import {createRequire} from 'node:module';
const compiled=await build({entryPoints:[new URL('../worker/maintenance-planner.ts',import.meta.url).pathname],bundle:true,platform:'node',format:'cjs',write:false});
const module={exports:{}};new Function('require','module','exports',compiled.outputFiles[0].text)(createRequire(import.meta.url),module,module.exports);
const {maintenancePlanner}=module.exports;
const today=()=>new Date(Date.now()+7200000).toISOString().slice(0,10);
function setup(){
 const sql=new DatabaseSync(':memory:');sql.exec("CREATE TABLE machines(company_id INTEGER,fleet_number TEXT,operating_hours REAL,next_service_hours REAL);INSERT INTO machines VALUES(1,'ADT-1',1490,1500),(2,'OTHER',20,250)");let fail=false;
 const DB={prepare(q){let b=[];return{bind(...v){b=v;return this},async all(){return{results:sql.prepare(q).all(...b)}},async run(){if(fail&&q.startsWith('UPDATE machines')){fail=false;throw Error('Injected failure')}const r=sql.prepare(q).run(...b);return{meta:{changes:Number(r.changes),last_row_id:Number(r.lastInsertRowid)}}}}},async batch(statements){sql.exec('BEGIN');try{const result=[];for(const stmt of statements)result.push(await stmt.run());sql.exec('COMMIT');return result}catch(e){sql.exec('ROLLBACK');throw e}}};
 const session={companyId:1,accountId:7,role:'company_admin',companyName:'Audit'};
 const post=async(v,overrides={},origin='https://audit.invalid')=>maintenancePlanner(new Request('https://audit.invalid/telemetry/connections/maintenance-planner',{method:'POST',headers:{origin},body:new URLSearchParams({csrf:'audit',...v})}),{DB},{...session,...overrides},'audit');
 const create=(extra={})=>post({action:'create',machine:'ADT-1',date:today(),start:'08:00',end:'10:00',task:'1500 h service',work_order:'WO-1',...extra});
 const complete=(extra={})=>post({action:'complete',id:'1',service_meter:'1501',next_service_hours:'2000',reference:'OEM schedule revision A',work_order:'WO-1',completion_notes:'Work done and checked',...extra});
 return{sql,DB,post,create,complete,failUpdate(){fail=true}};
}
test('overlapping drafts/approved jobs are blocked, adjacent slots allowed, cancellation retains history',async()=>{
 const h=setup();assert.equal((await h.create()).status,303);assert.equal((await h.create({start:'09:00',end:'11:00'})).status,400);assert.equal((await h.post({action:'approve',id:'1'})).status,303);assert.equal((await h.create({start:'07:00',end:'09:00'})).status,400);assert.equal((await h.create({start:'10:00',end:'11:00'})).status,303);assert.equal((await h.post({action:'cancel',id:'1'})).status,303);assert.equal((await h.create()).status,303);assert.equal(h.sql.prepare('SELECT status FROM maintenance_plan_entries_v1 WHERE id=1').get().status,'cancelled');
});
test('completion requires approval and evidence; atomic sign-off advances due meter without inventing engine hours',async()=>{
 const h=setup();await h.create();assert.equal((await h.complete()).status,409);await h.post({action:'approve',id:'1'});assert.equal((await h.complete({reference:''})).status,400);assert.equal((await h.complete({next_service_hours:'1500'})).status,400);
 h.failUpdate();assert.equal((await h.complete()).status,400);assert.equal(h.sql.prepare('SELECT COUNT(*) n FROM maintenance_service_completions_v2').get().n,0);assert.equal(h.sql.prepare('SELECT status FROM maintenance_plan_entries_v1').get().status,'approved');
 assert.equal((await h.complete()).status,303);const machine=h.sql.prepare("SELECT * FROM machines WHERE company_id=1").get();assert.equal(machine.next_service_hours,2000);assert.equal(machine.operating_hours,1490);assert.equal(h.sql.prepare('SELECT status FROM maintenance_plan_entries_v1').get().status,'completed');
 assert.equal((await h.complete({next_service_hours:'9999'})).status,409);assert.equal(h.sql.prepare('SELECT next_service_hours FROM machines WHERE company_id=1').get().next_service_hours,2000);
});
test('completion rejects other companies, engineer writes, wrong origin and bad CSRF',async()=>{
 const h=setup();await h.create();await h.post({action:'approve',id:'1'});
 const payload={action:'complete',id:'1',service_meter:'1501',next_service_hours:'2000',reference:'Ref',work_order:'WO',completion_notes:'Done'};
 assert.equal((await h.post(payload,{companyId:2})).status,409);assert.equal((await h.post(payload,{role:'engineer'})).status,403);assert.equal((await h.post(payload,{},'https://other.invalid')).status,403);assert.equal((await h.post({...payload,csrf:'wrong'})).status,403);assert.equal(h.sql.prepare('SELECT COUNT(*) n FROM maintenance_service_completions_v2').get().n,0);
});
test('approval detects conflicts in legacy drafts before accepting them',async()=>{
 const h=setup();await h.create();await h.post({action:'approve',id:'1'});h.sql.exec("INSERT INTO maintenance_plan_entries_v1(company_id,machine_id,service_date,start_time,end_time,task,status,created_by,created_at) SELECT company_id,machine_id,service_date,'09:00','11:00','Old import','draft',7,'now' FROM maintenance_plan_entries_v1 WHERE id=1");assert.equal((await h.post({action:'approve',id:'2'})).status,409);
});
