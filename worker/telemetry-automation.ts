/** One unattended pipeline for authorised readings; simulation is isolated throughout. */
type Row=Record<string,unknown>;
interface AutomationStatement {
 bind(...values:unknown[]):AutomationStatement;
 first<T=Row>():Promise<T|null>;
 all<T=Row>():Promise<{results:T[]}>;
 run():Promise<{meta?:{changes?:number;last_row_id?:number}}>;
}
interface AutomationDatabase {prepare(query:string):AutomationStatement}
export interface AutomationEnv {DB:AutomationDatabase;RESEND_API_KEY?:string;ALERT_FROM_EMAIL?:string;TMM_APP_ORIGIN?:string;TMM_DELIVERY_MODE?:string;[key:string]:unknown}
export type Diagnostic={code:string;system:string;meaning:string;severity:string;verified:boolean};
export type Lookup=(code:string)=>Diagnostic;
export const text=(v:unknown)=>String(v??"").trim();
const number=(v:unknown)=>Number(v??0);
export const escape=(v:unknown)=>text(v).replace(/[&<>"']/g,c=>({"&":"&amp;","<":"&lt;",">":"&gt;",'"':"&quot;","'":"&#39;"}[c]!));
export const first=(e:AutomationEnv,q:string,b:unknown[]=[])=>e.DB.prepare(q).bind(...b).first<Row>();
export const rows=async(e:AutomationEnv,q:string,b:unknown[]=[])=>((await e.DB.prepare(q).bind(...b).all<Row>()).results||[]);
const parsed=(v:unknown):Row=>{try{const r=JSON.parse(text(v)||"{}");return r&&typeof r==="object"&&!Array.isArray(r)?r:{}}catch{return {}}};
export const simulated=(r:Row)=>/staging-test|SIMULATED/i.test(text(r.source))||parsed(r.raw_json).test_data===true;
const mode=(r:Row)=>simulated(r)?"simulation":"live";
const schemas=new WeakMap<AutomationDatabase,Promise<void>>();

export async function ensureAutomation(e:AutomationEnv){
 let pending=schemas.get(e.DB);if(pending)return pending;
 pending=(async()=>{for(const q of [
  `CREATE TABLE IF NOT EXISTS telemetry_condition_findings_v2(id INTEGER PRIMARY KEY AUTOINCREMENT,company_id INTEGER NOT NULL,machine_id TEXT NOT NULL,telemetry_id INTEGER NOT NULL,source_mode TEXT NOT NULL,category TEXT NOT NULL,severity TEXT NOT NULL,diagnostic_code TEXT,details TEXT NOT NULL,recommendation TEXT NOT NULL,created_at TEXT NOT NULL,UNIQUE(company_id,telemetry_id,category,diagnostic_code))`,
  `CREATE TABLE IF NOT EXISTS telemetry_analysis_failures_v3(telemetry_id INTEGER PRIMARY KEY,company_id INTEGER NOT NULL,attempts INTEGER NOT NULL,next_attempt_at TEXT NOT NULL,last_error TEXT NOT NULL,updated_at TEXT NOT NULL)`,
  `CREATE TABLE IF NOT EXISTS telemetry_analysis_receipts_v3(telemetry_id INTEGER PRIMARY KEY,company_id INTEGER NOT NULL,analysed_at TEXT NOT NULL)`,
  `CREATE TABLE IF NOT EXISTS telemetry_automation_targets_v3(company_id INTEGER NOT NULL,machine_id TEXT NOT NULL,source_mode TEXT NOT NULL,last_report_at TEXT,PRIMARY KEY(company_id,machine_id,source_mode))`,
  `CREATE TABLE IF NOT EXISTS telemetry_automation_runs_v3(company_id INTEGER PRIMARY KEY,last_analysis_at TEXT,last_report_at TEXT,last_error TEXT)`,
  `CREATE TABLE IF NOT EXISTS telemetry_machine_limits_v3(id INTEGER PRIMARY KEY AUTOINCREMENT,company_id INTEGER NOT NULL,machine_id TEXT NOT NULL,metric TEXT NOT NULL,unit TEXT NOT NULL,comparison TEXT NOT NULL,warning_value REAL NOT NULL,critical_value REAL NOT NULL,reference TEXT NOT NULL,approved_by INTEGER NOT NULL,updated_at TEXT NOT NULL,UNIQUE(company_id,machine_id,metric))`,
  `CREATE TABLE IF NOT EXISTS telemetry_automation_settings_v3(company_id INTEGER PRIMARY KEY,recipients_json TEXT NOT NULL DEFAULT '[]',delivery_enabled INTEGER NOT NULL DEFAULT 0,report_hour_sast INTEGER NOT NULL DEFAULT 18,updated_by INTEGER NOT NULL,updated_at TEXT NOT NULL)`,
  `CREATE TABLE IF NOT EXISTS telemetry_auto_alerts_v3(id INTEGER PRIMARY KEY AUTOINCREMENT,company_id INTEGER NOT NULL,machine_id TEXT NOT NULL,source_mode TEXT NOT NULL,rule_key TEXT NOT NULL,severity TEXT NOT NULL,details TEXT NOT NULL,first_telemetry_id INTEGER NOT NULL,latest_telemetry_id INTEGER NOT NULL,occurrences INTEGER NOT NULL DEFAULT 1,first_seen TEXT NOT NULL,last_seen TEXT NOT NULL,UNIQUE(company_id,machine_id,source_mode,rule_key))`,
  `CREATE TABLE IF NOT EXISTS telemetry_report_snapshots_v2(id INTEGER PRIMARY KEY AUTOINCREMENT,company_id INTEGER NOT NULL,machine_id TEXT NOT NULL,period TEXT NOT NULL,period_start TEXT NOT NULL,period_end TEXT NOT NULL,source_mode TEXT NOT NULL,reading_count INTEGER NOT NULL,fault_readings INTEGER NOT NULL,first_hours REAL,last_hours REAL,generated_at TEXT NOT NULL,UNIQUE(company_id,machine_id,period,period_start,source_mode))`,
  `CREATE TABLE IF NOT EXISTS telemetry_report_documents_v2(snapshot_id INTEGER PRIMARY KEY,company_id INTEGER NOT NULL,report_json TEXT NOT NULL,generated_at TEXT NOT NULL)`,
  `CREATE TABLE IF NOT EXISTS telemetry_delivery_outbox_v3(id INTEGER PRIMARY KEY AUTOINCREMENT,company_id INTEGER NOT NULL,event_key TEXT NOT NULL,recipient TEXT NOT NULL,kind TEXT NOT NULL,payload_json TEXT NOT NULL,provider_key TEXT NOT NULL,status TEXT NOT NULL DEFAULT 'pending',attempts INTEGER NOT NULL DEFAULT 0,next_attempt_at TEXT NOT NULL,lease_until TEXT,lease_token TEXT,first_attempt_at TEXT,provider_id TEXT,last_error TEXT,created_at TEXT NOT NULL,sent_at TEXT,UNIQUE(company_id,event_key,recipient))`,
  `CREATE INDEX IF NOT EXISTS idx_telemetry_delivery_pending ON telemetry_delivery_outbox_v3(status,next_attempt_at)`,
 ])await e.DB.prepare(q).run()})().catch(error=>{schemas.delete(e.DB);throw error});schemas.set(e.DB,pending);return pending;
}

/** Measured engine-runtime coverage, never inferred breakdown or productive time. */
export function measuredMetrics(input:Row[]){
 const data=[...input].sort((a,b)=>Date.parse(text(a.recorded_at))-Date.parse(text(b.recorded_at))||number(a.id)-number(b.id));
 let observed=0,runtime=0,intervals=0,idle=0,idleIntervals=0,tonnes=0,tonneIntervals=0;
 for(let i=1;i<data.length;i++){
  const a=data[i-1],b=data[i],elapsed=(Date.parse(text(b.recorded_at))-Date.parse(text(a.recorded_at)))/3600000;
  if(!Number.isFinite(elapsed)||elapsed<=0||elapsed>24||a.engine_hours==null||b.engine_hours==null)continue;
  const delta=number(b.engine_hours)-number(a.engine_hours);
  if(!Number.isFinite(delta)||delta<0||delta>elapsed*1.2)continue;
  observed+=elapsed;runtime+=Math.min(elapsed,delta);intervals++;
  const pa=parsed(a.raw_json),pb=parsed(b.raw_json),sa=pa.counter_semantics as Row|undefined,sb=pb.counter_semantics as Row|undefined;
  if(sa?.idle_hours==="cumulative"&&sb?.idle_hours==="cumulative"&&pa.idle_hours!=null&&pb.idle_hours!=null){const d=number(pb.idle_hours)-number(pa.idle_hours);if(Number.isFinite(d)&&d>=0&&d<=elapsed*1.2){idle+=d;idleIntervals++}}
  if(sa?.production_tonnes==="cumulative"&&sb?.production_tonnes==="cumulative"&&pa.production_tonnes!=null&&pb.production_tonnes!=null){const d=number(pb.production_tonnes)-number(pa.production_tonnes);if(Number.isFinite(d)&&d>=0){tonnes+=d;tonneIntervals++}}
 }
 const round=(v:number)=>Math.round(v*100)/100;
 return {reading_count:data.length,valid_intervals:intervals,observed_hours:intervals?round(observed):null,operating_hours:intervals?round(runtime):null,engine_runtime_percent:observed?round(100*runtime/observed):null,idle_hours:idleIntervals===intervals&&intervals?round(idle):null,production_tonnes:tonneIntervals===intervals&&intervals?round(tonnes):null,availability_percent:null,confirmed_downtime_hours:null,productive_hours:null};
}

async function settings(e:AutomationEnv,cid:number){
 const s=await first(e,"SELECT * FROM telemetry_automation_settings_v3 WHERE company_id=?",[cid]);let recipients:unknown=[];
 try{recipients=JSON.parse(text(s?.recipients_json)||"[]")}catch{}
 const emails=Array.isArray(recipients)?recipients.filter((v):v is string=>typeof v==="string").map(v=>v.trim().toLowerCase()).filter(v=>/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(v)):[];
 return {enabled:number(s?.delivery_enabled)===1,recipients:[...new Set(emails)].slice(0,20),hour:number(s?.report_hour_sast??18)};
}
async function enqueue(e:AutomationEnv,cid:number,event:string,kind:string,subject:string,html:string,now:string){
 const s=await settings(e,cid);if(!s.enabled)return;
 for(const recipient of s.recipients){
  const payload={from:text(e.ALERT_FROM_EMAIL)||"TMM Asset Health <notifications@sindaneassetsolutions.co.za>",to:[recipient],subject,html};
  await e.DB.prepare("INSERT OR IGNORE INTO telemetry_delivery_outbox_v3(company_id,event_key,recipient,kind,payload_json,provider_key,status,next_attempt_at,created_at) VALUES(?,?,?,?,?,?,'pending',?,?)").bind(cid,event,recipient,kind,JSON.stringify(payload),"tmm-automation-"+crypto.randomUUID(),now,now).run();
 }
}

export function canonicalFaultCode(input:string){
 const clean=input.trim(),match=/^SPN\s*(\d+)\s*FMI\s*(\d+)$/i.exec(clean);
 if(match&&Number(match[1])<=524287&&Number(match[2])<=31)return `SPN ${Number(match[1])} FMI ${Number(match[2])}`;
 return clean;
}
async function finding(e:AutomationEnv,r:Row,category:string,severity:string,code:string,details:string,action:string,now:string){
 const cid=number(r.company_id),machine=text(r.machine_id),source=mode(r);
 if(category==="diagnostic_code")code=canonicalFaultCode(code);
 await e.DB.prepare("INSERT OR IGNORE INTO telemetry_condition_findings_v2(company_id,machine_id,telemetry_id,source_mode,category,severity,diagnostic_code,details,recommendation,created_at) VALUES(?,?,?,?,?,?,?,?,?,?)").bind(cid,machine,number(r.id),source,category,severity,code,details,action,now).run();
 const count=await first(e,"SELECT COUNT(*) n FROM telemetry_condition_findings_v2 WHERE company_id=? AND lower(machine_id)=lower(?) AND source_mode=? AND category=? AND diagnostic_code=?",[cid,machine,source,category,code]);
 const key=category+":"+code;
 await e.DB.prepare("INSERT INTO telemetry_auto_alerts_v3(company_id,machine_id,source_mode,rule_key,severity,details,first_telemetry_id,latest_telemetry_id,occurrences,first_seen,last_seen) VALUES(?,?,?,?,?,?,?,?,?,?,?) ON CONFLICT(company_id,machine_id,source_mode,rule_key) DO UPDATE SET first_telemetry_id=CASE WHEN excluded.first_seen<telemetry_auto_alerts_v3.first_seen THEN excluded.first_telemetry_id ELSE telemetry_auto_alerts_v3.first_telemetry_id END,latest_telemetry_id=CASE WHEN excluded.last_seen>=telemetry_auto_alerts_v3.last_seen THEN excluded.latest_telemetry_id ELSE telemetry_auto_alerts_v3.latest_telemetry_id END,occurrences=MAX(telemetry_auto_alerts_v3.occurrences,excluded.occurrences),first_seen=MIN(telemetry_auto_alerts_v3.first_seen,excluded.first_seen),last_seen=MAX(telemetry_auto_alerts_v3.last_seen,excluded.last_seen),severity=CASE WHEN excluded.last_seen>=telemetry_auto_alerts_v3.last_seen THEN excluded.severity ELSE telemetry_auto_alerts_v3.severity END,details=CASE WHEN excluded.last_seen>=telemetry_auto_alerts_v3.last_seen THEN excluded.details ELSE telemetry_auto_alerts_v3.details END").bind(cid,machine,source,key,severity,details,number(r.id),number(r.id),number(count?.n),text(r.recorded_at),text(r.recorded_at)).run();
 // Replays share a canonical rule/day key and a fixed persisted message payload.
 if(source==="live"&&Date.parse(now)-Date.parse(text(r.recorded_at))<=3600000)await enqueue(e,cid,`alert:${machine}:${key}:${severity}:${now.slice(0,10)}`,"alert",`TMM ${severity}: ${machine} · ${code||category}`,`<h2>${escape(machine)}</h2><p>${escape(details)}</p><p>${escape(action)}</p><p>Recorded ${escape(r.recorded_at)} UTC. This observation is not a confirmed root cause.</p>`,now);
}

async function analyse(e:AutomationEnv,lookup:Lookup,now:string){
 // FIFO receipts guarantee older queued machines are not silently starved by a LIMIT.
 const pending=await rows(e,"SELECT t.* FROM machine_telemetry_v1 t LEFT JOIN telemetry_analysis_receipts_v3 a ON a.telemetry_id=t.id LEFT JOIN telemetry_analysis_failures_v3 f ON f.telemetry_id=t.id WHERE a.telemetry_id IS NULL AND (f.next_attempt_at IS NULL OR f.next_attempt_at<=?) ORDER BY t.id LIMIT 50",[now]);
 for(const r of pending){
  const cid=number(r.company_id),machine=text(r.machine_id),p=parsed(r.raw_json);
  try{
  for(const code of new Set(text(r.fault_code).split(',').map(canonicalFaultCode).filter(Boolean))){
   const d=lookup(code);
   await finding(e,r,"diagnostic_code","review",code,d.meaning+" ["+d.system+"; "+(d.verified?"reference mapped; verify OEM applicability":"definition required — OEM definition required")+"]","Confirm OEM applicability, occurrence state and machine-specific service procedure.",now);
  }
  const limits=await rows(e,"SELECT * FROM telemetry_machine_limits_v3 WHERE company_id=? AND lower(machine_id)=lower(?)",[cid,machine]);
  for(const rule of limits){
   if(["engine_oil_pressure","hydraulic_pressure"].includes(text(rule.metric))){
    if(text(p.ignition_status).toLowerCase()==="off")continue;
    if(text(p.ignition_status).toLowerCase()!=="on"||!(Number(p.rpm)>0)){await finding(e,r,"operating_state_required","review",text(rule.metric),"Pressure cannot be classified without a reported running engine and valid speed.","Verify ignition and engine-speed mapping before applying pressure limits.",now);continue}
   }
   const metric=text(rule.metric),value=p[metric]??r[metric];if(value==null)continue;
   const units=p.units as Row|undefined;
   if(units?.[metric]!==rule.unit){await finding(e,r,"units_required","review",metric,`${metric} cannot be evaluated: source units do not match configured ${rule.unit}.`,"Correct the source mapping and units before applying the approved limit.",now);continue}
   const v=Number(value);if(!Number.isFinite(v))continue;
   const hit=(limit:unknown)=>rule.comparison==="low"?v<=number(limit):v>=number(limit);
   const severity=hit(rule.critical_value)?"critical":hit(rule.warning_value)?"warning":"";
   if(severity)await finding(e,r,"configured_limit",severity,metric,`${metric} = ${v} ${rule.unit}; ${severity} against configured ${rule.comparison} limit. Reference: ${text(rule.reference)}.`,"Review the machine condition using the configured OEM/site procedure; confirm before maintenance action.",now);
  }
  // A conservative simulation screen remains explicitly illustrative, never a live alarm.
  if(simulated(r)&&r.coolant_temperature!=null&&number(r.coolant_temperature)>=105)await finding(e,r,"coolant_temperature","review","",`Simulated coolant temperature ${r.coolant_temperature} °C exceeds an illustrative screen; this is not an OEM-approved alarm.`,"Verify sensor units and the machine-specific approved limit.",now);
  await e.DB.prepare("INSERT OR IGNORE INTO telemetry_automation_targets_v3(company_id,machine_id,source_mode) VALUES(?,?,?)").bind(cid,machine,mode(r)).run();
  await e.DB.prepare("INSERT OR IGNORE INTO telemetry_analysis_receipts_v3(telemetry_id,company_id,analysed_at) VALUES(?,?,?)").bind(number(r.id),cid,now).run();
  await e.DB.prepare("DELETE FROM telemetry_analysis_failures_v3 WHERE telemetry_id=? AND company_id=?").bind(number(r.id),cid).run();
  await e.DB.prepare("INSERT INTO telemetry_automation_runs_v3(company_id,last_analysis_at) VALUES(?,?) ON CONFLICT(company_id) DO UPDATE SET last_analysis_at=excluded.last_analysis_at,last_error=NULL").bind(cid,now).run();
  }catch(error){
   const prior=await first(e,"SELECT attempts FROM telemetry_analysis_failures_v3 WHERE telemetry_id=?",[number(r.id)]),attempts=number(prior?.attempts)+1,message=text((error as Error).message).slice(0,500);
   await e.DB.prepare("INSERT INTO telemetry_analysis_failures_v3(telemetry_id,company_id,attempts,next_attempt_at,last_error,updated_at) VALUES(?,?,?,?,?,?) ON CONFLICT(telemetry_id) DO UPDATE SET attempts=excluded.attempts,next_attempt_at=excluded.next_attempt_at,last_error=excluded.last_error,updated_at=excluded.updated_at").bind(number(r.id),cid,attempts,new Date(Date.parse(now)+Math.min(3600000,60000*2**Math.min(attempts,6))).toISOString(),message,now).run();
   await e.DB.prepare("INSERT INTO telemetry_automation_runs_v3(company_id,last_error) VALUES(?,?) ON CONFLICT(company_id) DO UPDATE SET last_error=excluded.last_error").bind(cid,"Analysis retry: "+message).run();
  }
 }
 return pending.length;
}

async function generateReports(e:AutomationEnv,now:string){
 const targets=await rows(e,"SELECT * FROM telemetry_automation_targets_v3 ORDER BY COALESCE(last_report_at,''),company_id,machine_id,source_mode LIMIT 10");
 for(const t of targets){
  try{
  const cid=number(t.company_id),machine=text(t.machine_id),source=text(t.source_mode),selector=source==="simulation"?"(source LIKE '%staging-test%' OR source LIKE '%SIMULATED%')":"(source NOT LIKE '%staging-test%' AND source NOT LIKE '%SIMULATED%')";
  const backlog=await first(e,"SELECT COUNT(*) n FROM machine_telemetry_v1 t LEFT JOIN telemetry_analysis_receipts_v3 a ON a.telemetry_id=t.id WHERE t.company_id=? AND lower(t.machine_id)=lower(?) AND a.telemetry_id IS NULL AND "+selector,[cid,machine]);
  const s=await settings(e,cid),local=new Date(Date.parse(now)+7200000),day=local.toISOString().slice(0,10),weekday=local.getUTCDay(),hour=local.getUTCHours();
  for(const [period,days] of [["daily",1],["weekly",7],["monthly",30]] as const){
   const start=new Date(Date.parse(now)-days*86400000).toISOString();
   const data=await rows(e,"SELECT * FROM machine_telemetry_v1 WHERE company_id=? AND lower(machine_id)=lower(?) AND recorded_at>=? AND recorded_at<=? AND "+selector+" ORDER BY recorded_at DESC,id DESC LIMIT 10001",[cid,machine,start,now]);
   const considered=data.slice(0,10000).reverse(),metrics=measuredMetrics(considered),hours=considered.filter(r=>r.engine_hours!=null).map(r=>number(r.engine_hours));
   const findings=await rows(e,"SELECT f.telemetry_id,t.recorded_at,f.category,f.severity,f.diagnostic_code,f.details,f.recommendation FROM telemetry_condition_findings_v2 f JOIN machine_telemetry_v1 t ON t.id=f.telemetry_id AND t.company_id=f.company_id WHERE f.company_id=? AND lower(f.machine_id)=lower(?) AND f.source_mode=? AND t.recorded_at>=? AND t.recorded_at<=? ORDER BY t.recorded_at DESC,f.id DESC LIMIT 201",[cid,machine,source,start,now]);
   const faults=considered.filter(r=>text(r.fault_code)).length;
   await e.DB.prepare("INSERT INTO telemetry_report_snapshots_v2(company_id,machine_id,period,period_start,period_end,source_mode,reading_count,fault_readings,first_hours,last_hours,generated_at) VALUES(?,?,?,?,?,?,?,?,?,?,?) ON CONFLICT(company_id,machine_id,period,period_start,source_mode) DO UPDATE SET period_end=excluded.period_end,reading_count=excluded.reading_count,fault_readings=excluded.fault_readings,first_hours=excluded.first_hours,last_hours=excluded.last_hours,generated_at=excluded.generated_at").bind(cid,machine,period,now.slice(0,10),now,source,considered.length,faults,hours.length?Math.min(...hours):null,hours.length?Math.max(...hours):null,now).run();
   const snapshot=await first(e,"SELECT id FROM telemetry_report_snapshots_v2 WHERE company_id=? AND machine_id=? AND period=? AND period_start=? AND source_mode=?",[cid,machine,period,now.slice(0,10),source]);
   const last=considered.at(-1),raw=parsed(last?.raw_json),sensorFields=["engine_hours","rpm","engine_load","coolant_temperature","engine_oil_pressure","hydraulic_pressure","hydraulic_oil_level","hydraulic_temperature","transmission_temperature","battery_voltage","fuel_level","fuel_consumption_lph","latitude","longitude"];
   const latest_sensors=Object.fromEntries(sensorFields.filter(k=>raw[k]!=null||last?.[k]!=null).map(k=>[k,{value:raw[k]??last?.[k],unit:(raw.units as Row|undefined)?.[k]??null}]));
   const report={version:3,latest_sensors,company_id:cid,machine_id:machine,period,period_start:start,period_end:now,source_mode:source,generated_at:now,reading_count:considered.length,fault_readings:faults,first_hours:hours.length?Math.min(...hours):null,last_hours:hours.length?Math.max(...hours):null,metrics,findings:findings.slice(0,200),findings_truncated:findings.length>200,readings_truncated:data.length>10000,analysis_pending:number(backlog?.n),analysis_window:"Durable FIFO analysis receipts; reports disclose any remaining backlog and truncation.",notes:[source==="simulation"?"SIMULATED DATA ONLY — not actual equipment conditions.":"Authorised received telemetry; no machine connection is certified by this report.","Rolling observation window, not a certified calendar-period production return.","Fault observations do not establish root cause, downtime or repair completion. Missing unsupported measurements remain unknown."]};
   await e.DB.prepare("INSERT INTO telemetry_report_documents_v2(snapshot_id,company_id,report_json,generated_at) VALUES(?,?,?,?) ON CONFLICT(snapshot_id) DO UPDATE SET report_json=excluded.report_json,generated_at=excluded.generated_at").bind(number(snapshot?.id),cid,JSON.stringify(report),now).run();
   const due=hour>=s.hour&&(period==="daily"||(period==="weekly"&&weekday===1)||(period==="monthly"&&local.getUTCDate()===1));
   if(source==="live"&&due&&number(backlog?.n)===0&&data.length<=10000){
    const origin=text(e.TMM_APP_ORIGIN)||"https://tmm-asset-health-light-staging.mandlenkosisindane43.workers.dev";
    await enqueue(e,cid,`report:${machine}:${period}:${day}`,"report",`TMM ${period} monitoring report · ${machine}`,`<h2>${escape(machine)} · ${period} monitoring report</h2><p>${considered.length} readings; ${faults} fault-bearing observations. Rolling window ${escape(start)} to ${escape(now)} UTC.</p><p>Engine runtime: ${metrics.operating_hours??"Unavailable"} hours. Production: ${metrics.production_tonnes??"Unavailable"} tonnes.</p><p><a href="${escape(origin)}/telemetry/connections/report-document?id=${number(snapshot?.id)}">Open the saved authenticated report</a></p>`,now);
   }
  }
  await e.DB.prepare("UPDATE telemetry_automation_targets_v3 SET last_report_at=? WHERE company_id=? AND machine_id=? AND source_mode=?").bind(now,cid,machine,source).run();
  await e.DB.prepare("INSERT INTO telemetry_automation_runs_v3(company_id,last_report_at) VALUES(?,?) ON CONFLICT(company_id) DO UPDATE SET last_report_at=excluded.last_report_at,last_error=NULL").bind(cid,now).run();
  }catch(error){
   await e.DB.prepare("INSERT INTO telemetry_automation_runs_v3(company_id,last_error) VALUES(?,?) ON CONFLICT(company_id) DO UPDATE SET last_error=excluded.last_error").bind(number(t.company_id),"Report retry: "+text((error as Error).message).slice(0,500)).run();
  }
 }
 return targets.length;
}

export async function dispatchDeliveries(e:AutomationEnv,now=new Date().toISOString(),send:typeof fetch=fetch){
 await ensureAutomation(e);
 const queue=await rows(e,"SELECT * FROM telemetry_delivery_outbox_v3 WHERE status IN ('pending','retry','waiting_configuration','sending') AND next_attempt_at<=? AND (lease_until IS NULL OR lease_until<=?) ORDER BY id LIMIT 20",[now,now]);
 let sent=0;
 for(const job of queue){
  const s=await settings(e,number(job.company_id));
  if(!s.enabled||!s.recipients.includes(text(job.recipient))){await e.DB.prepare("UPDATE telemetry_delivery_outbox_v3 SET status='cancelled',last_error='Recipient removed or delivery disabled' WHERE id=?").bind(number(job.id)).run();continue}
  if(!e.RESEND_API_KEY||e.TMM_DELIVERY_MODE==="dry_run"){
   await e.DB.prepare("UPDATE telemetry_delivery_outbox_v3 SET status='waiting_configuration',last_error=?,next_attempt_at=? WHERE id=?").bind(e.TMM_DELIVERY_MODE==="dry_run"?"Staging delivery is in dry-run mode":"RESEND_API_KEY is not configured",new Date(Date.parse(now)+900000).toISOString(),number(job.id)).run();continue;
  }
  if(job.first_attempt_at&&Date.parse(now)-Date.parse(text(job.first_attempt_at))>=23*3600000){await e.DB.prepare("UPDATE telemetry_delivery_outbox_v3 SET status='needs_review',last_error='Provider idempotency window nearly expired; no unsafe resend attempted' WHERE id=?").bind(number(job.id)).run();continue}
  const lease=crypto.randomUUID(),until=new Date(Date.parse(now)+120000).toISOString();
  const claim=await e.DB.prepare("UPDATE telemetry_delivery_outbox_v3 SET status='sending',lease_token=?,lease_until=?,attempts=attempts+1,first_attempt_at=COALESCE(first_attempt_at,?) WHERE id=? AND status IN ('pending','retry','waiting_configuration','sending') AND (lease_until IS NULL OR lease_until<=?)").bind(lease,until,now,number(job.id),now).run();
  if(claim.meta?.changes===0)continue;
  try{
   const response=await send("https://api.resend.com/emails",{method:"POST",headers:{authorization:"Bearer "+e.RESEND_API_KEY,"content-type":"application/json","Idempotency-Key":text(job.provider_key)},body:text(job.payload_json),signal:AbortSignal.timeout(20000)});
   const result=await response.json().catch(()=>({})) as Row;
   if(!response.ok||!result.id){const error=new Error(text(result.message)||"Email provider HTTP "+response.status) as Error&{permanent?:boolean};error.permanent=response.status>=400&&response.status<500&&response.status!==429&&!(response.status===409&&result.name==="concurrent_idempotent_requests");throw error}
   await e.DB.prepare("UPDATE telemetry_delivery_outbox_v3 SET status='sent',provider_id=?,sent_at=?,last_error=NULL,lease_until=NULL WHERE id=? AND lease_token=?").bind(text(result.id),now,number(job.id),lease).run();sent++;
  }catch(error){
   const attempts=number(job.attempts)+1,permanent=Boolean((error as {permanent?:boolean}).permanent),status=permanent||attempts>=8?"needs_review":"retry";
   await e.DB.prepare("UPDATE telemetry_delivery_outbox_v3 SET status=?,last_error=?,next_attempt_at=?,lease_until=NULL WHERE id=? AND lease_token=?").bind(status,text((error as Error).message).slice(0,500),new Date(Date.parse(now)+Math.min(3600000,60000*2**attempts)).toISOString(),number(job.id),lease).run();
  }
 }
 return sent;
}

export async function runTelemetryAutomation(e:AutomationEnv,lookup:Lookup,at=Date.now()){
 await ensureAutomation(e);const now=new Date(at).toISOString();
 const analysed=await analyse(e,lookup,now),reported=await generateReports(e,now),sent=await dispatchDeliveries(e,now);
 return {analysed,reported,sent};
}

export async function automaticFleetData(e:AutomationEnv,cid:number,url:URL){
 await ensureAutomation(e);
 const source=url.searchParams.get("mode")==="simulation"?"simulation":"live",selector=source==="simulation"?"(source LIKE '%staging-test%' OR source LIKE '%SIMULATED%')":"(source NOT LIKE '%staging-test%' AND source NOT LIKE '%SIMULATED%')";
 const day=(v:string|null)=>v&&/^\d{4}-\d{2}-\d{2}$/.test(v)&&Number.isFinite(Date.parse(v))&&new Date(v).toISOString().slice(0,10)===v?v:null;
 let from=day(url.searchParams.get("from"))||new Date(Date.now()-7*86400000).toISOString().slice(0,10),to=day(url.searchParams.get("to"))||new Date().toISOString().slice(0,10);if(from>to)[from,to]=[to,from];
 const machines=await rows(e,"SELECT * FROM machines WHERE company_id=? ORDER BY fleet_number",[cid]),site=url.searchParams.get("site")||"",machine=url.searchParams.get("machine")||url.searchParams.get("fleet")||"";
 const selected=machines.filter(m=>(!site||text(m.site)===site)&&(!machine||text(m.fleet_number).toLowerCase()===machine.toLowerCase()));
 const readings=await rows(e,"SELECT t.* FROM machine_telemetry_v1 t JOIN machines m ON m.company_id=t.company_id AND lower(m.fleet_number)=lower(t.machine_id) WHERE t.company_id=? AND recorded_at>=? AND recorded_at<=? AND "+selector+" AND (?='' OR m.site=?) AND (?='' OR lower(t.machine_id)=lower(?)) ORDER BY recorded_at DESC,t.id DESC LIMIT 10001",[cid,from+"T00:00:00.000Z",to+"T23:59:59.999Z",site,site,machine,machine]);
 const findings=await rows(e,"SELECT f.* FROM telemetry_condition_findings_v2 f JOIN machine_telemetry_v1 t ON t.id=f.telemetry_id AND t.company_id=f.company_id WHERE f.company_id=? AND f.source_mode=? AND t.recorded_at>=? AND t.recorded_at<=? ORDER BY f.id DESC LIMIT 200",[cid,source,from+"T00:00:00.000Z",to+"T23:59:59.999Z"]);
 const latestRows=await rows(e,"SELECT * FROM (SELECT t.*,ROW_NUMBER() OVER(PARTITION BY lower(machine_id) ORDER BY recorded_at DESC,id DESC) rank FROM machine_telemetry_v1 t WHERE company_id=? AND "+selector+") WHERE rank=1",[cid]);
 const fleet=selected.map(m=>{
  const data=readings.slice(0,10000).filter(r=>text(r.machine_id).toLowerCase()===text(m.fleet_number).toLowerCase()).sort((a,b)=>text(a.recorded_at).localeCompare(text(b.recorded_at))||number(a.id)-number(b.id)),latest=latestRows.find(r=>text(r.machine_id).toLowerCase()===text(m.fleet_number).toLowerCase()),metrics=measuredMetrics(data),meter=latest?.engine_hours==null?null:number(latest.engine_hours),due=m.next_service_hours==null?null:number(m.next_service_hours),remaining=meter==null||due==null?null:due-meter;
  const daily=new Map<string,Row[]>();for(const r of data){const day=text(r.recorded_at).slice(0,10);if(!daily.has(day))daily.set(day,[]);daily.get(day)!.push(r)}
  const daily_summaries=[...daily].map(([date,readings])=>({date,...measuredMetrics(readings),fault_readings:readings.filter(r=>text(r.fault_code)).length}));
  return {latest_reading:latest??null,daily_summaries,machine_id:m.fleet_number,site:m.site??null,...metrics,last_reading:latest?.recorded_at??null,stale:!latest||Date.now()-Date.parse(text(latest.recorded_at))>3600000,current_hour_meter:meter,hours_to_service:remaining,service_status:remaining==null?"awaiting_data":remaining<=0?"overdue":remaining<=50?"due_soon":"on_track",fault_code:latest?.fault_code??null,findings:findings.filter(f=>text(f.machine_id).toLowerCase()===text(m.fleet_number).toLowerCase()),readings:data.slice(-100)};
 });
 const documents=await rows(e,"SELECT id,machine_id,period,source_mode,generated_at,reading_count FROM telemetry_report_snapshots_v2 WHERE company_id=? AND source_mode=? ORDER BY generated_at DESC LIMIT 90",[cid,source]);
 const pending=await first(e,"SELECT COUNT(*) n FROM machine_telemetry_v1 t LEFT JOIN telemetry_analysis_receipts_v3 a ON a.telemetry_id=t.id WHERE t.company_id=? AND a.telemetry_id IS NULL",[cid]);
 const failures=await first(e,"SELECT COUNT(*) n FROM telemetry_analysis_failures_v3 f JOIN machine_telemetry_v1 t ON t.id=f.telemetry_id AND t.company_id=f.company_id WHERE f.company_id=? AND "+selector,[cid]);
 const delivery=await rows(e,"SELECT kind,status,COUNT(*) n FROM telemetry_delivery_outbox_v3 WHERE company_id=? GROUP BY kind,status",[cid]);
 const run=await first(e,"SELECT * FROM telemetry_automation_runs_v3 WHERE company_id=?",[cid]);
 return {company_id:cid,generated_at:new Date().toISOString(),source_mode:source,filters:{from,to,site,machine},sites:[...new Set(machines.map(m=>text(m.site)).filter(Boolean))],machines:fleet,reports:documents.filter(d=>selected.some(m=>text(m.fleet_number).toLowerCase()===text(d.machine_id).toLowerCase())),analysis_pending:number(pending?.n),analysis_retrying:number(failures?.n),delivery,run,readings_truncated:readings.length>10000,notes:["Measured engine runtime is not productive time or confirmed machine availability.","Downtime, repair completion and root cause require supporting records or engineer confirmation.","Unsupported production/idle counters and missing readings remain unavailable."]};
}

export function automationShell(company:string,body:string,source="live"){return new Response(`<!doctype html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>TMM Asset Health · Automatic Monitoring</title><style>*{box-sizing:border-box}body{margin:0;background:#f2f6fa;color:#142b48;font:14px system-ui,Arial}header{padding:20px 4%;background:#132b4d;color:white}nav{display:flex;gap:18px;flex-wrap:wrap;margin-top:12px}nav a{color:inherit}main{max-width:1400px;margin:auto;padding:24px}.panel{background:white;border:1px solid #dce5ef;border-radius:12px;padding:20px;margin:16px 0;overflow:auto}.cards,.grid{display:grid;grid-template-columns:repeat(auto-fit,minmax(170px,1fr));gap:12px}.card{background:white;border:1px solid #dce5ef;border-radius:10px;padding:17px}.card b{display:block;font-size:24px;margin-top:8px}input,select,button{padding:10px;border:1px solid #bbcbdc;border-radius:6px;font:inherit}label{display:grid;gap:7px}button{background:#142b48;color:white;cursor:pointer}a{color:#075b98}table{width:100%;border-collapse:collapse;min-width:650px}td,th{text-align:left;padding:12px;border-bottom:1px solid #e5ecf4}th{background:#f3f7fb}small,.muted{color:#60738b}.notice{border-left:4px solid #008e89;padding:14px;background:#e5f4f4}h1{margin-bottom:8px}h2{font-size:20px}.bad{color:#a53221}@media(max-width:650px){main{padding:12px}header{padding:18px}.panel{padding:14px}}</style></head><body><header><b>TMM ASSET HEALTH · ${escape(company)}</b><nav><a href="/contractor?view=dashboard&mode=${source}">Dashboard</a><a href="/contractor?view=fleet">Fleet registration</a><a href="/telemetry/automatic?section=health&mode=${source}">Machine health</a><a href="/telemetry/automatic?section=daily&mode=${source}">Daily summaries</a><a href="/telemetry/automatic?section=maintenance&mode=${source}">Maintenance</a><a href="/telemetry/connections/scheduled-reports">Reports</a><a href="/telemetry/connections/automation">Configuration &amp; delivery</a><a href="/telemetry/connections/diagnostic-library">Diagnostic library</a></nav></header><main>${body}</main></body></html>`,{headers:{"content-type":"text/html; charset=utf-8","cache-control":"private, no-store"}})}

export function automaticDashboard(company:string,url:URL){
 const views:Record<string,string>={dashboard:"Automatic fleet monitoring",health:"Machine health",daily:"Automatic daily summaries",maintenance:"Automatic service forecasts",alerts:"Automatic fault analysis",production:"Automatic production monitoring",reports:"Automatic reports",history:"Machine history","reports-live":"Automatic reports","management-presentation":"Automatic monitoring overview","machine-monitoring":"Machine health"};
 const requested=url.searchParams.get("section")||"dashboard",section=views[requested]?requested:"dashboard",source=url.searchParams.get("mode")==="simulation"?"simulation":"live";
 const site=url.searchParams.get("site")||"",siteOption=site?`<option value="${escape(site)}" selected>${escape(site)}</option>`:"";
 return automationShell(company,`<small class="muted">Automatic fleet monitoring</small><h1>${views[section]}</h1><p>Received machine data → central storage → analysis → saved reports. Refreshes automatically every minute; processing continues when this page is closed.</p><form id="filters" class="panel grid"><input type="hidden" name="section" value="${section}"><label>Source<select name="mode"><option value="live">Authorised live readings</option><option value="simulation">Simulation — test data only</option></select></label><label>From UTC<input type="date" name="from"></label><label>To UTC<input type="date" name="to"></label><label>Site<select name="site"><option value="">All sites</option>${siteOption}</select></label><label>Machine<input name="machine" placeholder="All registered machines"></label></form><div class="notice" id="status">Loading central telemetry…</div><div id="cards" class="cards"></div><section class="panel" data-section="fleet"><h2>Fleet readings and automatic service forecasts</h2><div id="fleet"></div></section><section class="panel" data-section="daily"><h2>Automatic daily summaries</h2><div id="daily"></div></section><section class="panel" data-section="sensors"><h2>Latest received sensors</h2><div id="sensors"></div></section><section class="panel" data-section="findings"><h2>Fault findings and condition history</h2><div id="findings"></div></section><section class="panel" data-section="reports"><h2>Automatically saved reports</h2><div id="reports"></div></section><section class="panel" data-section="notes"><h2>Data coverage</h2><div id="notes"></div><p><a href="/contractor?view=maintenance&manual=1">Record or confirm maintenance work</a> · <a href="/contractor?view=recommendations">Engineer recommendations</a></p></section><script>
 const esc=v=>String(v??'').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c])),fmt=v=>v==null?'Unavailable':Number(v).toLocaleString(undefined,{maximumFractionDigits:2}),form=document.querySelector('#filters'),initial=new URLSearchParams(location.search);
 for(const field of form.elements)if(field.name&&initial.has(field.name))field.value=initial.get(field.name);if(initial.has('fleet')&&!initial.has('machine'))form.machine.value=initial.get('fleet');
 const panels={health:['fleet','sensors','findings','notes'],'machine-monitoring':['fleet','sensors','findings','notes'],daily:['daily','notes'],maintenance:['fleet','notes'],alerts:['findings','notes'],production:['daily','sensors','notes'],reports:['reports','notes'],'reports-live':['reports','notes']};
 const visible=panels[form.section.value];if(visible)for(const panel of document.querySelectorAll('[data-section]'))panel.hidden=!visible.includes(panel.dataset.section);
 let running=false,autoDates=!initial.has('from')&&!initial.has('to'),generation=0,activeController;
 function makeParams(){const params=new URLSearchParams(new FormData(form));for(const [k,v] of [...params])if(!v)params.delete(k);if(autoDates){params.delete('from');params.delete('to')}return params}
 function machineLink(id){const params=makeParams();params.set('machine',id);params.set('section','history');return '/telemetry/automatic?'+params}
 async function load(force=false){if(running&&!force)return;if(activeController)activeController.abort();const current=++generation,controller=new AbortController();activeController=controller;running=true;const timer=setTimeout(()=>controller.abort(),20000);try{
  const params=makeParams();
  const res=await fetch('/api/telemetry/automatic?'+params,{credentials:'same-origin',cache:'no-store',signal:controller.signal});if(current!==generation)return;if(!res.ok)throw Error('Telemetry unavailable ('+res.status+')');const d=await res.json();if(current!==generation)return;const fleet=d.machines||[];
  if(autoDates||!form.from.value)form.from.value=d.filters.from;if(autoDates||!form.to.value)form.to.value=d.filters.to;
  const site=form.site.value;form.site.innerHTML='<option value="">All sites</option>'+[...new Set([...(d.sites||[]),...(site?[site]:[])])].map(s=>'<option>'+esc(s)+'</option>').join('');form.site.value=site;
  document.querySelector('#status').textContent=(d.source_mode==='simulation'?'SIMULATED TEST DATA ONLY. ':'LIVE SOURCE. ')+d.analysis_pending+' reading(s) awaiting scheduled analysis; '+(d.analysis_retrying||0)+' awaiting retry. Latest report cycle: '+(d.run?.last_report_at||'Awaiting data')+'.';
  const known=fleet.filter(m=>m.operating_hours!=null),sum=known.length?known.reduce((n,m)=>n+m.operating_hours,0):null;
  document.querySelector('#cards').innerHTML=[['Registered machines',fleet.length],['Machines reporting',fleet.filter(m=>m.reading_count>0).length],['Measured runtime (h)',sum],['Measured production (t)',fleet.length&&fleet.every(m=>m.production_tonnes!=null)?fleet.reduce((n,m)=>n+m.production_tonnes,0):null],['Service due / overdue',fleet.filter(m=>['overdue','due_soon'].includes(m.service_status)).length],['Stale / missing readings',fleet.filter(m=>m.stale).length]].map(([k,v])=>'<div class="card"><small>'+esc(k)+'</small><b>'+fmt(v)+'</b></div>').join('');
  document.querySelector('#fleet').innerHTML='<table><tr><th>Machine / site</th><th>Last reading UTC</th><th>Runtime h</th><th>Meter</th><th>Service remaining h</th><th>Status</th></tr>'+fleet.map(m=>'<tr><td><a href="'+esc(machineLink(m.machine_id))+'">'+esc(m.machine_id)+'</a><br>'+esc(m.site)+'</td><td>'+esc(m.last_reading||'No received data')+'</td><td>'+fmt(m.operating_hours)+'</td><td>'+fmt(m.current_hour_meter)+'</td><td>'+fmt(m.hours_to_service)+'</td><td>'+esc(m.service_status)+(m.stale?' · stale':'')+'</td></tr>').join('')+'</table>';
  document.querySelector('#daily').innerHTML='<table><tr><th>Machine</th><th>Date UTC</th><th>Readings</th><th>Runtime h</th><th>Production t</th><th>Fault observations</th></tr>'+fleet.flatMap(m=>m.daily_summaries.map(x=>'<tr><td>'+esc(m.machine_id)+'</td><td>'+esc(x.date)+'</td><td>'+x.reading_count+'</td><td>'+fmt(x.operating_hours)+'</td><td>'+fmt(x.production_tonnes)+'</td><td>'+x.fault_readings+'</td></tr>')).join('')+'</table><p class="muted">Daily counts use the selected received-data window, up to the disclosed 10,000-reading limit. Fault observations are not confirmed breakdowns.</p>';
  document.querySelector('#sensors').innerHTML='<table><tr><th>Machine</th><th>Fuel level</th><th>Coolant</th><th>Oil pressure</th><th>Hydraulic pressure</th><th>Battery</th></tr>'+fleet.map(m=>{const r=m.latest_reading||{};let p={};try{p=JSON.parse(r.raw_json||'{}')}catch{}const units=p.units||{},value=(key)=>{const v=p[key]??r[key];return v==null?'Unavailable':esc(v)+' '+esc(units[key]||'unit not supplied')};return '<tr><td>'+esc(m.machine_id)+'</td><td>'+value('fuel_level')+'</td><td>'+value('coolant_temperature')+'</td><td>'+value('engine_oil_pressure')+'</td><td>'+value('hydraulic_pressure')+'</td><td>'+value('battery_voltage')+'</td></tr>'}).join('')+'</table>';
  document.querySelector('#findings').innerHTML='<table><tr><th>Machine</th><th>Source</th><th>Code / category</th><th>Finding</th></tr>'+fleet.flatMap(m=>m.findings.map(f=>'<tr><td>'+esc(m.machine_id)+'</td><td>'+esc(f.source_mode)+'</td><td>'+esc(f.diagnostic_code||f.category)+'</td><td>'+esc(f.details)+'</td></tr>')).join('')+'</table>';
  document.querySelector('#reports').innerHTML=d.reports.length?d.reports.map(r=>'<p><a href="/telemetry/connections/report-document?id='+r.id+'">'+esc(r.machine_id)+' · '+esc(r.period)+' · '+esc(r.source_mode)+'</a> — '+esc(r.generated_at)+'</p>').join(''):'No saved reports yet; the scheduler will produce them after data arrives.';
  document.querySelector('#notes').innerHTML=d.notes.map(n=>'<p>'+esc(n)+'</p>').join('')+(d.readings_truncated?'<p class="bad">Query exceeded 10,000 readings; narrow the date range.</p>':'');
 }catch(e){if(current===generation)document.querySelector('#status').textContent=e.name==='AbortError'?'Refresh timed out; automatic retry will continue.':e.message}finally{clearTimeout(timer);if(current===generation)running=false}}
 form.addEventListener('change',event=>{if(['from','to'].includes(event.target.name))autoDates=!form.from.value&&!form.to.value;history.replaceState(null,'','/telemetry/automatic?'+makeParams());load(true)});load();setInterval(load,60000);
 </script>`,source);
}
