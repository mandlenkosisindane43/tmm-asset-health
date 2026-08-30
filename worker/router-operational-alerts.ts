import currentApp from "./router-onboarding";

interface ExecutionContext { waitUntil(promise: Promise<unknown>): void; passThroughOnException(): void; }
interface ScheduledController { scheduledTime:number; cron:string; noRetry():void; }
interface Env {
  DB:D1Database;
  RESEND_API_KEY?:string;
  NOTIFICATION_FROM_EMAIL?:string;
  [key:string]:unknown;
}
type Row=Record<string,unknown>;
type AlertKind="breakdown"|"critical"|"service_due"|"po"|"missing_report"|"repeat_failure";
const COOKIE="sas_contractor_v2";
const enc=new TextEncoder();
const ORIGIN="https://tmm-asset-health.mandlenkosisindane43.workers.dev";
function txt(v:unknown,max=500){return String(v??"").trim().slice(0,max);}
function lower(v:unknown){return txt(v,300).toLowerCase();}
function num(v:unknown,f=0){const n=Number(v);return Number.isFinite(n)?n:f;}
function esc(v:unknown){return String(v??"").replace(/[&<>"']/g,c=>({"&":"&amp;","<":"&lt;",">":"&gt;",'"':"&quot;","'":"&#39;"}[c]||c));}
function getCookie(req:Request,name:string){for(const p of (req.headers.get("cookie")||"").split(";")){const i=p.indexOf("=");if(i>-1&&p.slice(0,i).trim()===name)return p.slice(i+1).trim();}return "";}
async function sha256(v:string){return Array.from(new Uint8Array(await crypto.subtle.digest("SHA-256",enc.encode(v))),b=>b.toString(16).padStart(2,"0")).join("");}
async function all(env:Env,sql:string,binds:unknown[]=[]){try{return (await env.DB.prepare(sql).bind(...binds).all<Row>()).results||[];}catch{return [];}}
async function first(env:Env,sql:string,binds:unknown[]=[]){try{return await env.DB.prepare(sql).bind(...binds).first<Row>();}catch{return null;}}
function zaNow(){return new Date(Date.now()+2*3600000);}
function zaDate(){return zaNow().toISOString().slice(0,10);}
function dayDiff(date:string){const t=new Date(date.length<=10?`${date}T00:00:00Z`:date).getTime();const today=new Date(`${zaDate()}T00:00:00Z`).getTime();return Number.isFinite(t)?Math.ceil((t-today)/86400000):99999;}

async function ensureSchema(env:Env){
  await env.DB.prepare(`CREATE TABLE IF NOT EXISTS operational_alert_audit_v1 (
    id INTEGER PRIMARY KEY AUTOINCREMENT,company_id INTEGER NOT NULL,alert_key TEXT NOT NULL UNIQUE,alert_kind TEXT NOT NULL,
    subject TEXT NOT NULL,recipients TEXT,status TEXT NOT NULL,provider_ids TEXT,error TEXT,created_at TEXT NOT NULL
  )`).run();
  await env.DB.prepare(`CREATE INDEX IF NOT EXISTS idx_operational_alert_company ON operational_alert_audit_v1(company_id,created_at)`).run();
}
async function companyFromRequest(req:Request,env:Env){
  const token=getCookie(req,COOKIE);if(!token)return 0;
  const r=await first(env,"SELECT company_id AS companyId FROM contractor_sessions WHERE token_hash=? AND datetime(expires_at)>datetime('now') LIMIT 1",[await sha256(token)]);
  return num(r?.companyId);
}
async function companyName(env:Env,cid:number){const r=await first(env,"SELECT name FROM companies WHERE id=? LIMIT 1",[cid]);return txt(r?.name||`Company ${cid}`,150);}
async function recipients(env:Env,cid:number,kind:AlertKind){
  const rows=await all(env,"SELECT email,breakdown,service_due AS serviceDue,missing_report AS missingReport,po,critical,active FROM alert_contacts_v3 WHERE company_id=? AND active=1 AND email IS NOT NULL AND trim(email)<>''",[cid]);
  const picked=rows.filter(r=>{
    if(kind==="breakdown")return num(r.breakdown)===1;
    if(kind==="service_due")return num(r.serviceDue)===1;
    if(kind==="missing_report")return num(r.missingReport)===1;
    if(kind==="po")return num(r.po)===1;
    return num(r.critical)===1;
  }).map(r=>lower(r.email)).filter(x=>x.includes("@"));
  if(picked.length)return [...new Set(picked)].slice(0,10);
  const fallback=await all(env,"SELECT email FROM contractor_accounts WHERE company_id=? AND status='active' AND role IN ('company_admin','admin','manager','engineer') ORDER BY CASE role WHEN 'company_admin' THEN 1 WHEN 'admin' THEN 1 WHEN 'manager' THEN 2 ELSE 3 END LIMIT 10",[cid]);
  return [...new Set(fallback.map(r=>lower(r.email)).filter(x=>x.includes("@")))];
}
function emailHtml(company:string,title:string,severity:string,lines:Array<[string,unknown]>,action="Open TMM Asset Health"){
  const rows=lines.map(([k,v])=>`<tr><td style="padding:7px 10px;color:#66747d;border-bottom:1px solid #edf1ef">${esc(k)}</td><td style="padding:7px 10px;font-weight:700;border-bottom:1px solid #edf1ef">${esc(v)}</td></tr>`).join("");
  return `<!doctype html><html><body style="margin:0;background:#f3f6f4;font-family:Arial,sans-serif;color:#10202b"><div style="max-width:640px;margin:28px auto;background:#fff;border:1px solid #e0e7e4;border-radius:14px;overflow:hidden"><div style="background:#071622;color:#fff;padding:25px 30px"><div style="font-size:20px;font-weight:800">TMM Asset Health</div><div style="color:#e4ad17;font-size:10px;letter-spacing:2px;margin-top:5px">SINDANE ASSET SOLUTIONS · TRACK. PREVENT. PERFORM.</div></div><div style="padding:28px"><div style="font-size:11px;font-weight:800;color:${severity==='CRITICAL'?'#b91c1c':'#0b7b4b'}">${esc(severity)}</div><h2>${esc(title)}</h2><p style="color:#66747d">${esc(company)}</p><table style="width:100%;border-collapse:collapse;font-size:13px">${rows}</table><p style="margin:25px 0 8px"><a href="${ORIGIN}/contractor-login" style="background:#11975c;color:#fff;text-decoration:none;border-radius:8px;padding:12px 18px;font-weight:800">${esc(action)}</a></p><p style="font-size:11px;color:#7a8780">This message was generated automatically by TMM Asset Health.</p></div></div></body></html>`;
}
async function deliver(env:Env,cid:number,kind:AlertKind,key:string,subject:string,html:string){
  await ensureSchema(env);
  const exists=await first(env,"SELECT id FROM operational_alert_audit_v1 WHERE alert_key=? LIMIT 1",[key]);if(exists)return false;
  const to=await recipients(env,cid,kind);if(!to.length)return false;
  let status="failed",providerIds:string[]=[];let error="";
  if(!env.RESEND_API_KEY){error="RESEND_API_KEY is not configured";}else{
    const from=txt(env.NOTIFICATION_FROM_EMAIL||"TMM Asset Health <notifications@sindaneassetsolutions.co.za>",250);
    try{
      const res=await fetch("https://api.resend.com/emails",{method:"POST",headers:{authorization:`Bearer ${env.RESEND_API_KEY}`,"content-type":"application/json"},body:JSON.stringify({from,to,subject,html,reply_to:"admin@sindaneassetsolutions.co.za"})});
      const data=await res.json().catch(()=>({})) as Row;
      if(res.ok){status="sent";if(data.id)providerIds=[String(data.id)];}else error=String(data.message||`Email provider returned ${res.status}`);
    }catch(e){error=e instanceof Error?e.message:String(e);}
  }
  await env.DB.prepare("INSERT OR IGNORE INTO operational_alert_audit_v1(company_id,alert_key,alert_kind,subject,recipients,status,provider_ids,error,created_at) VALUES(?,?,?,?,?,?,?,?,?)").bind(cid,key,kind,subject,to.join(","),status,providerIds.join(","),error,new Date().toISOString()).run();
  return status==="sent";
}

async function scanCompany(env:Env,cid:number){
  if(!cid)return;
  const company=await companyName(env,cid);const today=zaDate();
  const events=await all(env,"SELECT id,fleet_number AS fleet,severity,system_name AS system,component,description,opened_at AS openedAt,downtime_hours AS downtime,status FROM events WHERE company_id=? AND lower(status)<>'closed' ORDER BY id DESC LIMIT 300",[cid]);
  for(const e of events){
    const sev=lower(e.severity);if(!["critical","high"].includes(sev))continue;
    const kind:AlertKind=sev==="critical"?"critical":"breakdown";
    const subject=`${sev==='critical'?'CRITICAL':'HIGH'} TMM ALERT · ${txt(e.fleet,80)} · ${company}`;
    await deliver(env,cid,kind,`event:${cid}:${e.id}:${sev}`,subject,emailHtml(company,`${sev==='critical'?'Critical':'High-priority'} machine condition`,sev==='critical'?"CRITICAL":"HIGH",[["Machine",e.fleet],["System",e.system],["Component",e.component],["Fault / condition",e.description],["Opened",e.openedAt],["Downtime (h)",num(e.downtime).toFixed(2)],["Status",e.status]]));
  }
  const machines=await all(env,"SELECT id,fleet_number AS fleet,category,site,status,operating_hours AS hours,next_service_hours AS nextService FROM machines WHERE company_id=? AND next_service_hours IS NOT NULL",[cid]);
  for(const m of machines){const remaining=num(m.nextService)-num(m.hours);if(remaining>30)continue;const state=remaining<=0?"OVERDUE":"DUE SOON";const bucket=remaining<=0?`overdue:${today}`:"warning";await deliver(env,cid,"service_due",`service:${cid}:${m.id}:${bucket}`,`${state} SERVICE · ${txt(m.fleet,80)} · ${company}`,emailHtml(company,`Maintenance service ${state.toLowerCase()}`,remaining<=0?"CRITICAL":"SERVICE ALERT",[["Machine",m.fleet],["Type",m.category],["Site",m.site],["Hour meter",num(m.hours).toFixed(1)],["Service due at",num(m.nextService).toFixed(1)],["Hours remaining",remaining.toFixed(1)],["Machine status",m.status]]));}
  const pos=await all(env,"SELECT id,order_number AS orderNumber,supplier,description,expected_delivery AS expectedDelivery,actual_delivery AS actualDelivery,order_status AS orderStatus,responsible_person AS responsiblePerson,reminder_email AS reminderEmail,fleet_number AS fleet FROM purchase_orders WHERE company_id=? AND reminder_email=1 AND expected_delivery IS NOT NULL AND trim(expected_delivery)<>''",[cid]);
  for(const p of pos){if(txt(p.actualDelivery))continue;const state=lower(p.orderStatus);if(["delivered","received","cancelled","closed"].includes(state))continue;const d=dayDiff(txt(p.expectedDelivery,40));if(d>3)continue;const label=d<0?"OVERDUE":d===0?"DUE TODAY":`DUE IN ${d} DAY${d===1?'':'S'}`;const bucket=d<0?`overdue:${today}`:d===0?"due-today":"three-day-window";await deliver(env,cid,"po",`po:${cid}:${p.id}:${bucket}`,`PO DELIVERY ${label} · ${txt(p.orderNumber,80)} · ${company}`,emailHtml(company,`Purchase order delivery ${label.toLowerCase()}`,d<0?"CRITICAL":"PO / PARTS ALERT",[["PO",p.orderNumber],["Supplier",p.supplier],["Description",p.description],["Machine",p.fleet||"—"],["Expected delivery",p.expectedDelivery],["Responsible person",p.responsiblePerson||"—"],["Order status",p.orderStatus]]));}
  const zaHour=zaNow().getUTCHours();if(zaHour>=18){const report=await first(env,"SELECT id FROM daily_reports_v3 WHERE company_id=? AND report_date=? LIMIT 1",[cid,today]);if(!report)await deliver(env,cid,"missing_report",`missing-report:${cid}:${today}`,`MISSING DAILY REPORT · ${company} · ${today}`,emailHtml(company,"Daily TMM report has not been submitted","REPORT ALERT",[["Report date",today],["Cut-off","18:00 SAST"],["Status","No daily report found"]],"Open Daily Reports"));}
  const repeats=await all(env,"SELECT fleet_number AS fleet,system_name AS system,component,COUNT(*) AS failures,MAX(id) AS latestId FROM events WHERE company_id=? AND datetime(created_at)>=datetime('now','-30 days') GROUP BY fleet_number,system_name,component HAVING COUNT(*)>=3 ORDER BY failures DESC LIMIT 50",[cid]);
  for(const r of repeats){await deliver(env,cid,"repeat_failure",`repeat:${cid}:${txt(r.fleet,80)}:${txt(r.system,80)}:${txt(r.component,80)}:${today}`,`REPEAT FAILURE · ${txt(r.fleet,80)} · ${company}`,emailHtml(company,"Repeated equipment failure detected","CRITICAL",[["Machine",r.fleet],["System",r.system],["Component",r.component],["Failures in last 30 days",r.failures],["Action","Engineering review / root-cause investigation recommended"]]));}
}
async function scanAll(env:Env){const companies=await all(env,"SELECT id FROM companies WHERE lower(licence_status) IN ('active','trial')");for(const c of companies)await scanCompany(env,num(c.id));}
function shouldInstantScan(path:string){return path==="/company-admin/daily/manual"||path==="/company-admin/daily/import"||path.startsWith("/company-admin/fleet/")||path==="/role/action"||path==="/api/orders"||path.startsWith("/api/orders/");}

export default {
  async fetch(req:Request,env:Env,ctx:ExecutionContext):Promise<Response>{
    const path=new URL(req.url).pathname;const cid=req.method==="POST"&&shouldInstantScan(path)?await companyFromRequest(req,env):0;
    const res=await currentApp.fetch(req,env as never,ctx);
    if(cid&&res.status<400)ctx.waitUntil(scanCompany(env,cid).catch(e=>console.error("operational alert scan failed",e)));
    return res;
  },
  async scheduled(_controller:ScheduledController,env:Env,ctx:ExecutionContext){ctx.waitUntil(scanAll(env).catch(e=>console.error("scheduled operational alert scan failed",e)));}
};
