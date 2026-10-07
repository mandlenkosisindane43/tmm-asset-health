import assert from 'node:assert/strict';
import {buildSync} from 'esbuild';
import {mkdtempSync,rmSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {pathToFileURL} from 'node:url';
const dir=mkdtempSync(join(tmpdir(),'tmm-summary-'));
const out=join(dir,'summary.mjs');
buildSync({stdin:{contents:"export * from './worker/period-summary'; export * from './worker/dashboard-analytics'; export * from './worker/contractor-reports';",resolveDir:process.cwd()},bundle:true,platform:'node',format:'esm',outfile:out});
const {completePeriodSummary,missingReports,chart,handleContractorReports}=await import(pathToFileURL(out));
process.on('exit',()=>rmSync(dir,{recursive:true,force:true}));
const machines=[{fleet:'A',site:'Pit',status:'operating',created_at:'2026-09-02'},{fleet:'B',status:'retired'}];
const production=[{fleet:'A',reportDate:'2026-09-02',shiftHours:12,plannedDowntime:0,unplannedDowntime:2,operatingHours:10,tonnes:50}];
assert.deepEqual(missingReports(machines,production,'2026-09-01','2026-09-05','2026-09-04'),[['2026-09-03','A','Pit']]);
const env={DB:{prepare(sql){return {bind(...binds){assert.equal(binds[0],42);return {async all(){if(sql.includes('role_parts_requests'))throw Error('table unavailable');return {results:sql.includes('FROM machines')?machines:sql.includes('FROM production_records')?production:sql.includes('FROM events')?[{fleet:'A',system:'Hydraulics',description:'Leak <script>',openedAt:'2026-09-02',downtime:2},{fleet:'A',system:'Hydraulics',description:'Leak <script>',openedAt:'2026-09-03',downtime:3}]:[]};}};}};}}};
const html=await completePeriodSummary(env,42,'2026-09-01','2026-09-05');
for(const title of ['Availability and utilisation trend','Daily production trend','Downtime trend','Downtime Pareto by cause','Downtime Pareto by machine','Downtime reasons','Repeated failures','Missing daily reports','Outstanding / missing parts','Purchase orders awaiting delivery','Service due / overdue','Priority follow-up'])assert.ok(html.includes(title),title);
assert.ok(html.includes('Leak &lt;script&gt;'));assert.ok(!html.includes('Leak <script>'));assert.ok(html.includes('Parts data unavailable'));assert.ok(!html.includes('NaN'));
const gap=chart('gaps',['a','b','c'],[{name:'test',color:'#123',values:[10,null,20]}]);assert.equal((gap.match(/<polyline /g)||[]).length,2);
const historical=await completePeriodSummary(env,42,'2026-09-01','2026-09-05',{production,events:[]});assert.ok(historical.includes('Imported historical production'));
console.log('PASS: tenant scoping, period sections, missing-day boundaries, escaping, unavailable tables, chart gaps, historical inputs');

const routeEnv={DB:{prepare(sql){const statement={bind(...binds){if(!sql.includes('contractor_sessions'))assert.equal(binds[0],42);return statement;},async first(){return sql.includes('contractor_sessions')?{companyId:42,accountId:1,fullName:'Test',email:'test@example.com',role:'admin',accountStatus:'active',sessionExpires:'2099-01-01',licenceStatus:'active',licenceExpires:'2099-01-01',graceDays:0,companyName:'Test Company'}:null;},async all(){return {results:sql.includes('FROM machines')?machines:sql.includes('FROM production_records')?production:[]};},async run(){return {};}};return statement;}}};
for(const type of ['weekly','monthly']){
 const response=await handleContractorReports(new Request(`https://test.example/contractor-reports?type=${type}&date=2026-09-02&month=2026-09`,{headers:{cookie:'sas_contractor_v2=test'}}),routeEnv);
 assert.equal(response.status,200);const body=await response.text();assert.equal((body.match(/Complete operational summary/g)||[]).length,1);assert.ok(body.includes('Downtime Pareto by cause'));assert.ok(body.includes('Missing daily reports'));assert.ok(body.includes('Purchase orders awaiting delivery'));if(type==='monthly'){assert.ok(body.includes('id="previous-month-upload"'));assert.ok(body.includes('accept=".zip,.xlsx,.xls,.csv"'));assert.ok(body.includes('/trial-demo/import-zip'));}
}
const signedOut=await handleContractorReports(new Request('https://test.example/contractor-reports?type=monthly'),routeEnv);assert.equal(signedOut.status,302);
console.log('PASS: actual authenticated weekly/monthly report handlers include summaries exactly once; unauthenticated requests redirect');
