import { ensureAutomation, runTelemetryAutomation, automaticFleetData, automaticDashboard, automationShell } from "./telemetry-automation";
import currentApp, { saveReading, ensureTelemetryStorage } from "./router-telemetry-ready";

interface ExecutionContext { waitUntil(promise:Promise<unknown>):void; passThroughOnException():void; }
interface ScheduledController { scheduledTime:number; cron:string; noRetry():void; }
interface Env { DB:D1Database; [key:string]:unknown; }
type Row=Record<string,unknown>;
type Session={companyId:number;accountId:number;role:string;fullName:string;companyName:string};

const COOKIE="sas_contractor_v2",enc=new TextEncoder();
const txt=(v:unknown,n=300)=>String(v??"").trim().slice(0,n);
const low=(v:unknown,n=300)=>txt(v,n).toLowerCase();
const num=(v:unknown,f=0)=>{const n=Number(v);return Number.isFinite(n)?n:f};
const esc=(v:unknown)=>String(v??"").replace(/[&<>"']/g,c=>({"&":"&amp;","<":"&lt;",">":"&gt;",'"':"&quot;","'":"&#39;"}[c]||c));
async function hash(v:string){return Array.from(new Uint8Array(await crypto.subtle.digest("SHA-256",enc.encode(v))),b=>b.toString(16).padStart(2,"0")).join("")}
async function first(env:Env,sql:string,b:unknown[]=[]){return env.DB.prepare(sql).bind(...b).first<Row>()}
async function all(env:Env,sql:string,b:unknown[]=[]){return (await env.DB.prepare(sql).bind(...b).all<Row>()).results||[]}
function cookie(req:Request){for(const p of (req.headers.get("cookie")||"").split(";")){const i=p.indexOf("=");if(i>0&&p.slice(0,i).trim()===COOKIE)return p.slice(i+1).trim()}return ""}
function json(v:unknown,status=200){return Response.json(v,{status,headers:{"cache-control":"no-store"}})}
function redirect(location:string){return new Response(null,{status:303,headers:{location,"cache-control":"no-store"}})}
function token(){const b=crypto.getRandomValues(new Uint8Array(32));return Array.from(b,x=>x.toString(16).padStart(2,"0")).join("")}
async function session(req:Request,env:Env):Promise<Session|null>{const raw=cookie(req);if(!raw)return null;const r=await first(env,`SELECT s.company_id companyId,s.account_id accountId,COALESCE(NULLIF(s.active_role,''),a.role) role,a.full_name fullName,c.name companyName FROM contractor_sessions s JOIN contractor_accounts a ON a.id=s.account_id AND a.company_id=s.company_id JOIN companies c ON c.id=s.company_id WHERE s.token_hash=? AND datetime(s.expires_at)>datetime('now') AND a.status='active' LIMIT 1`,[await hash(raw)]).catch(()=>null);return r?{companyId:num(r.companyId),accountId:num(r.accountId),role:low(r.role),fullName:txt(r.fullName),companyName:txt(r.companyName)}:null}

const schemas=new WeakMap<D1Database,Promise<void>>();
async function ensure(env:Env){const existing=schemas.get(env.DB);if(existing)return existing;const schema=(async()=>{await ensureTelemetryStorage(env);await ensureAutomation(env);for(const q of [
`CREATE TABLE IF NOT EXISTS telemetry_connections_v2(id INTEGER PRIMARY KEY AUTOINCREMENT,company_id INTEGER NOT NULL,provider TEXT NOT NULL,connection_name TEXT NOT NULL,source_key TEXT NOT NULL UNIQUE,token_hash TEXT NOT NULL,status TEXT NOT NULL DEFAULT 'active',created_by INTEGER NOT NULL,created_at TEXT NOT NULL,last_seen_at TEXT,last_success_at TEXT,last_error TEXT)`,
`CREATE TABLE IF NOT EXISTS telemetry_discovered_assets_v1(id INTEGER PRIMARY KEY AUTOINCREMENT,company_id INTEGER NOT NULL,connection_id INTEGER NOT NULL,external_key TEXT NOT NULL,external_machine_id TEXT NOT NULL,machine_id TEXT NOT NULL,metadata_json TEXT NOT NULL,latest_recorded_at TEXT NOT NULL,status TEXT NOT NULL DEFAULT 'awaiting_site',site TEXT,assigned_by INTEGER,assigned_at TEXT,created_at TEXT NOT NULL,UNIQUE(company_id,connection_id,external_key))`,
`CREATE INDEX IF NOT EXISTS idx_telemetry_connections_company ON telemetry_connections_v2(company_id,status)`,
`CREATE TABLE IF NOT EXISTS telemetry_machine_map_v2(id INTEGER PRIMARY KEY AUTOINCREMENT,company_id INTEGER NOT NULL,connection_id INTEGER NOT NULL,external_machine_id TEXT NOT NULL,machine_id TEXT NOT NULL,created_at TEXT NOT NULL,UNIQUE(connection_id,external_machine_id))`,
`CREATE INDEX IF NOT EXISTS idx_telemetry_map_company ON telemetry_machine_map_v2(company_id,connection_id)`,
`CREATE TABLE IF NOT EXISTS telemetry_ingest_v2(id INTEGER PRIMARY KEY AUTOINCREMENT,company_id INTEGER NOT NULL,connection_id INTEGER NOT NULL,event_key TEXT NOT NULL UNIQUE,external_machine_id TEXT,recorded_at TEXT,raw_json TEXT NOT NULL,payload_hash TEXT NOT NULL,status TEXT NOT NULL,error TEXT,telemetry_id INTEGER,received_at TEXT NOT NULL,processed_at TEXT)`,
`CREATE INDEX IF NOT EXISTS idx_telemetry_ingest_company_time ON telemetry_ingest_v2(company_id,received_at DESC)`,
`CREATE TABLE IF NOT EXISTS telemetry_quarantine_v2(id INTEGER PRIMARY KEY AUTOINCREMENT,company_id INTEGER NOT NULL,connection_id INTEGER NOT NULL,ingest_id INTEGER,reason TEXT NOT NULL,raw_json TEXT NOT NULL,created_at TEXT NOT NULL,resolved_at TEXT,resolved_by INTEGER)`,
`CREATE TABLE IF NOT EXISTS telemetry_thresholds_v2(id INTEGER PRIMARY KEY AUTOINCREMENT,company_id INTEGER NOT NULL,machine_id TEXT,metric TEXT NOT NULL,warning_value REAL,critical_value REAL,comparison TEXT NOT NULL,unit TEXT,status TEXT NOT NULL DEFAULT 'active',created_at TEXT NOT NULL,UNIQUE(company_id,machine_id,metric))`
])await env.DB.prepare(q).run()})().catch(e=>{schemas.delete(env.DB);throw e});schemas.set(env.DB,schema);return schema}

function stableJson(value:unknown):string{
 if(Array.isArray(value))return "["+value.map(stableJson).join(",")+"]";
 if(value&&typeof value==="object")return "{"+Object.keys(value).sort().map(k=>JSON.stringify(k)+":"+stableJson((value as Row)[k])).join(",")+"}";
 return JSON.stringify(value)??"null";
}
function providerValue(p:Row,...names:string[]){for(const n of names)if(p[n]!==undefined&&p[n]!==null&&p[n]!=="")return p[n];return null}
function normalize(p:Row,machineId:string){const faults=providerValue(p,"fault_codes","faultCodes","diagnostic_codes","diagnosticCodes","activeFaults","active_faults","diagnostics","dtcs","DTCs");
 const codes=Array.isArray(faults)?faults.map(f=>{if(typeof f==="string"||typeof f==="number")return String(f);if(f&&typeof f==="object"){const o=f as Row;const spn=providerValue(o,"spn","SPN"),fmi=providerValue(o,"fmi","FMI"),code=providerValue(o,"code","faultCode","fault_code","dtc","DTC");return code!=null?String(code):spn!=null&&fmi!=null?"SPN "+spn+" FMI "+fmi:""}return ""}).filter(Boolean):null;
 const invalidFaults=Array.isArray(faults)&&(faults.length>50||faults.some(f=>{
  if(typeof f==="string")return !f.trim();if(typeof f==="number")return !Number.isFinite(f);
  if(!f||typeof f!=="object"||Array.isArray(f))return true;
  const o=f as Row,code=providerValue(o,"code","faultCode","fault_code","dtc","DTC");
  if(code!=null)return !(typeof code==="string"&&code.trim()||typeof code==="number"&&Number.isFinite(code));
  const spn=providerValue(o,"spn","SPN"),fmi=providerValue(o,"fmi","FMI");
  return spn==null||fmi==null||!(typeof spn==="number"||typeof spn==="string"&&/^\d+$/.test(spn.trim()))||!(typeof fmi==="number"||typeof fmi==="string"&&/^\d+$/.test(fmi.trim()))||!Number.isInteger(Number(spn))||!Number.isInteger(Number(fmi))||Number(spn)<0||Number(spn)>524287||Number(fmi)<0||Number(fmi)>31;
 }));
 return {
 _invalid_fault_codes:invalidFaults,
 machine_id:machineId,
 timestamp:providerValue(p,"recorded_at","recordedAt","timestamp","event_time","eventTime"),
 engine_hours:providerValue(p,"engine_hours","engineHours","hour_meter","hourMeter","smr"),
 ignition_status:providerValue(p,"ignition_status","ignitionStatus","ignition"),
 latitude:providerValue(p,"latitude","lat"),longitude:providerValue(p,"longitude","lng","lon"),
 fuel_level:providerValue(p,"fuel_level","fuelLevel","fuel_percent","fuelPercent"),
 odometer:providerValue(p,"odometer","distance"),hydraulic_pressure:providerValue(p,"hydraulic_pressure","hydraulicPressure"),
 hydraulic_oil_level:providerValue(p,"hydraulic_oil_level","hydraulicOilLevel"),engine_oil_pressure:providerValue(p,"engine_oil_pressure","engineOilPressure"),
 coolant_temperature:providerValue(p,"coolant_temperature","coolantTemperature","coolant_temp_c"),rpm:providerValue(p,"rpm","engine_rpm","engineRpm"),
 engine_load:providerValue(p,"engine_load","engineLoad"),fault_code:codes?codes.join(", "):providerValue(p,"fault_code","faultCode","diagnostic_code","diagnosticCode","dtc","DTC")??(typeof faults==="string"?faults:null),battery_voltage:providerValue(p,"battery_voltage","batteryVoltage"),fuel_consumption_lph:providerValue(p,"fuel_consumption_lph","fuelConsumptionLph"),hydraulic_temperature:providerValue(p,"hydraulic_temperature","hydraulicTemperature"),transmission_temperature:providerValue(p,"transmission_temperature","transmissionTemperature"),transmission_gear:providerValue(p,"transmission_gear","transmissionGear"),idle_hours:providerValue(p,"idle_hours","idleHours"),cycle_count:providerValue(p,"cycle_count","cycleCount"),payload_tonnes:providerValue(p,"payload_tonnes","payloadTonnes"),production_tonnes:providerValue(p,"production_tonnes","productionTonnes"),service_due_hours:providerValue(p,"service_due_hours","serviceDueHours"),machine_events:providerValue(p,"machine_events","machineEvents"),test_data:providerValue(p,"test_data"),units:providerValue(p,"units"),counter_semantics:providerValue(p,"counter_semantics"),scheduled_hours:providerValue(p,"scheduled_hours"),available_hours:providerValue(p,"available_hours"),productive_hours:providerValue(p,"productive_hours"),fuel_litres:providerValue(p,"fuel_litres")
}}
function validate(p:Row){
 const numeric=(v:unknown)=>typeof v==="number"?Number.isFinite(v):typeof v==="string"&&/^[+-]?(?:\d+\.?\d*|\.\d+)(?:e[+-]?\d+)?$/i.test(v.trim())&&Number.isFinite(Number(v));
 const ranges:Record<string,[number,number]>={scheduled_hours:[0,1e9],available_hours:[0,1e9],productive_hours:[0,1e9],engine_hours:[0,1e9],fuel_level:[0,100],coolant_temperature:[-50,180],latitude:[-90,90],longitude:[-180,180],odometer:[0,1e10],hydraulic_pressure:[0,1e9],hydraulic_oil_level:[0,100],engine_oil_pressure:[0,1e9],rpm:[0,30000],engine_load:[0,1e9],battery_voltage:[0,120],fuel_consumption_lph:[0,2000],hydraulic_temperature:[-50,200],transmission_temperature:[-50,200],idle_hours:[0,1e6],cycle_count:[0,1e8],payload_tonnes:[0,1000],production_tonnes:[0,1e8],service_due_hours:[0,1e6],fuel_litres:[0,1e10]};
 for(const [field,[min,max]] of Object.entries(ranges))if(p[field]!=null){if(!numeric(p[field]))return field+" must be a finite decimal measurement";const v=Number(p[field]);if(v<min||v>max)return field+" is outside the accepted range";}
 if(p.test_data!=null&&typeof p.test_data!=="boolean")return "test_data must be a boolean";
 for(const name of ["units","counter_semantics"]){
  const value=p[name];if(value==null)continue;
  if(typeof value!=="object"||Array.isArray(value)||Object.values(value).some(v=>typeof v!=="string"||v.length>60))return name+" must be an object of string values";
  if(name==="counter_semantics"&&Object.values(value).some(v=>!["cumulative","instantaneous","increment"].includes(String(v))))return "Unknown counter semantics";
 }
 if(p.fault_code!=null&&typeof p.fault_code!=="string"&&typeof p.fault_code!=="number")return "fault_code must be an identifier";
 if(p._invalid_fault_codes)return "Fault arrays require at most 50 valid identifiers or integer SPN/FMI pairs in range";
 if(String(p.fault_code??"").length>4000)return "Fault-code message exceeds the supported length";
 const stamp=String(p.timestamp||""),match=/^(\d{4}-\d{2}-\d{2})T(\d{2}):(\d{2})(?::(\d{2})(?:\.\d+)?)?(?:Z|[+-]\d{2}:\d{2})$/i.exec(stamp);
 const ts=new Date(stamp),calendar=match?new Date(match[1]+"T00:00:00Z"):null;
 if(!match||!calendar||!Number.isFinite(ts.getTime())||!Number.isFinite(calendar.getTime())||calendar.toISOString().slice(0,10)!==match[1]||Number(match[2])>23||Number(match[3])>59||Number(match[4]||0)>59)return "A valid ISO machine timestamp with timezone is required";
 const age=Date.now()-ts.getTime();if(age< -10*60000)return "Timestamp is more than 10 minutes in the future";if(age>30*86400000)return "Timestamp is older than 30 days";
 return "";
}
async function quarantine(env:Env,c:Row,raw:string,external:string,recorded:string,eventKey:string,reason:string){const now=new Date().toISOString(),ph=await hash(raw);const ins=await env.DB.prepare("INSERT OR IGNORE INTO telemetry_ingest_v2(company_id,connection_id,event_key,external_machine_id,recorded_at,raw_json,payload_hash,status,error,received_at,processed_at) VALUES(?,?,?,?,?,?,?,?,?,?,?)").bind(num(c.company_id),num(c.id),eventKey,external||null,recorded||null,raw,ph,"quarantined",reason,now,now).run();const id=num(ins.meta?.last_row_id);if(id)await env.DB.prepare("INSERT INTO telemetry_quarantine_v2(company_id,connection_id,ingest_id,reason,raw_json,created_at) VALUES(?,?,?,?,?,?)").bind(num(c.company_id),num(c.id),id,reason,raw,now).run();return {status:"quarantined",reason}}

/** Discovery stores source assertions, not decoded fault-code guesses. */
async function discover(env:Env,c:Row,p:Row,external:string,recorded:string){
 if(!external)return null;
 const key=external.toLowerCase(),old=await first(env,'SELECT * FROM telemetry_discovered_assets_v1 WHERE company_id=? AND connection_id=? AND external_key=?',[c.company_id,c.id,key]);
 const prior=old?JSON.parse(String(old.metadata_json)):{};
 const incoming=p.asset&&typeof p.asset==='object'&&!Array.isArray(p.asset)?p.asset as Row:p;
 const identity={...prior,...incoming};
 if(!old&&![identity.serial_number,identity.model,identity.machine_type].some(v=>typeof v==='string'&&v.trim()))return null;
 for(const name of ['serial_number','manufacturer','model','machine_type']){
  const v=identity[name];if(v!=null&&(typeof v!=='string'||v.length>160))throw Error('Invalid machine identity field: '+name);
  if(old&&['serial_number','manufacturer','model'].includes(name)&&prior[name]&&v&&low(prior[name])!==low(v))throw Error('External identity changed; review source mapping');
 }
 const valid=(v:unknown)=>typeof v==='number'&&Number.isFinite(v)&&v>=0&&v<=1e9;
 for(const k of ['next_service_hours','service_interval_hours','last_service_hours'])if(identity[k]!=null&&!valid(identity[k]))throw Error('Invalid source service value: '+k);
 if(identity.service_interval_hours===0||identity.service_reference!=null&&(typeof identity.service_reference!=='string'||identity.service_reference.length>500))throw Error('Invalid source service schedule');
 const direct=incoming.next_service_hours??(incoming.service_interval_hours==null?prior.next_service_hours:null),interval=identity.service_interval_hours,last=identity.last_service_hours;
 const due=direct??(interval!=null&&last!=null&&txt(identity.service_reference)?Number(interval)+Number(last):null);
 if(due!=null&&!valid(due))throw Error('Invalid next service hour');
 const normalized=normalize(p,''),metadata={serial_number:identity.serial_number??null,manufacturer:identity.manufacturer??null,model:identity.model??null,machine_type:identity.machine_type??null,engine_hours:normalized.engine_hours??prior.engine_hours??null,next_service_hours:due,service_reference:identity.service_reference??null,service_interval_hours:interval??null,last_service_hours:last??null,source_mode:p.test_data===true||String(c.source_key).includes('staging-test')?'simulation':'live'};
 const now=new Date().toISOString(),stamp=new Date(recorded).toISOString();
 await env.DB.prepare(`INSERT INTO telemetry_discovered_assets_v1(company_id,connection_id,external_key,external_machine_id,machine_id,metadata_json,latest_recorded_at,created_at) VALUES(?,?,?,?,?,?,?,?) ON CONFLICT(company_id,connection_id,external_key) DO UPDATE SET metadata_json=CASE WHEN excluded.latest_recorded_at>=latest_recorded_at THEN excluded.metadata_json ELSE metadata_json END,latest_recorded_at=MAX(latest_recorded_at,excluded.latest_recorded_at)`).bind(c.company_id,c.id,key,external,'AUTO-'+c.id+'-'+(await hash(key)).slice(0,16),JSON.stringify(metadata),stamp,now).run();
 return first(env,'SELECT * FROM telemetry_discovered_assets_v1 WHERE company_id=? AND connection_id=? AND external_key=?',[c.company_id,c.id,key]);
}
async function discoveredAssets(req:Request,env:Env,s:Session){
 await ensure(env);const csrf=await hash(cookie(req)),admin=['company_admin','admin'].includes(s.role);
 if(req.method==='POST'){
  if(!admin||req.headers.get('origin')!==new URL(req.url).origin)return new Response('Forbidden',{status:403});
  const f=await req.formData();if(f.get('csrf')!==csrf)return new Response('Invalid request token',{status:403});
  const site=txt(f.get('site'),120),d=await first(env,`SELECT d.* FROM telemetry_discovered_assets_v1 d JOIN telemetry_connections_v2 c ON c.id=d.connection_id AND c.company_id=d.company_id WHERE d.id=? AND d.company_id=? AND c.status='active'`,[num(f.get('id')),s.companyId]);
  if(!site||!d)return new Response('Choose a discovered machine and site',{status:400});
  const m=JSON.parse(String(d.metadata_json));if(m.source_mode==='simulation')return new Response('Simulation cannot register live equipment',{status:400});
  const existing=await first(env,'SELECT id FROM machines WHERE company_id=? AND fleet_number=?',[s.companyId,d.machine_id]);
  const pilot=await first(env,'SELECT max_machines,max_sites FROM company_pilot_limits_v1 WHERE company_id=?',[s.companyId]).catch(()=>null);
  if(pilot){
   const count=await first(env,'SELECT COUNT(*) n FROM machines WHERE company_id=?',[s.companyId]);if(!existing&&num(count?.n)>=num(pilot.max_machines))return new Response('Pilot machine limit reached',{status:409});
   const sites=await all(env,'SELECT site FROM machines WHERE company_id=? UNION SELECT name site FROM company_sites WHERE company_id=? AND active=1',[s.companyId,s.companyId]);if(!sites.some(r=>low(r.site)===site.toLowerCase())&&new Set(sites.map(r=>low(r.site)).filter(Boolean)).size>=num(pilot.max_sites))return new Response('Pilot site limit reached',{status:409});
  }
  const mapped=await first(env,'SELECT machine_id FROM telemetry_machine_map_v2 WHERE company_id=? AND connection_id=? AND lower(external_machine_id)=?',[s.companyId,d.connection_id,d.external_key]);
  if(mapped&&mapped.machine_id!==d.machine_id)return new Response('Source already mapped to another fleet machine; review mapping',{status:409});
  const now=new Date().toISOString();
  // Atomic insert-select and deterministic IDs protect retries; no guessed service interval.
  await env.DB.prepare(`INSERT INTO machines(company_id,fleet_number,category,site,status,operating_hours,next_service_hours,created_at) SELECT ?,?,?,?,?,?,?,? WHERE NOT EXISTS(SELECT 1 FROM machines WHERE company_id=? AND lower(fleet_number)=lower(?))`).bind(s.companyId,d.machine_id,m.machine_type||'Type not supplied',site,'awaiting_data',m.engine_hours==null?0:num(m.engine_hours),m.next_service_hours??null,now,s.companyId,d.machine_id).run();
  await env.DB.prepare('UPDATE machines SET site=? WHERE company_id=? AND fleet_number=?').bind(site,s.companyId,d.machine_id).run();
  await env.DB.prepare('INSERT OR IGNORE INTO telemetry_machine_map_v2(company_id,connection_id,external_machine_id,machine_id,created_at) VALUES(?,?,?,?,?)').bind(s.companyId,d.connection_id,d.external_key,d.machine_id,now).run();
  await env.DB.prepare("UPDATE telemetry_discovered_assets_v1 SET status='registered',site=?,assigned_by=?,assigned_at=? WHERE id=? AND company_id=?").bind(site,s.accountId,now,d.id,s.companyId).run();
  return redirect('/telemetry/connections/discovered?assigned=1');
 }
 if(req.method!=='GET')return new Response('Method not allowed',{status:405});
 const candidates=await all(env,`SELECT d.*,c.connection_name FROM telemetry_discovered_assets_v1 d JOIN telemetry_connections_v2 c ON c.id=d.connection_id AND c.company_id=d.company_id WHERE d.company_id=? ORDER BY d.created_at DESC LIMIT 200`,[s.companyId]);
 return page(s,`<h1>Discovered machines</h1><p>Incoming authorised identity data fills these details automatically. Enter a site once to complete registration. Retained readings transfer into analysis and reports on the next scheduled cycle.</p><p><a href="/telemetry/connections">Connect a data source</a> · <a href="/contractor?view=fleet">Manual fleet registration</a></p>${new URL(req.url).searchParams.has('assigned')?'<p class="notice">Site saved. Automatic transfer continues on the schedule.</p>':''}<section class="panel"><table><tr><th>Source / identity</th><th>Make / model / type</th><th>Hour meter</th><th>Maintenance due</th><th>Registration / site</th></tr>${candidates.map(d=>{const m=JSON.parse(String(d.metadata_json));return `<tr><td>${esc(d.connection_name)}<br>${esc(d.external_machine_id)}<br>Serial: ${esc(m.serial_number||'Not supplied')}<br>${esc(d.machine_id)}</td><td>${esc(m.manufacturer||'Make not supplied')} ${esc(m.model||'')}<br>${esc(m.machine_type||'Type not supplied')}${m.source_mode==='simulation'?'<b>SIMULATION ONLY</b>':''}</td><td>${m.engine_hours==null?'Not supplied':esc(m.engine_hours)+' h'}<br><small>${esc(d.latest_recorded_at)}</small></td><td>${m.next_service_hours==null?'Schedule required':esc(m.next_service_hours)+' h'}<br>${esc(m.service_reference||'Source value; verify applicability')}</td><td>${esc(d.status)}${admin&&m.source_mode!=='simulation'?`<form method="post"><input type="hidden" name="csrf" value="${csrf}"><input type="hidden" name="id" value="${num(d.id)}"><label>Site<input name="site" required maxlength="120" value="${esc(d.site||'')}"></label><button>Save site${d.status==='registered'?'':' and register'}</button></form>`:esc(d.site||'Awaiting administrator site assignment')}</td></tr>`}).join('')||'<tr><td colspan="5">No machines discovered yet. Send an external machine ID with serial number, model or machine type through a registered connection.</td></tr>'}</table></section><p>Showing up to 200 discoveries. Missing details remain unknown; no universal service interval is assumed. Discovery identity is scoped to a connection. Keep existing fleet mappings when connecting another source for the same machine to avoid a second registration.</p>`);
}
async function replayDiscovered(env:Env){
 await ensure(env);
 const pending=await all(env,`SELECT i.*,m.machine_id,c.provider,c.source_key FROM telemetry_ingest_v2 i JOIN telemetry_connections_v2 c ON c.id=i.connection_id AND c.company_id=i.company_id AND c.status='active' JOIN telemetry_machine_map_v2 m ON m.connection_id=i.connection_id AND m.company_id=i.company_id AND lower(m.external_machine_id)=lower(i.external_machine_id) WHERE i.status='discovered' ORDER BY i.id LIMIT 50`);
 for(const r of pending)try{
  const saved=await saveReading(env,num(r.company_id),{...normalize(JSON.parse(String(r.raw_json)),String(r.machine_id)),ingestion_key:r.event_key},`${low(r.provider,40)}:${r.source_key}`);
  await env.DB.prepare("UPDATE telemetry_ingest_v2 SET status='accepted',telemetry_id=?,error=NULL,processed_at=? WHERE id=? AND company_id=?").bind(saved.id,new Date().toISOString(),r.id,r.company_id).run();
 }catch(error){await env.DB.prepare('UPDATE telemetry_ingest_v2 SET error=? WHERE id=? AND company_id=?').bind(String(error),r.id,r.company_id).run()}
}

async function ingest(req:Request,env:Env){
 await ensure(env);
 if(req.method!=="POST")return json({error:"POST required"},405);
 const source=txt(req.headers.get("x-telemetry-source"),120),auth=req.headers.get("authorization")||"",bearer=auth.startsWith("Bearer ")?auth.slice(7):"";
 if(!source||!bearer)return json({error:"x-telemetry-source and Bearer token are required"},401);
 const c=await first(env,"SELECT * FROM telemetry_connections_v2 WHERE source_key=? AND status='active' LIMIT 1",[source]);
 if(!c||await hash(bearer)!==String(c.token_hash))return json({error:"Unknown or inactive telemetry connection"},401);
 if(Number(req.headers.get("content-length")||0)>512000)return json({error:"Payload exceeds 500 KiB"},413);
 let body:unknown;
 try{const rawBody=await req.text();if(enc.encode(rawBody).byteLength>512000)return json({error:"Payload exceeds 500 KiB"},413);body=JSON.parse(rawBody)}catch{return json({error:"Invalid JSON"},400)}
 const items=Array.isArray(body)?body:[body];
 if(!items.length)return json({error:"At least one reading is required"},400);
 if(items.length>100)return json({error:"Maximum batch size is 100 readings"},413);
 const results:Row[]=[];
 for(const item of items){
  if(!item||typeof item!=="object"||Array.isArray(item)){results.push({status:"rejected",reason:"Reading must be an object"});continue}
  const p=item as Row,raw=JSON.stringify(p),external=txt(providerValue(p,"external_machine_id","externalMachineId","machine_id","machineId","serial_number","serialNumber"),160),recorded=txt(providerValue(p,"recorded_at","recordedAt","timestamp","event_time","eventTime"),60),providerEvent=txt(providerValue(p,"event_id","eventId","message_id","messageId"),160);
  const canonical=stableJson(p),eventKey=providerEvent?`${num(c.id)}:${providerEvent}`:await hash(`${c.id}|${external}|${recorded}|${canonical}`),ph=await hash(canonical);
  const duplicate=await first(env,"SELECT id,status,error,payload_hash,raw_json,received_at FROM telemetry_ingest_v2 WHERE event_key=? LIMIT 1",[eventKey]);
  if(duplicate){
   let equivalent=duplicate.payload_hash===ph||duplicate.payload_hash===await hash(raw);
   if(!equivalent){try{equivalent=await hash(stableJson(JSON.parse(String(duplicate.raw_json))))===ph}catch{}}
   if(!equivalent){results.push({status:"rejected",reason:"Event ID was reused with a different payload"});continue}
   if(duplicate.status==="accepted"){results.push({status:"duplicate",ingest_id:num(duplicate.id)});continue}
   if(duplicate.status==="quarantined"){results.push({status:"quarantined",reason:duplicate.error,ingest_id:num(duplicate.id)});continue}
   if(duplicate.status==="processing"&&Date.now()-Date.parse(String(duplicate.received_at))<120000){results.push({status:"pending",reason:"Event is being processed; retry later",ingest_id:num(duplicate.id)});continue}
  }
  const map=external?await first(env,"SELECT machine_id machineId FROM telemetry_machine_map_v2 WHERE company_id=? AND connection_id=? AND lower(external_machine_id)=lower(?) LIMIT 1",[num(c.company_id),num(c.id),external]):null;
  const normalized=normalize(p,txt(map?.machineId,120)),problem=validate(normalized);
  if(!map){
   if(problem){results.push(await quarantine(env,c,raw,external,recorded,eventKey,problem));continue}
   try{const d=await discover(env,c,p,external,recorded);if(d){await env.DB.prepare("INSERT OR IGNORE INTO telemetry_ingest_v2(company_id,connection_id,event_key,external_machine_id,recorded_at,raw_json,payload_hash,status,received_at) VALUES(?,?,?,?,?,?,?,'discovered',?)").bind(c.company_id,c.id,eventKey,external,recorded,raw,ph,new Date().toISOString()).run();results.push({status:'discovered',discovery_id:d.id,reason:'Durably received; awaiting site assignment'});continue}}
   catch(error){results.push(await quarantine(env,c,raw,external,recorded,eventKey,String(error)));continue}
   results.push(await quarantine(env,c,raw,external,recorded,eventKey,"External machine is not mapped to a registered fleet machine"));continue;
  }
  if(problem){results.push(await quarantine(env,c,raw,external,recorded,eventKey,problem));continue}
  const discovered=await first(env,'SELECT id FROM telemetry_discovered_assets_v1 WHERE company_id=? AND connection_id=? AND external_key=?',[c.company_id,c.id,external.toLowerCase()]);
  if(discovered)try{const d=await discover(env,c,p,external,recorded);if(d?.status==='registered'&&d.latest_recorded_at===new Date(recorded).toISOString()&&p.test_data!==true){const m=JSON.parse(String(d.metadata_json));if(m.next_service_hours!=null)await env.DB.prepare('UPDATE machines SET next_service_hours=? WHERE company_id=? AND fleet_number=?').bind(m.next_service_hours,c.company_id,d.machine_id).run()}}catch(error){results.push(await quarantine(env,c,raw,external,recorded,eventKey,String(error)));continue}
  const now=new Date().toISOString();let ingestId=num(duplicate?.id);
  if(!duplicate){
   const receipt=await env.DB.prepare("INSERT OR IGNORE INTO telemetry_ingest_v2(company_id,connection_id,event_key,external_machine_id,recorded_at,raw_json,payload_hash,status,received_at) VALUES(?,?,?,?,?,?,?,?,?)").bind(num(c.company_id),num(c.id),eventKey,external,recorded,raw,ph,"processing",now).run();
   if(receipt.meta?.changes===0){results.push({status:"pending",reason:"Concurrent event receipt; retry later"});continue}
   ingestId=num(receipt.meta?.last_row_id);
  }else await env.DB.prepare("UPDATE telemetry_ingest_v2 SET status='processing',error=NULL,received_at=? WHERE id=?").bind(now,ingestId).run();
  try{
   const saved=await saveReading(env,num(c.company_id),{...normalized,ingestion_key:eventKey},`${low(c.provider,40)}:${source}`);
   await env.DB.prepare("UPDATE telemetry_ingest_v2 SET status='accepted',telemetry_id=?,error=NULL,processed_at=? WHERE id=?").bind(num(saved.id),new Date().toISOString(),ingestId).run();
   await env.DB.prepare("UPDATE telemetry_connections_v2 SET last_seen_at=?,last_success_at=?,last_error=NULL WHERE id=?").bind(now,now,num(c.id)).run();
   results.push({status:"accepted",ingest_id:ingestId,telemetry_id:saved.id,machine_id:saved.machine_id});
  }catch(e){
   const reason=e instanceof Error?e.message:String(e);
   await env.DB.prepare("UPDATE telemetry_ingest_v2 SET status='failed',error=?,processed_at=? WHERE id=?").bind(reason,new Date().toISOString(),ingestId).run();
   await env.DB.prepare("UPDATE telemetry_connections_v2 SET last_seen_at=?,last_error=? WHERE id=?").bind(now,reason,num(c.id)).run();
   results.push({status:"failed",reason});
  }
 }
 return json({ok:results.every(x=>x.status==="accepted"||x.status==="duplicate"||x.status==="discovered"),received:items.length,results},207);
}

async function createConnection(req:Request,env:Env,s:Session){if(!["company_admin","admin"].includes(s.role))return new Response("Forbidden",{status:403});await ensure(env);const f=await req.formData(),provider=low(f.get("provider"),50),name=txt(f.get("name"),120);if(!provider||!name)return redirect("/telemetry/connections?msg=Provider+and+connection+name+are+required");const source=`${provider}-${crypto.randomUUID().slice(0,8)}`,secret=token(),now=new Date().toISOString();await env.DB.prepare("INSERT INTO telemetry_connections_v2(company_id,provider,connection_name,source_key,token_hash,status,created_by,created_at) VALUES(?,?,?,?,?,'active',?,?)").bind(s.companyId,provider,name,source,await hash(secret),s.accountId,now).run();return page(s,`<div class="ok"><b>Connection created.</b> Copy this credential now; the secret is stored only as a hash and cannot be shown again.</div><div class="secret"><small>Source header</small><code>${esc(source)}</code><small>Bearer token</small><code>${esc(secret)}</code></div><a class="btn" href="/telemetry/connections">Return to connections</a>`)}
async function addMap(req:Request,env:Env,s:Session){if(!["company_admin","admin"].includes(s.role))return new Response("Forbidden",{status:403});await ensure(env);const f=await req.formData(),connection=num(f.get("connection")),external=txt(f.get("external"),160),machine=txt(f.get("machine"),120);const owns=await first(env,"SELECT id FROM telemetry_connections_v2 WHERE id=? AND company_id=?",[connection,s.companyId]),registered=await first(env,"SELECT id FROM machines WHERE company_id=? AND lower(fleet_number)=lower(?)",[s.companyId,machine]);if(!owns||!registered||!external)return redirect("/telemetry/connections?msg=Check+the+connection,+external+ID+and+machine");await env.DB.prepare("INSERT INTO telemetry_machine_map_v2(company_id,connection_id,external_machine_id,machine_id,created_at) VALUES(?,?,?,?,?) ON CONFLICT(connection_id,external_machine_id) DO UPDATE SET machine_id=excluded.machine_id").bind(s.companyId,connection,external,machine,new Date().toISOString()).run();return redirect("/telemetry/connections?msg=Machine+mapping+saved")}
const SCENARIOS:Record<string,{label:string;data:Row}>={
 engine:{label:"Engine",data:{engine_hours:1245,rpm:1800,coolant_temperature:108,engine_oil_pressure:42,engine_load:78,ignition_status:"on"}},
 fuel:{label:"Fuel system",data:{fuel_level:48,fuel_consumption_lph:29.5,fault_codes:[{code:"SIM-FUEL-01"}]}},
 hydraulics:{label:"Hydraulic system",data:{hydraulic_pressure:145,hydraulic_temperature:91,hydraulic_oil_level:72,fault_codes:[{code:"SIM-HYD-01"}]}},
 transmission:{label:"Transmission",data:{transmission_temperature:106,transmission_gear:"3",fault_codes:[{code:"SIM-TRANS-01"}]}},
 electrical:{label:"Electrical system",data:{battery_voltage:24.1,fault_codes:[{code:"SIM-ELEC-01"}]}},
 diagnostics:{label:"Equipment health",data:{fault_codes:[{spn:110,fmi:0}],machine_events:["SIMULATED diagnostic event"]}},
 operations:{label:"Operations",data:{engine_hours:1245,idle_hours:210,ignition_status:"on"}},
 production:{label:"Production",data:{payload_tonnes:28,cycle_count:12,production_tonnes:336}},
 location:{label:"Location",data:{latitude:-26.3,longitude:29.7}},
 maintenance:{label:"Maintenance",data:{engine_hours:1245,service_due_hours:1250,machine_events:["SIMULATED service interval check"]}}
};
async function testCentre(req:Request,env:Env,s:Session){
 if(!["company_admin","admin"].includes(s.role))return new Response("Forbidden",{status:403});
 if(req.headers.get("origin")!==new URL(req.url).origin)return new Response("Invalid request origin",{status:403});
 await ensure(env);
 const f=await req.formData(),machine=txt(f.get("machine"),120),scenario=low(f.get("scenario"),40);
 const selected:[string,{label:string;data:Row}][]=scenario==="all"?Object.entries(SCENARIOS):SCENARIOS[scenario]?[[scenario,SCENARIOS[scenario]]]:[];
 if(!selected.length)return new Response("Unknown test scenario",{status:400});
 const registered=await first(env,"SELECT fleet_number FROM machines WHERE company_id=? AND fleet_number=? LIMIT 1",[s.companyId,machine]);
 if(!registered)return page(s,'<div class="panel bad">Machine not registered for this company. <a href="/telemetry/connections">Return</a></div>');
 const source="staging-test-"+s.companyId,secret=token(),now=new Date().toISOString();
 let c=await first(env,"SELECT id FROM telemetry_connections_v2 WHERE company_id=? AND source_key=? LIMIT 1",[s.companyId,source]);
 if(c)await env.DB.prepare("UPDATE telemetry_connections_v2 SET token_hash=?,status='active' WHERE id=? AND company_id=?").bind(await hash(secret),num(c.id),s.companyId).run();
 else {await env.DB.prepare("INSERT INTO telemetry_connections_v2(company_id,provider,connection_name,source_key,token_hash,status,created_by,created_at) VALUES(?,'other','STAGING SIMULATED TEST',?,?,'active',?,?)").bind(s.companyId,source,await hash(secret),s.accountId,now).run();c=await first(env,"SELECT id FROM telemetry_connections_v2 WHERE company_id=? AND source_key=?",[s.companyId,source]);}
 const external="SIMULATED-"+machine;
 await env.DB.prepare("INSERT INTO telemetry_machine_map_v2(company_id,connection_id,external_machine_id,machine_id,created_at) VALUES(?,?,?,?,?) ON CONFLICT(connection_id,external_machine_id) DO UPDATE SET machine_id=excluded.machine_id").bind(s.companyId,num(c?.id),external,machine,now).run();
 const events=selected.map(([key,config],i)=>({external_machine_id:external,event_id:"SIMULATED-"+crypto.randomUUID(),timestamp:new Date(Date.now()+i*10).toISOString(),test_data:true,test_scenario:key,...config.data}));
 const internal=new Request(new URL("/api/telemetry/v2",req.url),{method:"POST",headers:{"content-type":"application/json","x-telemetry-source":source,"authorization":"Bearer "+secret},body:JSON.stringify(events)});
 const response=await ingest(internal,env),result=await response.json() as Row,entries=Array.isArray(result.results)?result.results as Row[]:[];
 const accepted=entries.filter(x=>(x.status==="accepted"||x.status==="duplicate"||x.status==="discovered")).length;
 return page(s,`<section class="panel"><h2>OEM Test Centre result</h2><p><b>SIMULATED DATA ONLY</b> — not a live OEM connection or real faults.</p><p>Machine: <b>${esc(machine)}</b> · Scenarios: <b>${selected.length}</b> · Accepted: <b>${accepted}</b> · Rejected/quarantined/failed: <b>${entries.length-accepted}</b></p><pre style="white-space:pre-wrap;overflow-wrap:anywhere">${esc(JSON.stringify(result,null,2))}</pre><p><a class="btn" href="/telemetry/connections">Review ingestion audit</a> <a href="/telemetry/connections/report?machine=${encodeURIComponent(machine)}">Engineering report</a> <a href="/telemetry?machine=${encodeURIComponent(machine)}">Telemetry dashboard</a></p></section>`);
}
async function engineeringReport(req:Request,env:Env,s:Session){
 await ensure(env);const u=new URL(req.url),machine=txt(u.searchParams.get("machine"),120),period=low(u.searchParams.get("period"),20),mode=low(u.searchParams.get("mode"),20)==="simulation"?"simulation":"live";
 const days=period==="30d"?30:period==="7d"?7:1,cutoff=new Date(Date.now()-days*86400000).toISOString();
 const machines=await all(env,"SELECT fleet_number fleet FROM machines WHERE company_id=? ORDER BY fleet_number",[s.companyId]);
 const valid=machines.some(m=>low(m.fleet)===low(machine));
 const rows=valid?await all(env,"SELECT id,recorded_at,engine_hours,coolant_temperature,fuel_level,fault_code,source,raw_json FROM machine_telemetry_v1 WHERE company_id=? AND lower(machine_id)=lower(?) AND recorded_at>=? AND "+(mode==="simulation"?"(source LIKE '%staging-test%' OR source LIKE '%SIMULATED%')":"(source NOT LIKE '%staging-test%' AND source NOT LIKE '%SIMULATED%')")+" ORDER BY recorded_at DESC,id DESC LIMIT 500",[s.companyId,machine,cutoff]):[];
 const alerts=valid?await all(env,"SELECT a.telemetry_id,a.severity,a.title,a.details,a.created_at,t.source FROM telemetry_alerts_v1 a LEFT JOIN machine_telemetry_v1 t ON t.id=a.telemetry_id AND t.company_id=a.company_id WHERE a.company_id=? AND lower(a.machine_id)=lower(?) AND a.created_at>=? ORDER BY a.id DESC LIMIT 50",[s.companyId,machine,cutoff]):[];
 const isTest=(r:Row)=>String(r.source||"").includes("staging-test")||String(r.source||"").includes("SIMULATED");
 const filtered=rows.filter(r=>mode==="simulation"?isTest(r):!isTest(r));
 const decoded=filtered.map(r=>{try{return JSON.parse(String(r.raw_json||"{}")) as Row}catch{return {}}});
 const alertRows=mode==="simulation"?[]:alerts.filter(a=>!isTest(a));
 const codeCounts=new Map<string,number>();for(const r of filtered){for(const code of txt(r.fault_code,100).split(",").map(v=>v.trim()).filter(Boolean))codeCounts.set(code,(codeCounts.get(code)||0)+1)}
 const recurring=[...codeCounts].filter(([,count])=>count>1).sort((a,b)=>b[1]-a[1]);
 const temperatures=filtered.filter(r=>r.coolant_temperature!=null).map(r=>({t:txt(r.recorded_at,50),v:num(r.coolant_temperature)})).sort((a,b)=>a.t.localeCompare(b.t));
 const trend=temperatures.length>1?(temperatures[temperatures.length-1].v-temperatures[0].v).toFixed(1)+" °C (first to last received)":"Insufficient temperature readings";
 const metrics=[["Engine","rpm, coolant_temperature, engine_oil_pressure, engine_load, engine_hours"],["Fuel","fuel_level, fuel_consumption_lph"],["Hydraulics","hydraulic_pressure, hydraulic_temperature, hydraulic_oil_level"],["Transmission","transmission_temperature, transmission_gear"],["Electrical","battery_voltage"],["Equipment health","fault_code, machine_events"],["Operations","engine_hours, idle_hours, ignition_status"],["Production","payload_tonnes, cycle_count, production_tonnes"],["Location","latitude, longitude"],["Maintenance","service_due_hours"]];
 const metricRows=metrics.map(([category,fields])=>{const values=fields.split(", ").map(field=>{const entry=decoded.find(d=>d[field]!=null&&d[field]!=="");return entry?field.replace(/_/g," ")+": "+txt(entry[field],50):""}).filter(Boolean);return `<tr><td>${esc(category)}</td><td>${values.length?esc(values.join(" · ")):"Not supplied"}</td></tr>`}).join("");
 const faults=filtered.filter(r=>txt(r.fault_code)).length,simulated=rows.filter(isTest).length;
 const hours=filtered.map(r=>r.engine_hours).filter(v=>v!=null).map(Number),delta=hours.length>1?Math.max(...hours)-Math.min(...hours):null;
 const options=machines.map(m=>`<option value="${esc(m.fleet)}" ${low(m.fleet)===low(machine)?"selected":""}>${esc(m.fleet)}</option>`).join("");
 return page(s,`<section class="panel"><h2>Engineering condition report</h2><p>Generated from stored telemetry, not estimated values. <b>Simulation records are not actual equipment conditions.</b></p><form method="get" action="/telemetry/connections/report" class="grid" onchange="this.requestSubmit()"><label class="field">Machine<select name="machine" required><option value="">Choose machine</option>${options}</select></label><label class="field">Period<select name="period"><option value="1d" ${days===1?"selected":""}>Last 24 hours</option><option value="7d" ${days===7?"selected":""}>Last 7 days</option><option value="30d" ${days===30?"selected":""}>Last 30 days</option></select></label><label class="field">Data source<select name="mode"><option value="live" ${mode==="live"?"selected":""}>Real telemetry only</option><option value="simulation" ${mode==="simulation"?"selected":""}>Simulation only</option></select></label></form>${valid?`<h3>${esc(machine)} · ${days}-day ${mode==="simulation"?"SIMULATION — NOT REAL EQUIPMENT DATA":"REAL TELEMETRY ONLY"} report</h3><p>Readings in selected source: <b>${filtered.length}</b> · Simulated readings in full period: <b>${simulated}</b> · Fault-bearing readings: <b>${faults}</b> · Hour-meter change: <b>${delta===null?"Insufficient data":delta.toFixed(1)+" h"}</b></p><h3>Machine systems — most recent available values</h3><table><tr><th>System</th><th>Recorded values</th></tr>${metricRows}</table><h3>Condition and diagnostic analysis</h3><p>Coolant temperature trend: <b>${esc(trend)}</b>. Recurring diagnostic codes: <b>${recurring.length}</b>. ${mode==="simulation"?"These are simulated readings and must not be used for maintenance decisions.":"Fault code meanings and operating limits require OEM verification."}</p><table><tr><th>Recurring code</th><th>Occurrences</th></tr>${recurring.map(([code,count])=>`<tr><td>${esc(code)}</td><td>${count}</td></tr>`).join("")||'<tr><td colspan="2">No repeated diagnostic codes in selected readings.</td></tr>'}</table><h3>${mode==="simulation"?"Simulated readings — no operational alerts":"Detected operational alerts"}</h3><table><tr><th>Time</th><th>Severity</th><th>Finding</th></tr>${alertRows.map(a=>`<tr><td>${esc(a.created_at)}</td><td>${esc(a.severity)}</td><td>${esc(a.title)} — ${esc(a.details)}</td></tr>`).join("")||'<tr><td colspan="3">No alerts recorded in this period.</td></tr>'}</table><p><b>Engineering interpretation:</b> Review faults and trends against OEM-specific limits. Missing values mean no data was supplied. This report does not establish confirmed downtime, utilisation, production totals or root cause without supporting records.</p><button type="button" onclick="window.print()">Print / Save PDF</button>`:"<p>Select a registered machine to generate a report.</p>"}</section>`);
}
// Engineering defaults are illustrative, not OEM-certified limits. This runs only for staging simulations.
// Diagnostic Library v1: standard J1939 identifier structure only.
// No manufacturer-proprietary codes or machine-specific severity are inferred.
export const J1939_SPN:Record<number,{system:string;parameter:string}>={
 92:{system:"Engine",parameter:"Engine load"},
 94:{system:"Fuel",parameter:"Fuel pressure"},
 100:{system:"Engine lubrication",parameter:"Engine oil pressure"},
 101:{system:"Engine ventilation",parameter:"Crankcase pressure"},
 102:{system:"Engine intake",parameter:"Turbocharger pressure"},
 105:{system:"Engine intake",parameter:"Intake manifold temperature"},
 108:{system:"Ambient",parameter:"Atmospheric pressure"},
 109:{system:"Engine cooling",parameter:"Coolant pressure"},
 110:{system:"Engine cooling",parameter:"Engine coolant temperature"},
 111:{system:"Engine cooling",parameter:"Coolant level"},
 158:{system:"Electrical",parameter:"Switched battery voltage"},
 168:{system:"Electrical",parameter:"Battery potential"},
 174:{system:"Fuel",parameter:"Fuel temperature"},
 175:{system:"Engine lubrication",parameter:"Engine oil temperature"},
 183:{system:"Fuel",parameter:"Fuel consumption rate"},
 190:{system:"Engine",parameter:"Engine speed"},
 247:{system:"Engine",parameter:"Engine hours"},
 250:{system:"Fuel",parameter:"Fuel used"}
};
const J1939_FMI:Record<number,string>={
 0:"Data valid but above normal operating range — most severe level",
 1:"Data valid but below normal operating range — most severe level",
 2:"Data erratic, intermittent or incorrect",
 3:"Voltage above normal or shorted high",
 4:"Voltage below normal or shorted low",
 5:"Current below normal or open circuit",
 6:"Current above normal or grounded circuit",
 7:"Mechanical system not responding properly",
 8:"Abnormal frequency, pulse width or period",
 9:"Abnormal update rate",
 10:"Abnormal rate of change",
 11:"Root cause not known",
 12:"Bad intelligent device or component",
 13:"Out of calibration",
 14:"Special instructions",
 15:"Data valid but above normal operating range — least severe level",
 16:"Data valid but above normal operating range — moderately severe level",
 17:"Data valid but below normal operating range — least severe level",
 18:"Data valid but below normal operating range — moderately severe level",
 19:"Received network data in error",
 20:"Data drifted high",
 21:"Data drifted low",
 31:"Condition exists"
};
export function diagnosticLookup(input:string){
 const code=input.trim().replace(/\s+/g," ").toUpperCase();
 const match=/^SPN (\d{1,6}) FMI (\d{1,2})$/.exec(code);
 if(!match)return {code,system:"Unknown",meaning:"Unmapped or proprietary diagnostic identifier; verified OEM documentation required.",severity:"review",verified:false};
 const spn=Number(match[1]),fmi=Number(match[2]),parameter=J1939_SPN[spn],failure=J1939_FMI[fmi];
 if(spn>524287||fmi>31)return {code,system:"Unknown",meaning:"Invalid J1939 SPN/FMI range; verify original message.",severity:"review",verified:false};
 const system=parameter?.system||"Unmapped J1939 parameter";
 const meaning=(parameter?parameter.parameter:"SPN "+spn+" (parameter definition not yet verified)")+" — "+(failure||"FMI "+fmi+" (failure mode not mapped)");
 return {code,system,meaning, severity:"review",verified:Boolean(parameter&&failure)};
}
async function automationConfiguration(req:Request,env:Env,s:Session){
 await ensure(env);
 const admin=["company_admin","admin"].includes(s.role),csrf=await hash(cookie(req));
 const units:Record<string,string[]>={coolant_temperature:["degC"],engine_oil_pressure:["kPa","bar","psi"],hydraulic_pressure:["kPa","bar","psi"],hydraulic_oil_level:["percent"],battery_voltage:["V"],rpm:["rpm"],hydraulic_temperature:["degC"],transmission_temperature:["degC"],fuel_level:["percent"]};
 if(req.method==="POST"){
  if(!admin)return new Response("Administrator required",{status:403});
  if(req.headers.get("origin")!==new URL(req.url).origin)return new Response("Invalid origin",{status:403});
  const f=await req.formData();if(f.get("csrf")!==csrf)return new Response("Invalid request token",{status:403});
  const action=txt(f.get("action")),now=new Date().toISOString();
  if(action==="delivery"){
   const emails=[...new Set(txt(f.get("recipients"),4000).split(/[,;\s]+/).map(v=>v.toLowerCase()).filter(Boolean))];
   if(emails.length>20||emails.some(v=>!/^\S+@[^\s@]+\.[^\s@]+$/.test(v)))return new Response("Supply up to 20 valid recipient emails",{status:400});
   const enabled=f.get("enabled")==="on",hour=Number(f.get("hour"));
   if(!Number.isInteger(hour)||hour<0||hour>23||enabled&&!emails.length)return new Response("Check the report hour and recipients",{status:400});
   await env.DB.prepare("INSERT INTO telemetry_automation_settings_v3(company_id,recipients_json,delivery_enabled,report_hour_sast,updated_by,updated_at) VALUES(?,?,?,?,?,?) ON CONFLICT(company_id) DO UPDATE SET recipients_json=excluded.recipients_json,delivery_enabled=excluded.delivery_enabled,report_hour_sast=excluded.report_hour_sast,updated_by=excluded.updated_by,updated_at=excluded.updated_at").bind(s.companyId,JSON.stringify(emails),enabled?1:0,hour,s.accountId,now).run();
  }else if(action==="limit"){
   const machine=txt(f.get("machine"),120),metric=txt(f.get("metric")),unit=txt(f.get("unit")),comparison=txt(f.get("comparison")),reference=txt(f.get("reference"),1000),warning=Number(f.get("warning")),critical=Number(f.get("critical"));
   const registered=await first(env,"SELECT id FROM machines WHERE company_id=? AND fleet_number=?",[s.companyId,machine]);
   if(!registered||!units[metric]?.includes(unit)||!["high","low"].includes(comparison)||!reference||!txt(f.get("warning"))||!txt(f.get("critical"))||!Number.isFinite(warning)||!Number.isFinite(critical)||(comparison==="high"?critical<warning:critical>warning))return new Response("Check registered machine, metric, units, limit ordering and OEM/site reference",{status:400});
   await env.DB.prepare("INSERT INTO telemetry_machine_limits_v3(company_id,machine_id,metric,unit,comparison,warning_value,critical_value,reference,approved_by,updated_at) VALUES(?,?,?,?,?,?,?,?,?,?) ON CONFLICT(company_id,machine_id,metric) DO UPDATE SET unit=excluded.unit,comparison=excluded.comparison,warning_value=excluded.warning_value,critical_value=excluded.critical_value,reference=excluded.reference,approved_by=excluded.approved_by,updated_at=excluded.updated_at").bind(s.companyId,machine,metric,unit,comparison,warning,critical,reference,s.accountId,now).run();
  }else return new Response("Unknown configuration action",{status:400});
  return redirect("/telemetry/connections/automation?msg=Configuration+saved");
 }
 if(req.method!=="GET")return new Response("Method not allowed",{status:405});
 const config=await first(env,"SELECT * FROM telemetry_automation_settings_v3 WHERE company_id=?",[s.companyId]),limits=await all(env,"SELECT * FROM telemetry_machine_limits_v3 WHERE company_id=? ORDER BY machine_id,metric",[s.companyId]),machines=await all(env,"SELECT fleet_number FROM machines WHERE company_id=? ORDER BY fleet_number",[s.companyId]),delivery=await all(env,"SELECT kind,recipient,status,attempts,last_error,created_at,sent_at FROM telemetry_delivery_outbox_v3 WHERE company_id=? ORDER BY id DESC LIMIT 100",[s.companyId]);
 let recipients:string[]=[];try{recipients=JSON.parse(txt(config?.recipients_json,4000)||"[]")}catch{}
 return page(s,`<section class="panel"><h2>One-time automation configuration</h2><p>Collection, analysis and saved reports do not require a button. Configure the recipients, delivery schedule and approved machine limits here. Simulation never sends external notifications.</p><p>Email provider: <b>${env.RESEND_API_KEY?"API key configured; sender-domain verification must also be valid":"Not configured — RESEND_API_KEY required for delivery"}</b> · Delivery mode: <b>${esc(env.TMM_DELIVERY_MODE||"live for enabled companies")}</b></p>${admin?`<form method="post" class="grid"><input type="hidden" name="csrf" value="${csrf}"><input type="hidden" name="action" value="delivery"><label class="field">Recipient emails<input name="recipients" value="${esc(recipients.join(', '))}" placeholder="Configured company recipients"></label><label class="field">Report hour (South Africa)<input name="hour" type="number" min="0" max="23" value="${num(config?.report_hour_sast,18)}"></label><label class="field">Enable automatic external delivery<input name="enabled" type="checkbox" ${num(config?.delivery_enabled)===1?"checked":""}></label><button>Save delivery configuration</button></form>`:"<p>Only a company administrator can change delivery configuration.</p>"}<p>Daily rolling monitoring reports send once per day after this hour; weekly reports on Mondays, monthly reports on the first day. Fault notifications are deduplicated per rule, severity and day. Delivery means provider acceptance; inbox receipt is not asserted.</p></section><section class="panel"><h2>Approved machine-specific sensor limits</h2><p>Limits apply only when incoming measurement units match the configured unit. Pressure screening additionally requires a reported running engine. Unknown definitions and missing units remain review findings.</p>${admin?`<form method="post" class="grid"><input type="hidden" name="csrf" value="${csrf}"><input type="hidden" name="action" value="limit"><label class="field">Registered machine<select name="machine" required>${machines.map(m=>`<option>${esc(m.fleet_number)}</option>`).join("")}</select></label><label class="field">Metric<select name="metric">${Object.keys(units).map(k=>`<option>${k}</option>`).join("")}</select></label><label class="field">Source unit<select name="unit">${[...new Set(Object.values(units).flat())].map(k=>`<option>${k}</option>`).join("")}</select></label><label class="field">Direction<select name="comparison"><option value="high">High limit</option><option value="low">Low limit</option></select></label><label class="field">Warning value<input name="warning" type="number" step="any" required></label><label class="field">Critical value<input name="critical" type="number" step="any" required></label><label class="field">OEM/site document and revision<input name="reference" required maxlength="1000"></label><button>Save approved limit</button></form>`:""}<table><tr><th>Machine</th><th>Metric</th><th>Unit / direction</th><th>Warning / critical</th><th>Reference</th></tr>${limits.map(l=>`<tr><td>${esc(l.machine_id)}</td><td>${esc(l.metric)}</td><td>${esc(l.unit)} / ${esc(l.comparison)}</td><td>${esc(l.warning_value)} / ${esc(l.critical_value)}</td><td>${esc(l.reference)}</td></tr>`).join("")||'<tr><td colspan="5">No approved sensor limits configured. Diagnostic observations are still analysed automatically.</td></tr>'}</table></section><section class="panel"><h2>Automatic delivery audit</h2><table><tr><th>Type</th><th>Recipient</th><th>Status</th><th>Attempts</th><th>Detail</th></tr>${delivery.map(d=>`<tr><td>${esc(d.kind)}</td><td>${esc(d.recipient)}</td><td>${esc(d.status)}</td><td>${num(d.attempts)}</td><td>${esc(d.last_error||d.sent_at||"Queued")}</td></tr>`).join("")||'<tr><td colspan="5">No live delivery jobs queued. Simulation remains internal.</td></tr>'}</table></section>`);
}

async function diagnosticLibraryPage(req:Request,env:Env,s:Session){
 const u=new URL(req.url),code=txt(u.searchParams.get("code"),100),result=code?diagnosticLookup(code):null;
 const known=Object.keys(J1939_SPN).map(Number).flatMap(spn=>[0,1,2,3,4,5,6,7,9,15,16,17,18,31].map(fmi=>diagnosticLookup("SPN "+spn+" FMI "+fmi)));
 return page(s,`<section class="panel"><h2>OEM Diagnostic Library — sourced J1939 references</h2><p>Standardised J1939 SPN/FMI interpretation for staging analysis. <b>CAT, Volvo and Komatsu proprietary code definitions are not loaded.</b> FMI descriptions are generic failure modes, not confirmed root causes, severity ratings or repair instructions.</p><form method="get" action="/telemetry/connections/diagnostic-library" class="grid"><label class="field">Lookup SPN / FMI<input name="code" value="${esc(code)}" placeholder="SPN 110 FMI 0"></label><button>Look up code</button></form>${result?`<h3>${esc(result.code)}</h3><p><b>System:</b> ${esc(result.system)} · <b>Status:</b> ${result.verified?"J1939 reference mapped; OEM verification required":"Not verified"}</p><p>${esc(result.meaning)}</p><p><b>Action:</b> Confirm the machine model, occurrence status and manufacturer service documentation before making maintenance decisions.</p>`:""}<p>Parameter references: <a href="https://documentation.deif.com/r/ie-150-agc-150-engine-communication-4189341302-uk/description-of-engine-communication/other/analogue-readings-pgn-and-spn">DEIF engine-communication parameter table</a> and <a href="https://www.deif.com/media/aq3aiwp0/agc-200-drh-4189340609o-uk.pdf?v=6">DEIF AGC 200 reference handbook</a>. These identify parameters, not universal repair procedures or machine-specific limits.</p><h3>Available J1939 reference entries</h3><table><tr><th>Code</th><th>System</th><th>Interpretation</th></tr>${known.map(d=>`<tr><td>${esc(d.code)}</td><td>${esc(d.system)}</td><td>${esc(d.meaning)}</td></tr>`).join("")}</table><p>Other SPNs can be parsed but remain unmapped until a verified parameter definition is added. No proprietary definitions are guessed.</p><a href="/telemetry/connections/automatic-analysis">Automatic analysis</a></section>`);
}
async function automaticAnalysisPage(req:Request,env:Env,s:Session){
 await env.DB.prepare("CREATE TABLE IF NOT EXISTS telemetry_condition_findings_v2(id INTEGER PRIMARY KEY AUTOINCREMENT,company_id INTEGER NOT NULL,machine_id TEXT NOT NULL,telemetry_id INTEGER NOT NULL,source_mode TEXT NOT NULL,category TEXT NOT NULL,severity TEXT NOT NULL,diagnostic_code TEXT,details TEXT NOT NULL,recommendation TEXT NOT NULL,created_at TEXT NOT NULL,UNIQUE(company_id,telemetry_id,category,diagnostic_code))").run();
 const rows=await all(env,"SELECT machine_id,source_mode,category,severity,diagnostic_code,details,recommendation,created_at FROM telemetry_condition_findings_v2 WHERE company_id=? ORDER BY id DESC LIMIT 100",[s.companyId]);
 return page(s,`<section class="panel"><h2>Automatic condition and fault analysis</h2><p>Live and simulation findings are processed automatically and labelled separately. Only reference-mapped identifiers are interpreted. Live sensor alarms use configured, approved limits with matching units; missing definitions and units are flagged for review.</p><table><tr><th>Machine</th><th>Source / severity</th><th>Category / code</th><th>Finding</th><th>Suggested verification</th><th>Created UTC</th></tr>${rows.map(x=>`<tr><td>${esc(x.machine_id)}</td><td>${esc(x.source_mode)} / ${esc(x.severity)}</td><td>${esc(x.category)} ${esc(x.diagnostic_code)}</td><td>${esc(x.details)}</td><td>${esc(x.recommendation)}</td><td>${esc(x.created_at)}</td></tr>`).join("")||'<tr><td colspan="6">No automatic findings yet. The next scheduled run will evaluate the simulated readings.</td></tr>'}</table><p><a href="/telemetry/connections/scheduled-reports">Scheduled reports</a> · <a href="/telemetry/connections/diagnostic-library">Diagnostic library</a></p></section>`);
}
async function ensureReportDocuments(env:Env){
 await env.DB.prepare("CREATE TABLE IF NOT EXISTS telemetry_report_documents_v2(snapshot_id INTEGER PRIMARY KEY,company_id INTEGER NOT NULL,report_json TEXT NOT NULL,generated_at TEXT NOT NULL)").run();
}
async function runAutomatedSimulation(env:Env,scheduledTime=Date.now()){
 await ensure(env);
 await env.DB.prepare("CREATE TABLE IF NOT EXISTS telemetry_simulator_v2(company_id INTEGER PRIMARY KEY,machine_id TEXT NOT NULL,enabled INTEGER NOT NULL DEFAULT 0,last_run_at TEXT,last_status TEXT)").run();
 // Staging-only: automatically enrol the existing SAS ADT 027 test fleet, never arbitrary real fleets.
 // An explicit disabled setting is respected. Enrolment is limited to companies with prior simulated readings.
 await env.DB.prepare("INSERT OR IGNORE INTO telemetry_simulator_v2(company_id,machine_id,enabled) SELECT m.company_id,m.fleet_number,1 FROM machines m WHERE m.fleet_number='SAS ADT 027' AND EXISTS(SELECT 1 FROM machine_telemetry_v1 t WHERE t.company_id=m.company_id AND lower(t.machine_id)=lower(m.fleet_number) AND (t.source LIKE '%staging-test%' OR t.source LIKE '%SIMULATED%'))").run();
 const configs=await all(env,"SELECT company_id,machine_id FROM telemetry_simulator_v2 WHERE enabled=1 LIMIT 10");
 for(const cfg of configs){const companyId=num(cfg.company_id),machine=txt(cfg.machine_id,120),now=new Date(Math.floor(scheduledTime/900000)*900000).toISOString();
  try{
   const exists=await first(env,"SELECT id FROM machines WHERE company_id=? AND fleet_number=?",[companyId,machine]);if(!exists)throw Error("Registered machine no longer exists");
   const source="staging-test-"+companyId,secret=token();let c=await first(env,"SELECT id FROM telemetry_connections_v2 WHERE company_id=? AND source_key=?",[companyId,source]);
   if(c)await env.DB.prepare("UPDATE telemetry_connections_v2 SET token_hash=?,status='active' WHERE id=? AND company_id=?").bind(await hash(secret),num(c.id),companyId).run();
   else{await env.DB.prepare("INSERT INTO telemetry_connections_v2(company_id,provider,connection_name,source_key,token_hash,status,created_by,created_at) VALUES(?,'other','STAGING SIMULATED TEST',?,?,'active',0,?)").bind(companyId,source,await hash(secret),now).run();c=await first(env,"SELECT id FROM telemetry_connections_v2 WHERE company_id=? AND source_key=?",[companyId,source])}
   const external="SIMULATED-"+machine;
   await env.DB.prepare("INSERT INTO telemetry_machine_map_v2(company_id,connection_id,external_machine_id,machine_id,created_at) VALUES(?,?,?,?,?) ON CONFLICT(connection_id,external_machine_id) DO UPDATE SET machine_id=excluded.machine_id").bind(companyId,num(c?.id),external,machine,now).run();
   const tick=Math.floor(scheduledTime/900000),sequence=tick%6,reading={external_machine_id:external,event_id:"AUTO-SIM-"+companyId+"-"+tick,timestamp:now,test_data:true,test_scenario:"scheduled",engine_hours:1245,rpm:1600+sequence*50,coolant_temperature:90+sequence*4,fuel_level:70-sequence*2,hydraulic_oil_level:85-sequence,hydraulic_pressure:145,battery_voltage:24.1,...(sequence===5?{fault_codes:[{spn:110,fmi:0}]}:{})};
   const req=new Request("https://staging.invalid/api/telemetry/v2",{method:"POST",headers:{"content-type":"application/json","x-telemetry-source":source,"authorization":"Bearer "+secret},body:JSON.stringify(reading)});
   const response=await ingest(req,env),body=await response.json() as Row;
   const ok=Array.isArray(body.results)&&body.results.every((x:Row)=>(x.status==="accepted"||x.status==="duplicate"||x.status==="discovered"));
   await env.DB.prepare("UPDATE telemetry_simulator_v2 SET last_run_at=?,last_status=? WHERE company_id=?").bind(now,ok?"accepted":"failed: "+JSON.stringify(body).slice(0,350),companyId).run();
  }catch(e){await env.DB.prepare("UPDATE telemetry_simulator_v2 SET last_run_at=?,last_status=? WHERE company_id=?").bind(now,"failed: "+txt(e instanceof Error?e.message:String(e),350),companyId).run()}
 }
}
async function simulatorSettings(req:Request,env:Env,s:Session){
 if(!["company_admin","admin"].includes(s.role))return new Response("Forbidden",{status:403});
 if(req.headers.get("origin")!==new URL(req.url).origin)return new Response("Invalid origin",{status:403});
 await env.DB.prepare("CREATE TABLE IF NOT EXISTS telemetry_simulator_v2(company_id INTEGER PRIMARY KEY,machine_id TEXT NOT NULL,enabled INTEGER NOT NULL DEFAULT 0,last_run_at TEXT,last_status TEXT)").run();
 const f=await req.formData(),machine=txt(f.get("machine"),120),enabled=f.get("enabled")==="on";
 const registered=await first(env,"SELECT id FROM machines WHERE company_id=? AND fleet_number=?",[s.companyId,machine]);
 if(!registered)return new Response("Machine not registered",{status:400});
 await env.DB.prepare("INSERT INTO telemetry_simulator_v2(company_id,machine_id,enabled) VALUES(?,?,?) ON CONFLICT(company_id) DO UPDATE SET machine_id=excluded.machine_id,enabled=excluded.enabled").bind(s.companyId,machine,enabled?1:0).run();
 return redirect("/telemetry/connections?msg=Automatic+simulator+settings+saved");
}
function page(s:Session,body:string){return automationShell(s.companyName,`<nav class="panel"><a href="/telemetry/connections">Data connections</a><a href="/telemetry/connections/pipeline-status">Pipeline status</a><a href="/telemetry/connections/automatic-analysis">Fault analysis</a><a href="/telemetry/connections/scheduled-reports">Saved reports</a></nav>${body}<script>if(!["/telemetry/connections","/telemetry/connections/diagnostic-library","/telemetry/connections/automation","/telemetry/connections/discovered"].includes(location.pathname))setTimeout(function(){if(!document.querySelector("input:focus,select:focus"))location.reload()},60000)</script>`)}

/** Read-only staging verification centre. Does not create or mutate telemetry records. */
async function scheduledReportPage(req:Request,env:Env,s:Session){
 await env.DB.prepare("CREATE TABLE IF NOT EXISTS telemetry_report_snapshots_v2(id INTEGER PRIMARY KEY AUTOINCREMENT,company_id INTEGER NOT NULL,machine_id TEXT NOT NULL,period TEXT NOT NULL,period_start TEXT NOT NULL,period_end TEXT NOT NULL,source_mode TEXT NOT NULL,reading_count INTEGER NOT NULL,fault_readings INTEGER NOT NULL,first_hours REAL,last_hours REAL,generated_at TEXT NOT NULL,UNIQUE(company_id,machine_id,period,period_start,source_mode))").run();
 const rows=await all(env,"SELECT id,machine_id,period,source_mode,reading_count,fault_readings,first_hours,last_hours,generated_at FROM telemetry_report_snapshots_v2 WHERE company_id=? ORDER BY generated_at DESC LIMIT 90",[s.companyId]);
 return page(s,`<section class="panel"><h2>Automatic engineering report snapshots</h2><p>Created by the scheduler from received readings. Live and simulation documents remain separate. These are rolling 1, 7 and 30-day monitoring windows; configured live report notifications are queued automatically.</p><table><tr><th>Machine</th><th>Window</th><th>Source</th><th>Readings</th><th>Fault readings</th><th>Hour range</th><th>Generated (UTC)</th></tr>${rows.map(r=>`<tr><td>${esc(r.machine_id)}</td><td><a href="/telemetry/connections/report-document?id=${num(r.id)}">${esc(r.period)} report</a></td><td>${esc(r.source_mode)}</td><td>${num(r.reading_count)}</td><td>${num(r.fault_readings)}</td><td>${r.first_hours==null?"No data":esc(r.first_hours)+"–"+esc(r.last_hours)}</td><td>${esc(r.generated_at)}</td></tr>`).join("")||'<tr><td colspan="7">No scheduled report snapshots yet. Enable the simulator and wait for the next cron run.</td></tr>'}</table><p><a href="/telemetry/connections">Back to OEM Connections</a></p></section>`);
}
async function reportDocument(req:Request,env:Env,s:Session){
 await ensureReportDocuments(env);
 const u=new URL(req.url),id=num(u.searchParams.get("id"));
 const saved=await first(env,"SELECT report_json FROM telemetry_report_documents_v2 WHERE snapshot_id=? AND company_id=?",[id,s.companyId]);
 if(!saved)return new Response("Report not found",{status:404});
 const r=JSON.parse(String(saved.report_json)) as Row,findings=Array.isArray(r.findings)?r.findings as Row[]:[];
 const metrics=r.metrics&&typeof r.metrics==="object"?r.metrics as Row:{},sensors=r.latest_sensors&&typeof r.latest_sensors==="object"?r.latest_sensors as Row:{};
 const metricRows=Object.entries(metrics).map(([key,value])=>`<tr><td>${esc(key.replace(/_/g," "))}</td><td>${value==null?"Unavailable":esc(value)}</td></tr>`).join("");
 const sensorRows=Object.entries(sensors).map(([key,value])=>{const v=value as Row;return `<tr><td>${esc(key.replace(/_/g," "))}</td><td>${esc(v.value)}</td><td>${esc(v.unit||"Unit not supplied")}</td></tr>`}).join("");
 if(u.searchParams.get("format")==="json")return json(r);
 return page(s,`<section class="panel"><h2>${esc(r.machine_id)} · ${esc(r.period)} automatic report</h2><p><b>${r.source_mode==="simulation"?"SIMULATED DATA ONLY — not real equipment conditions":"LIVE RECEIVED TELEMETRY — confirm machine conditions before action"}</b></p><p>This report was generated and saved automatically at ${esc(r.generated_at)} UTC. Opening this page does not run analysis or generate a report.</p><p>Observation window: ${esc(r.period_start)} to ${esc(r.period_end)}</p><p>Received readings: <b>${num(r.reading_count)}</b> · Fault-bearing readings: <b>${num(r.fault_readings)}</b> · Hour-meter range: ${r.first_hours==null?"Unavailable":esc(r.first_hours)+"–"+esc(r.last_hours)}</p><h3>Measured operating summary</h3><table><tr><th>Metric</th><th>Value</th></tr>${metricRows||'<tr><td colspan="2">No measured summary available.</td></tr>'}</table><h3>Latest available sensors</h3><table><tr><th>Sensor</th><th>Value</th><th>Source unit</th></tr>${sensorRows||'<tr><td colspan="3">No sensor values supplied.</td></tr>'}</table><p>Analysis backlog: ${num(r.analysis_pending)} readings. ${r.readings_truncated?"Reading limit reached; narrow the observation window.":""}</p><h3>Automatic fault and condition findings</h3><table><tr><th>Observed UTC</th><th>Code / category</th><th>Interpretation</th><th>Verification action</th></tr>${findings.map(f=>`<tr><td>${esc(f.recorded_at)}</td><td>${esc(f.diagnostic_code||f.category)}</td><td>${esc(f.details)}</td><td>${esc(f.recommendation)}</td></tr>`).join("")||'<tr><td colspan="4">No stored findings in this observation window.</td></tr>'}</table><p>${esc(r.analysis_window)} ${r.findings_truncated?"Only the latest 200 findings are included.":""}</p><a href="/telemetry/connections/report-document?id=${id}&format=json">View saved report JSON</a></section>`);
}

async function pipelineStatus(req:Request,env:Env,s:Session){
 await ensure(env);
 const simulator=await first(env,"SELECT machine_id,enabled,last_run_at,last_status FROM telemetry_simulator_v2 WHERE company_id=?",[s.companyId]).catch(()=>null);
 const receipt=await first(env,"SELECT status,received_at,error FROM telemetry_ingest_v2 WHERE company_id=? ORDER BY id DESC LIMIT 1",[s.companyId]);
 const stored=await first(env,"SELECT COUNT(*) n,MAX(created_at) last_stored FROM machine_telemetry_v1 WHERE company_id=?",[s.companyId]);
 const findings=await first(env,"SELECT COUNT(*) n,MAX(created_at) last_analysed FROM telemetry_condition_findings_v2 WHERE company_id=?",[s.companyId]).catch(()=>null);
 const reports=await all(env,"SELECT id,machine_id,period,source_mode,generated_at,reading_count FROM telemetry_report_snapshots_v2 WHERE company_id=? ORDER BY generated_at DESC LIMIT 9",[s.companyId]).catch(()=>[]);
 const last=simulator?.last_run_at?Date.parse(String(simulator.last_run_at)):NaN;
 const fresh=Number.isFinite(last)&&Date.now()-last<30*60000;
 const evidence={company_id:s.companyId,generated_at:new Date().toISOString(),automatic:true,interval_minutes:15,source:"staging_simulation",simulator,latest_receipt:receipt,storage:stored,analysis:findings,reports,scheduler_fresh:fresh,complete_simulation_cycle_observed:Boolean(fresh&&simulator?.last_status==="accepted"&&num(stored?.n)>0&&reports.length>=3),limitations:["Status describes stored observations, not a certification of every code or icon.","Real machine collection and network transfer remain untested until a device or OEM is connected."]};
 if(new URL(req.url).searchParams.get("format")==="json")return json(evidence);
 return page(s,`<section class="panel"><h2>Automatic pipeline status</h2><p><b>STAGING SIMULATION</b> · Scheduled every 15 minutes, including when the dashboard is closed. This view refreshes every minute.</p><table><tr><th>Stage</th><th>Observed evidence</th></tr><tr><td>Collect and transfer simulated readings</td><td>${esc(simulator?.last_status||"No scheduled cycle observed")} · ${esc(simulator?.last_run_at||"Awaiting scheduler")}</td></tr><tr><td>Central storage</td><td>${num(stored?.n)} readings · latest stored ${esc(stored?.last_stored||"None")}</td></tr><tr><td>Fault recognition and analysis</td><td>${num(findings?.n)} findings · latest finding ${esc(findings?.last_analysed||"None; normal readings may produce no findings")}</td></tr><tr><td>Automatic reports</td><td>${reports.length} recent snapshots available</td></tr><tr><td>Scheduler freshness</td><td>${fresh?"A cycle was recorded in the last 30 minutes":"No recent cycle observed — investigate scheduler or simulator configuration"}</td></tr></table><h3>Automatically saved reports</h3>${reports.map(r=>`<p><a href="/telemetry/connections/report-document?id=${num(r.id)}">${esc(r.machine_id)} · ${esc(r.period)} · ${esc(r.generated_at)}</a></p>`).join("")||"<p>Awaiting the first scheduled report.</p>"}<p>Real machine collection and network transfer will be verified after connection. Unknown diagnostic codes remain explicitly unmapped.</p></section>`);
}

async function verificationCentre(req:Request,env:Env,s:Session){
 if(!["company_admin","admin","engineer"].includes(s.role))return new Response("Forbidden",{status:403});
 await ensure(env);
 const checks:{area:string;result:string;detail:string}[]=[];
 const add=(area:string,pass:boolean,detail:string)=>checks.push({area,result:pass?"PASS":"REVIEW",detail});
 const headers={"content-type":"application/json","x-telemetry-source":"invalid-staging-source","authorization":"Bearer invalid-staging-token"};
 const invalid=await ingest(new Request(new URL("/api/telemetry/v2",req.url),{method:"POST",headers,body:JSON.stringify({})}),env);
 add("Security: invalid credentials",invalid.status===401,"Expected HTTP 401; received "+invalid.status);
 const noAuth=await ingest(new Request(new URL("/api/telemetry/v2",req.url),{method:"POST",headers:{"content-type":"application/json"},body:"{}"}),env);
 add("Security: missing credentials",noAuth.status===401,"Expected HTTP 401; received "+noAuth.status);
 const mappings=await all(env,"SELECT m.connection_id,m.external_machine_id,m.machine_id,c.company_id owner FROM telemetry_machine_map_v2 m JOIN telemetry_connections_v2 c ON c.id=m.connection_id WHERE m.company_id=? LIMIT 100",[s.companyId]);
 add("Machine mappings",mappings.every(x=>num(x.owner)===s.companyId)&&new Set(mappings.map(x=>String(x.connection_id)+":"+String(x.external_machine_id).toLowerCase())).size===mappings.length,"Checked "+mappings.length+" local mappings and connection ownership");
 const cross=await first(env,"SELECT COUNT(*) n FROM telemetry_machine_map_v2 m JOIN telemetry_connections_v2 c ON c.id=m.connection_id WHERE m.company_id=? AND c.company_id<>?",[s.companyId,s.companyId]);
 add("Company isolation: mapping ownership",num(cross?.n)===0,"Cross-company connection mappings visible to this company: "+num(cross?.n));
 const duplicates=await first(env,"SELECT COUNT(*) n FROM (SELECT event_key FROM telemetry_ingest_v2 WHERE company_id=? GROUP BY event_key HAVING COUNT(*)>1)",[s.companyId]);
 add("Duplicate event-key storage",num(duplicates?.n)===0,"Duplicate event keys: "+num(duplicates?.n)+"; active replay behavior requires separate integration testing");
 const quarantines=await first(env,"SELECT COUNT(*) n FROM telemetry_ingest_v2 WHERE company_id=? AND status='quarantined'",[s.companyId]);
 checks.push({area:"Invalid data and quarantine",result:"NOT RUN",detail:"Historical quarantined messages: "+num(quarantines?.n)+". Requires a controlled authenticated negative-payload test."});
 checks.push({area:"Fault lifecycle",result:"PARTIAL",detail:"Observation grouping is implemented; explicit OEM clear and recurrence events are not yet supported."});
 checks.push({area:"Engineer investigation and closure",result:"NOT IMPLEMENTED",detail:"Role-based acknowledgement, inspection notes and verified closure need a dedicated workflow."});
 checks.push({area:"Multiple-machine separation",result:"NOT RUN",detail:"Needs at least two registered machines and controlled event assertions."});
 checks.push({area:"Reliability: retries and outages",result:"NOT RUN",detail:"Requires injected failures and replay testing; no live OEM is connected."});
 const rows=checks.map(x=>`<tr><td>${esc(x.area)}</td><td><b>${esc(x.result)}</b></td><td>${esc(x.detail)}</td></tr>`).join("");
 return page(s,`<section class="panel"><h2>OEM integration verification centre — staging</h2><p>Read-only checks against the authenticated staging company. PASS means only the stated assertion was verified; it does not certify the complete subsystem. No test data is written by this page.</p><table><tr><th>Area</th><th>Result</th><th>Evidence and limitations</th></tr>${rows}</table><p><a class="btn" href="/telemetry/connections/verify">Run checks again</a> · <a href="/telemetry/connections">Back to connections</a></p></section>`);
}

async function connections(req:Request,env:Env,s:Session){await ensure(env);const cs=await all(env,"SELECT * FROM telemetry_connections_v2 WHERE company_id=? ORDER BY id DESC",[s.companyId]),maps=await all(env,"SELECT m.*,c.connection_name connectionName FROM telemetry_machine_map_v2 m JOIN telemetry_connections_v2 c ON c.id=m.connection_id WHERE m.company_id=? ORDER BY m.id DESC",[s.companyId]),machines=await all(env,"SELECT fleet_number fleet FROM machines WHERE company_id=? ORDER BY fleet_number",[s.companyId]),receipts=await all(env,"SELECT i.*,c.connection_name connectionName FROM telemetry_ingest_v2 i JOIN telemetry_connections_v2 c ON c.id=i.connection_id WHERE i.company_id=? ORDER BY i.id DESC LIMIT 30",[s.companyId]),msg=txt(new URL(req.url).searchParams.get("msg"));const sim=await first(env,"SELECT machine_id,enabled,last_run_at,last_status FROM telemetry_simulator_v2 WHERE company_id=?",[s.companyId]).catch(()=>null);const options=cs.filter(x=>low(x.status)==="active").map(x=>`<option value="${num(x.id)}">${esc(x.connection_name)} · ${esc(x.provider)}</option>`).join(""),machineOptions=machines.map(x=>`<option>${esc(x.fleet)}</option>`).join("");return page(s,`${msg?`<div class="ok">${esc(msg)}</div>`:""}<section class="panel"><h2>1. Register an OEM or device connection</h2><form method="post" action="/telemetry/connections/create" class="grid"><label class="field">Provider<select name="provider"><option value="komtrax">KOMTRAX</option><option value="visionlink">CAT VisionLink</option><option value="fleetmatic">Bell Fleetm@tic</option><option value="j1939">J1939 device</option><option value="other">Other provider</option></select></label><label class="field">Connection name<input name="name" required placeholder="Sundane Coal KOMTRAX"></label><button>Create secure connection</button></form></section><section class="panel"><h2>Connections and health</h2><table><tr><th>Name</th><th>Provider</th><th>Source key</th><th>Status</th><th>Last success</th><th>Last error</th></tr>${cs.map(x=>`<tr><td><b>${esc(x.connection_name)}</b></td><td>${esc(x.provider)}</td><td><code>${esc(x.source_key)}</code></td><td><span class="pill">${esc(x.status)}</span></td><td>${esc(x.last_success_at||"Never")}</td><td class="bad">${esc(x.last_error||"—")}</td></tr>`).join("")||`<tr><td colspan="6">No connections registered.</td></tr>`}</table></section><section class="panel"><h2>2. Map OEM machine IDs to fleet</h2>${machines.length===0?`<div class="ok" style="background:#fff4e5;color:#7c4a03"><b>No fleet machines registered for this company.</b> Register a machine in the company Fleet Register first, then return here to link its OEM serial number. <a href="/contractor?view=fleet">Open Fleet Register</a></div>`:`<p>${machines.length} registered fleet machine(s) available for OEM mapping. <a href="/contractor?view=fleet">Manage fleet</a></p>`}<form method="post" action="/telemetry/connections/map" class="grid"><label class="field">Connection<select name="connection" required><option value="">Choose</option>${options}</select></label><label class="field">OEM serial / external ID<input name="external" required></label><label class="field">Registered fleet machine<select name="machine" required><option value="">Choose</option>${machineOptions}</select></label><button>Save machine mapping</button></form><table><tr><th>Connection</th><th>External ID</th><th>Fleet machine</th></tr>${maps.map(x=>`<tr><td>${esc(x.connectionName)}</td><td>${esc(x.external_machine_id)}</td><td><b>${esc(x.machine_id)}</b></td></tr>`).join("")||`<tr><td colspan="3">No mappings yet.</td></tr>`}</table></section><section class="panel"><h2>Raw ingestion and quarantine audit</h2><table><tr><th>Received</th><th>Connection</th><th>External ID</th><th>Status</th><th>Error / reason</th></tr>${receipts.map(x=>`<tr><td>${esc(x.received_at)}</td><td>${esc(x.connectionName)}</td><td>${esc(x.external_machine_id||"—")}</td><td>${esc(x.status)}</td><td class="bad">${esc(x.error||"—")}</td></tr>`).join("")||`<tr><td colspan="5">No OEM messages received.</td></tr>`}</table></section><section class="panel"><h2>Automatic staging OEM simulator</h2><p>The existing SAS ADT 027 staging demo automatically enrols on the next scheduled run; no button is required. Other machines require explicit opt-in. This is NOT real machine data. It does not update operating hours or create live operational alerts.</p><form method="post" action="/telemetry/connections/simulator" class="grid"><label class="field">Registered machine<select name="machine" required><option value="">Choose</option>${machines.map(x=>`<option value="${esc(x.fleet)}" ${txt(sim?.machine_id)===txt(x.fleet)?"selected":""}>${esc(x.fleet)}</option>`).join("")}</select></label><label class="field">Enable automatic simulation<input type="checkbox" name="enabled" ${num(sim?.enabled)===1?"checked":""}></label><button>Save simulator settings</button></form><p>Last run: ${esc(sim?.last_run_at||"Never")} · Status: ${esc(sim?.last_status||"Not started")}</p></section><section class="panel"><h2>3. OEM Integration Test Centre — staging only</h2><p>Send one <b>SIMULATED</b> SPN 110 FMI 0 event through the real authenticated telemetry ingestion API. No laptop Python or Bearer token required. This test does not connect to a real OEM and does not change operating hours.</p><form method="post" action="/telemetry/connections/test" class="grid"><label class="field">Registered fleet machine<select name="machine" required><option value="">Choose</option>${machineOptions}</select></label><label class="field">Machine system<select name="scenario"><option value="all">All 10 machine systems</option>${Object.entries(SCENARIOS).map(([key,v])=>`<option value="${esc(key)}">${esc(v.label)}</option>`).join("")}</select></label><button ${machines.length===0?"disabled":""}>Run simulated telemetry test</button></form><p><a href="/telemetry/connections/report">Open Engineering Condition Reports</a> · <a href="/telemetry/connections/scheduled-reports">Scheduled report snapshots</a> · <a href="/telemetry/connections/automatic-analysis">Automatic fault and condition analysis</a> · <a href="/telemetry/connections/diagnostic-library">OEM diagnostic library</a></p></section><section class="panel"><h2>4. OEM integration verification</h2><p>Run staging-only security, mapping and data-integrity checks. The report distinguishes passed checks from unimplemented or untested workflows.</p><a class="btn" href="/telemetry/connections/verify">Open verification centre</a></section><section class="panel"><h2>Provider endpoint</h2><code>POST /api/telemetry/v2</code><p>Headers: <b>x-telemetry-source</b> and <b>Authorization: Bearer …</b>. Maximum 100 readings per batch.</p></section>`)}

export default {async fetch(req:Request,env:Env,ctx:ExecutionContext){const u=new URL(req.url);if(["/api/telemetry/v2","/api/telemetry/ingest","/api/telemetry"].includes(u.pathname))return ingest(req,env);
if(u.pathname==="/api/telemetry/automatic"||u.pathname==="/telemetry/automatic"){const s=await session(req,env);if(!s)return u.pathname.startsWith("/api/")?json({error:"Sign in required"},401):redirect("/contractor-login");if(req.method!=="GET")return new Response("Method not allowed",{status:405});await ensure(env);return u.pathname.startsWith("/api/")?json(await automaticFleetData(env,s.companyId,u)):automaticDashboard(s.companyName,u)}if(u.pathname.startsWith("/telemetry/connections")){const s=await session(req,env);if(!s)return redirect("/contractor-login");if(u.pathname==="/telemetry/connections/discovered")return discoveredAssets(req,env,s);if(u.pathname==="/telemetry/connections/automation")return automationConfiguration(req,env,s);if(u.pathname==="/telemetry/connections/report-document"&&req.method==="GET")return reportDocument(req,env,s);if(u.pathname==="/telemetry/connections/pipeline-status"&&req.method==="GET")return pipelineStatus(req,env,s);if(u.pathname==="/telemetry/connections/verify"&&req.method==="GET")return verificationCentre(req,env,s);if(u.pathname==="/telemetry/connections/create"&&req.method==="POST")return createConnection(req,env,s);if(u.pathname==="/telemetry/connections/map"&&req.method==="POST")return addMap(req,env,s);if(u.pathname==="/telemetry/connections/test"&&req.method==="POST")return testCentre(req,env,s);if(u.pathname==="/telemetry/connections/simulator"&&req.method==="POST")return simulatorSettings(req,env,s);if(u.pathname==="/telemetry/connections/report"&&req.method==="GET")return engineeringReport(req,env,s);if(u.pathname==="/telemetry/connections/scheduled-reports"&&req.method==="GET")return scheduledReportPage(req,env,s);if(u.pathname==="/telemetry/connections/automatic-analysis"&&req.method==="GET")return automaticAnalysisPage(req,env,s);if(u.pathname==="/telemetry/connections/diagnostic-library"&&req.method==="GET")return diagnosticLibraryPage(req,env,s);if(req.method==="GET")return connections(req,env,s)}return currentApp.fetch(req,env as never,ctx as never)},async scheduled(c:ScheduledController,env:Env,ctx:ExecutionContext){await runAutomatedSimulation(env,c.scheduledTime);await replayDiscovered(env);await runTelemetryAutomation(env,diagnosticLookup)}};
