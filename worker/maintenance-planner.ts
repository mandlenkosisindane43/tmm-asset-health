import * as XLSX from "xlsx";

type Env={DB:D1Database};
type Session={companyId:number;accountId:number;role:string;companyName:string};
type Row=Record<string,unknown>;
const path="/telemetry/connections/maintenance-planner";
const str=(v:unknown,n=250)=>String(v??"").trim().slice(0,n);
const esc=(v:unknown)=>String(v??"").replace(/[&<>"']/g,c=>({"&":"&amp;","<":"&lt;",">":"&gt;",'"':"&quot;","'":"&#39;"}[c]||c));
const validDate=(v:string)=>/^\d{4}-\d{2}-\d{2}$/.test(v)&&!Number.isNaN(Date.parse(v+"T00:00:00Z"))&&new Date(v+"T00:00:00Z").toISOString().slice(0,10)===v;
const validTime=(v:string)=>/^\d{2}:\d{2}$/.test(v)&&Number(v.slice(0,2))<24&&Number(v.slice(3))<60;
const day=(v:unknown)=>{if(typeof v==="number"&&v>20000&&v<100000){const d=XLSX.SSF.parse_date_code(v);if(d)return [d.y,String(d.m).padStart(2,"0"),String(d.d).padStart(2,"0")].join("-")}const x=str(v,40);if(validDate(x))return x;const m=x.match(/^(\d{1,2})[\/.-](\d{1,2})[\/.-](\d{4})$/);return m?[m[3],m[2].padStart(2,"0"),m[1].padStart(2,"0")].join("-"):""};
const names:Record<string,string>={machine:"machine",fleet:"machine",fleetnumber:"machine",machineid:"machine",equipment:"machine",asset:"machine",date:"date",scheduleddate:"date",servicedate:"date",startdate:"date",start:"start",starttime:"start",end:"end",endtime:"end",finish:"end",finishtime:"end",task:"task",description:"task",maintenancetask:"task",servicetype:"task",job:"task",workorder:"work_order",workordernumber:"work_order",wonumber:"work_order",reference:"work_order",notes:"notes",comment:"notes"};
const mapHeader=(v:unknown)=>names[str(v).toLowerCase().replace(/[^a-z0-9]/g,"")]||"";
const input=(o:Row)=>({machine:str(o.machine,80),date:day(o.date),start:str(o.start,5),end:str(o.end,5),task:str(o.task,180),work_order:str(o.work_order,80),notes:str(o.notes,500)});
const validate=(o:ReturnType<typeof input>)=>!o.machine||!validDate(o.date)||!validTime(o.start)||!validTime(o.end)||o.end<=o.start||!o.task?"Machine, valid date, start/end times (same day), and task are required":"";
function response(msg:string,status=400){return new Response(msg,{status,headers:{"content-type":"text/plain;charset=utf-8","cache-control":"no-store"}})}
async function ensure(env:Env){
 for(const sql of [
  "CREATE TABLE IF NOT EXISTS maintenance_plan_batches_v1(id INTEGER PRIMARY KEY AUTOINCREMENT,company_id INTEGER NOT NULL,filename TEXT NOT NULL,format TEXT NOT NULL,status TEXT NOT NULL DEFAULT 'review',created_by INTEGER NOT NULL,created_at TEXT NOT NULL,notes TEXT)",
  "CREATE TABLE IF NOT EXISTS maintenance_plan_entries_v1(id INTEGER PRIMARY KEY AUTOINCREMENT,company_id INTEGER NOT NULL,batch_id INTEGER,machine_id TEXT NOT NULL,service_date TEXT NOT NULL,start_time TEXT NOT NULL,end_time TEXT NOT NULL,task TEXT NOT NULL,work_order TEXT,notes TEXT,status TEXT NOT NULL DEFAULT 'draft',created_by INTEGER NOT NULL,created_at TEXT NOT NULL,approved_by INTEGER,approved_at TEXT,UNIQUE(company_id,batch_id,machine_id,service_date,start_time,task))",
  "CREATE TABLE IF NOT EXISTS maintenance_stop_events_v1(id INTEGER PRIMARY KEY AUTOINCREMENT,company_id INTEGER NOT NULL,machine_id TEXT NOT NULL,started_at TEXT NOT NULL,ended_at TEXT NOT NULL,kind TEXT NOT NULL CHECK(kind IN ('breakdown','unknown')),source_mode TEXT NOT NULL CHECK(source_mode IN ('simulation','live')),confirmation_ref TEXT NOT NULL,created_by INTEGER NOT NULL,created_at TEXT NOT NULL)",
  "CREATE INDEX IF NOT EXISTS idx_maintenance_stop_company_time ON maintenance_stop_events_v1(company_id,started_at,ended_at)",
  "CREATE INDEX IF NOT EXISTS idx_maintenance_company_date ON maintenance_plan_entries_v1(company_id,service_date,status)"
 ])await env.DB.prepare(sql).run();
}
async function fleet(env:Env,company:number){return (await env.DB.prepare("SELECT fleet_number FROM machines WHERE company_id=? ORDER BY fleet_number").bind(company).all<Row>()).results||[]}
async function insert(env:Env,s:Session,o:ReturnType<typeof input>,batch:number|null,valid:Set<string>){
 const err=validate(o);if(err)throw Error(err);
 if(!valid.has(o.machine.toLowerCase()))throw Error("Unregistered machine: "+o.machine);
 await env.DB.prepare("INSERT INTO maintenance_plan_entries_v1(company_id,batch_id,machine_id,service_date,start_time,end_time,task,work_order,notes,status,created_by,created_at) VALUES(?,?,?,?,?,?,?,?,?,'draft',?,?)")
 .bind(s.companyId,batch,o.machine,o.date,o.start,o.end,o.task,o.work_order,o.notes,s.accountId,new Date().toISOString()).run();
}
const html=(s:Session,body:string)=>new Response('<!doctype html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>Maintenance Planner · TMM Asset Health</title><style>:root{font-family:system-ui,Arial;background:#eef4fb;color:#173453}*{box-sizing:border-box}body{margin:0}header{background:#102b4e;color:#fff;padding:24px max(18px,calc((100vw - 1180px)/2));}header a{color:#b9ddff}main{max-width:1180px;margin:22px auto;padding:0 16px}.panel{background:white;padding:23px;border-radius:16px;margin:0 0 18px;box-shadow:0 5px 24px #12345b13}h1{margin:8px 0}h2{margin:0 0 13px}p{line-height:1.5}.grid{display:grid;grid-template-columns:repeat(auto-fit,minmax(170px,1fr));gap:13px}label{font-size:13px;font-weight:650;display:flex;flex-direction:column;gap:6px}input,select,textarea{border:1px solid #b9cce0;border-radius:9px;padding:11px;font:inherit;width:100%;background:white}button,.btn{background:#155ca8;color:white;border:0;border-radius:9px;padding:11px 15px;cursor:pointer;font-weight:650;display:inline-block;text-decoration:none}button:disabled{opacity:.4}.muted{color:#607994}.warn{background:#fff5d9;padding:11px;border-radius:9px}.ok{background:#d9f5e6;padding:12px;border-radius:9px}table{width:100%;border-collapse:collapse;font-size:13px}th,td{padding:11px;text-align:left;border-bottom:1px solid #dce6f1}th{color:#496580}.scroll{overflow-x:auto}.status{font-weight:bold}.actions{display:flex;gap:8px;flex-wrap:wrap}.small{font-size:12px}</style></head><body><header><a href="/contractor?view=dashboard&mode=live">← TMM Dashboard</a>　·　<a href="/telemetry/automatic?section=maintenance&mode=live">Service forecasts</a>　·　<a href="/telemetry/connections">Data connections</a><h1>🔧 Maintenance Planner</h1><span>'+esc(s.companyName)+' · Mine-approved maintenance plans take priority</span></header><main>'+body+'</main></body></html>',{headers:{"content-type":"text/html;charset=utf-8","cache-control":"private,no-store","x-content-type-options":"nosniff"}});
export async function maintenancePlanner(req:Request,env:Env,s:Session,authToken:string):Promise<Response>{
 await ensure(env);
 const admin=["company_admin","admin"].includes(s.role);
 const fmachines=await fleet(env,s.companyId),valid=new Set(fmachines.map(m=>str(m.fleet_number).toLowerCase()));
 const u=new URL(req.url),csrf=authToken;
 if(req.method==="POST"){
  if(!admin)return response("Only company administrators can change maintenance schedules",403);
  if(req.headers.get("origin")!==u.origin)return response("Invalid request origin",403);
  if(Number(req.headers.get("content-length")||0)>3_000_000)return response("File too large (3 MB maximum)",413);
  const f=await req.formData();if(f.get("csrf")!==csrf)return response("Invalid request token",403);
  const action=str(f.get("action"),30);
  try{
   if(action==="stop"){
    const machine=str(f.get("machine"),80),started=str(f.get("started_at"),50),ended=str(f.get("ended_at"),50),kind=str(f.get("kind"),20),source=str(f.get("source_mode"),20),reference=str(f.get("confirmation_ref"),100);
    if(!valid.has(machine.toLowerCase()))return response("Choose an existing registered machine");
    if(!["breakdown","unknown"].includes(kind)||!["simulation","live"].includes(source)||!reference)return response("Valid stop type, source mode and independent confirmation reference required");
    const a=Date.parse(started),b=Date.parse(ended);
    if(!Number.isFinite(a)||!Number.isFinite(b)||b<=a||b-a>24*3600000)return response("Stop interval must be valid, positive and no longer than 24 hours");
    if(source==="live")return response("Live stop classification requires a verified telemetry or maintenance-system source; manual test entries must use Simulation",403);
    await env.DB.prepare("INSERT INTO maintenance_stop_events_v1(company_id,machine_id,started_at,ended_at,kind,source_mode,confirmation_ref,created_by,created_at) VALUES(?,?,?,?,?,?,?,?,?)").bind(s.companyId,machine,new Date(a).toISOString(),new Date(b).toISOString(),kind,source,reference,s.accountId,new Date().toISOString()).run();
    return Response.redirect(u.origin+path+"?msg=Confirmed+stop+interval+recorded",303);
   }
   if(action==="create"){
    await insert(env,s,input({machine:f.get("machine"),date:f.get("date"),start:f.get("start"),end:f.get("end"),task:f.get("task"),work_order:f.get("work_order"),notes:f.get("notes")}),null,valid);
    return Response.redirect(u.origin+path+"?msg=Draft+schedule+saved",303);
   }
   if(action==="import"){
    const file=f.get("file");
    if(!(file instanceof File)||!file.size)return response("Choose an Excel or PDF file");
    if(file.size>2_000_000)return response("Maximum file size is 2 MB",413);
    const filename=str(file.name,120),ext=filename.toLowerCase().split(".").pop();
    if(!["xlsx","xls","pdf"].includes(ext||""))return response("Supported formats: .xlsx, .xls and .pdf");
    const bytes=new Uint8Array(await file.arrayBuffer());
    if(ext==="pdf"&&new TextDecoder("latin1").decode(bytes.slice(0,5))!=="%PDF-")return response("Invalid PDF document");
    if(ext!=="pdf"&&!((bytes[0]===0x50&&bytes[1]===0x4b)||(bytes[0]===0xd0&&bytes[1]===0xcf)))return response("Invalid Excel document");
    let imported=0,invalid=0,records:ReturnType<typeof input>[]=[];
    if(ext!=="pdf"){
     const wb=XLSX.read(bytes,{type:"array",cellDates:false,sheetRows:202});
     if(!wb.SheetNames.length)return response("Workbook has no sheets");
     const data=XLSX.utils.sheet_to_json<unknown[]>(wb.Sheets[wb.SheetNames[0]],{header:1,defval:"",raw:true}) as unknown[][];
     const cols=(data[0]||[]).map(mapHeader);if(!["machine","date","start","end","task"].every(k=>cols.includes(k)))return response("Excel first row must contain Machine, Date, Start, End and Task columns");
     for(const arr of data.slice(1,201)){
      if(!arr.some(v=>str(v)))continue;
      const raw:Row={};cols.forEach((k,i)=>{if(k)raw[k]=arr[i]});
      if(typeof raw.start==="number")raw.start=String(Math.floor(raw.start*24)).padStart(2,"0")+":"+String(Math.round((raw.start*1440)%60)).padStart(2,"0");
      if(typeof raw.end==="number")raw.end=String(Math.floor(raw.end*24)).padStart(2,"0")+":"+String(Math.round((raw.end*1440)%60)).padStart(2,"0");
      records.push(input(raw));
     }
     if(records.length===0)return response("No Excel maintenance rows found");
    }
    const result=await env.DB.prepare("INSERT INTO maintenance_plan_batches_v1(company_id,filename,format,status,created_by,created_at,notes) VALUES(?,?,?,'review',?,?,?)").bind(s.companyId,filename,ext,s.accountId,new Date().toISOString(),ext==="pdf"?"PDF document registration only; enter and verify rows manually. Original PDF content is not retained.":"Excel parsed from first worksheet; invalid or unregistered rows excluded.").run();
    const id=Number(result.meta.last_row_id);
    for(const o of records){try{await insert(env,s,o,id,valid);imported++}catch{invalid++}}
    return Response.redirect(u.origin+path+"?msg="+encodeURIComponent(ext==="pdf"?"PDF recorded for manual review. Enter its schedule rows below; no automatic PDF extraction.":imported+" Excel rows imported as drafts; "+invalid+" rows excluded for invalid or unregistered machine data."),303);
   }
   if(action==="approve"||action==="reject"){
    const id=Number(f.get("id"));if(!Number.isSafeInteger(id)||id<=0)return response("Invalid entry");
    const sql=action==="approve"?"UPDATE maintenance_plan_entries_v1 SET status='approved',approved_by=?,approved_at=? WHERE id=? AND company_id=? AND status='draft'":"UPDATE maintenance_plan_entries_v1 SET status='rejected',approved_by=?,approved_at=? WHERE id=? AND company_id=? AND status='draft'";
    const out=await env.DB.prepare(sql).bind(s.accountId,new Date().toISOString(),id,s.companyId).run();
    if(!out.meta.changes)return response("Entry not found or already reviewed",409);
    return Response.redirect(u.origin+path+"?msg=Maintenance+entry+reviewed",303);
   }
   return response("Unknown maintenance action",400);
  }catch(e){return response("Unable to save: "+(e instanceof Error?e.message:"Invalid input"),400)}
 }
 if(req.method!=="GET")return response("Method not allowed",405);
 const entries=(await env.DB.prepare("SELECT * FROM maintenance_plan_entries_v1 WHERE company_id=? ORDER BY service_date DESC,id DESC LIMIT 150").bind(s.companyId).all<Row>()).results||[];
 const batches=(await env.DB.prepare("SELECT * FROM maintenance_plan_batches_v1 WHERE company_id=? ORDER BY id DESC LIMIT 15").bind(s.companyId).all<Row>()).results||[];
 const hidden='<input type="hidden" name="csrf" value="'+esc(csrf)+'">';
 const opts=fmachines.map(m=>'<option value="'+esc(m.fleet_number)+'">'+esc(m.fleet_number)+'</option>').join("");
 const msg=str(u.searchParams.get("msg"),220);
 const form='<section class="panel"><h2>1. Schedule maintenance directly</h2><p class="muted">Create a draft for an existing fleet machine. An administrator must approve the entry before it becomes an official planned maintenance booking.</p><form method="post" action="'+path+'">'+hidden+'<input type="hidden" name="action" value="create"><div class="grid"><label>Machine<select name="machine" required><option value="">Choose registered machine</option>'+opts+'</select></label><label>Service date (SAST)<input type="date" name="date" required></label><label>Start time (SAST)<input type="time" name="start" required></label><label>End time (SAST)<input type="time" name="end" required></label><label>Maintenance task<input name="task" maxlength="180" required placeholder="e.g. 500 h service"></label><label>Work order<input name="work_order" maxlength="80" placeholder="Mine work-order reference"></label></div><p><label>Notes<textarea name="notes" rows="2" maxlength="500"></textarea></label></p><button '+(!admin||!fmachines.length?"disabled":"")+'>Save draft schedule</button></form></section>';
 const upload='<section class="panel"><h2>2. Import a maintenance plan</h2><p><b>Excel:</b> The first worksheet must contain columns <code>Machine, Date, Start, End, Task</code>. Optional: <code>Work Order, Notes</code>. Up to 200 rows, 2 MB maximum. Fleet numbers must already exist. Invalid rows are skipped and counted.</p><p class="warn"><b>PDF:</b> This stage records only the PDF filename for a manual-review workflow. It does not extract or store the PDF document. Enter the verified schedule details using the form above. Never approve based on an unverified document.</p><form method="post" enctype="multipart/form-data" action="'+path+'">'+hidden+'<input type="hidden" name="action" value="import"><p><input type="file" name="file" accept=".xlsx,.xls,.pdf" required></p><button '+(!admin?"disabled":"")+'>Upload for review</button></form></section>';
 const table='<section class="panel"><h2>3. Review and approve maintenance entries</h2><p class="muted">Only approved entries are confirmed mine bookings. Drafts and rejected rows must never classify machine downtime as planned.</p><div class="scroll"><table><thead><tr><th>Machine</th><th>Date / time</th><th>Task / work order</th><th>Source</th><th>Status</th><th>Action</th></tr></thead><tbody>'+entries.map(e=>'<tr><td>'+esc(e.machine_id)+'</td><td>'+esc(e.service_date)+'<br>'+esc(e.start_time)+'–'+esc(e.end_time)+'</td><td>'+esc(e.task)+'<br><small>'+esc(e.work_order)+'</small></td><td>'+(e.batch_id?"Import #"+esc(e.batch_id):"Direct")+'</td><td class="status">'+esc(e.status)+'</td><td>'+(admin&&e.status==="draft"?'<div class="actions">'+["approve","reject"].map(a=>'<form method="post" action="'+path+'">'+hidden+'<input type="hidden" name="action" value="'+a+'"><input type="hidden" name="id" value="'+esc(e.id)+'"><button>'+a+'</button></form>').join("")+'</div>':"—")+'</td></tr>').join("")+'</tbody></table></div></section>';
 const stopEntries=(await env.DB.prepare("SELECT machine_id,started_at,ended_at,kind,source_mode,confirmation_ref FROM maintenance_stop_events_v1 WHERE company_id=? ORDER BY id DESC LIMIT 30").bind(s.companyId).all<Row>()).results||[];
 const stopSection='<section class="panel"><h2>4. Record a confirmed machine stop (verification)</h2><p class="warn">The approved maintenance booking alone is not proof of downtime. Enter stop/start timestamps only if confirmed by a reliable record. For simulated equipment, keep Source = Simulation. Use ISO date-times with an explicit timezone (e.g. 2026-11-16T08:00:00+02:00).</p><form method="post" action="'+path+'">'+hidden+'<input type="hidden" name="action" value="stop"><div class="grid"><label>Machine<select name="machine" required><option value="">Choose machine</option>'+opts+'</select></label><label>Stopped at (ISO with timezone)<input name="started_at" required placeholder="2026-11-16T08:00:00+02:00"></label><label>Resumed at (ISO with timezone)<input name="ended_at" required placeholder="2026-11-16T10:00:00+02:00"></label><label>Cause<select name="kind"><option value="unknown">Unknown / pending cause</option><option value="breakdown">Confirmed breakdown</option></select></label><label>Source<select name="source_mode"><option value="simulation">Simulation — test only</option></select></label><label>Confirmation reference<input name="confirmation_ref" required maxlength="100" placeholder="SIM-STOP-001"></label></div><p><button '+(!admin?"disabled":"")+'>Record confirmed interval</button></p></form><h3>Recent recorded stop intervals</h3><div class="scroll"><table><tr><th>Machine</th><th>Started UTC</th><th>Resumed UTC</th><th>Cause</th><th>Source</th><th>Reference</th></tr>'+stopEntries.map(x=>'<tr><td>'+esc(x.machine_id)+'</td><td>'+esc(x.started_at)+'</td><td>'+esc(x.ended_at)+'</td><td>'+esc(x.kind)+'</td><td>'+esc(x.source_mode)+'</td><td>'+esc(x.confirmation_ref)+'</td></tr>').join("")+'</table></div></section>';
 const history='<section class="panel"><h2>5. Imported documents audit trail</h2><div class="scroll"><table><tr><th>Filename</th><th>Format</th><th>Created</th><th>Review notes</th></tr>'+batches.map(b=>'<tr><td>'+esc(b.filename)+'</td><td>'+esc(b.format)+'</td><td>'+esc(b.created_at)+'</td><td>'+esc(b.notes)+'</td></tr>').join("")+'</table></div><p class="small muted">This planner stores structured schedule entries. The original uploaded file is not retained. Changes to approved entries require a new reviewed draft in this initial version. It does not yet integrate with OEM or mine CMMS APIs or automatically alter historical downtime classifications.</p></section>';
 return html(s,(msg?'<p class="ok">'+esc(msg)+'</p>':"")+(admin?"":'<p class="warn">Read-only access. A company administrator must create and approve bookings.</p>')+form+upload+table+stopSection+history);
}
