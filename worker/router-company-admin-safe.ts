import { canViewCompanyPage, filterCompanyForms, isCompanyAdmin } from "./company-navigation-access";
import classicApp from "./router-company-admin-demo-ui-v2";
import { handleCompanyAdminV3 } from "./company-admin-v3";
import { navyCompanyTheme } from "./navy-company-theme";

interface ExecutionContext { waitUntil(promise: Promise<unknown>): void; passThroughOnException(): void; }
interface ScheduledController { scheduledTime:number; cron:string; noRetry():void; }
interface Env { DB:D1Database; [key:string]:unknown; }
type Row=Record<string,unknown>;

const SAFE_V3_VIEWS = new Set(["fleet","daily","users","alerts","approvals","reports-admin","documents","setup","settings"]);
const enc=new TextEncoder();
const SERVICE_INTERVAL_HOURS=250;

const fullNav = `<nav class="tmm-six-nav">
<a data-nav="dashboard" href="/contractor"><span>⌂</span>Overview</a>
<details><summary><span>▣</span>Fleet &amp; Operations</summary><div class="tmm-subnav">
<a data-nav="machine-monitoring" href="/contractor?view=machine-monitoring">Machine Monitoring</a>
<a data-nav="fleet" href="/contractor?view=fleet">Fleet</a>
<a data-nav="daily" href="/contractor?view=daily">Daily Reports</a>
<a data-nav="production" href="/contractor?view=production">Production</a>
<a data-nav="previous" href="/contractor?view=previous">Previous Month</a>
<a data-nav="machine-history" href="/contractor?view=machine-history">Machine History</a>
</div></details>
<details><summary><span>⚙</span>Maintenance</summary><div class="tmm-subnav">
<a data-nav="maintenance" href="/contractor?view=maintenance">Maintenance Dashboard</a>
<a data-nav="breakdowns" href="/contractor?view=breakdowns">Breakdowns</a>
<a data-nav="alerts" href="/contractor?view=alerts">Alerts</a>
</div></details>
<details><summary><span>◈</span>Engineering Intelligence</summary><div class="tmm-subnav">
<a data-nav="recommendations" href="/contractor?view=recommendations">Recommendations</a>
<a data-nav="data-quality" href="/contractor?view=data-quality">Data Quality</a>
<a data-nav="management-presentation" href="/contractor?view=management-presentation">Management Presentation</a>
</div></details>
<details><summary><span>▤</span>Reports</summary><div class="tmm-subnav">
<a data-nav="reports-live" href="/contractor?view=reports-live">Reports Dashboard</a>
<a data-nav="reports-admin" href="/contractor?view=reports-admin">Reports Centre</a>
<a data-nav="documents" href="/contractor?view=documents">Documents</a>
</div></details>
<details><summary><span>☷</span>Administration</summary><div class="tmm-subnav">
<a data-nav="users" href="/contractor?view=users">Users &amp; Roles</a>
<a data-nav="approvals" href="/contractor?view=approvals">Approvals</a>
<a data-nav="setup" href="/contractor?view=setup">Company Setup</a>
<a data-nav="settings" href="/contractor?view=settings">Settings</a>
<a data-nav="licence" href="/company-licence">Licence</a>
</div></details>
</nav>`;

const lightContractorRefresh = `<style id="tmm-light-contractor-refresh">
/* Presentation-only refresh of the existing contractor application. */
.tmm-six-nav{display:grid;gap:7px}.tmm-six-nav>details{margin:0}.tmm-six-nav>details>summary{display:flex;align-items:center;gap:12px;cursor:pointer;list-style:none;padding:12px 14px;border-radius:10px;font-weight:700;color:#43566e}.tmm-six-nav>details>summary::-webkit-details-marker{display:none}.tmm-six-nav>details>summary>span{display:inline-block;width:23px;text-align:center;font-size:19px}.tmm-six-nav>details>summary:hover,.tmm-six-nav>details[open]>summary{background:#e5f2fd;color:#075b98}.tmm-six-nav .tmm-subnav{display:grid;gap:3px;margin:3px 0 10px 35px;border-left:2px solid #e1eaf3;padding-left:9px}.tmm-six-nav .tmm-subnav a{font-size:12px!important;padding:8px 10px!important}.tmm-six-nav> a{font-weight:700}
/* Correct legacy sidebar positioning and make the six groups the primary navigation. */
@media(min-width:821px){
.app{display:grid!important;grid-template-columns:270px minmax(0,1fr)!important;align-items:stretch!important}
.side.full-admin-side{position:sticky!important;top:0!important;left:auto!important;bottom:auto!important;width:270px!important;max-width:270px!important;min-width:270px!important;height:100vh!important;box-sizing:border-box!important;z-index:10!important}
.main{grid-column:2!important;width:auto!important;min-width:0!important;margin:0!important;padding:0!important}
}
.side.full-admin-side nav.tmm-six-nav{display:flex!important;flex-direction:column!important;align-items:stretch!important;gap:5px!important;overflow-x:hidden!important}
.side.full-admin-side nav.tmm-six-nav>details{display:block!important;width:100%!important;flex:0 0 auto!important}
.side.full-admin-side nav.tmm-six-nav>details>summary{font-size:13px!important;line-height:1.3!important;min-height:44px!important;box-sizing:border-box!important;padding:11px 10px!important;gap:9px!important}
.side.full-admin-side nav.tmm-six-nav>details>summary>span{flex:0 0 22px!important;font-size:18px!important}
.side.full-admin-side nav.tmm-six-nav>a{flex:0 0 auto!important;display:flex!important;align-items:center!important;gap:9px!important;min-height:44px!important;font-size:13px!important}
.side.full-admin-side nav.tmm-six-nav>a>span{flex:0 0 22px!important;text-align:center!important;font-size:18px!important}
.side.full-admin-side nav.tmm-six-nav .tmm-subnav{margin:2px 0 8px 20px!important;padding-left:9px!important;display:flex!important;flex-direction:column!important}
.side.full-admin-side nav.tmm-six-nav .tmm-subnav a{min-height:0!important;font-size:12px!important;padding:8px 10px!important;line-height:1.4!important}
.side.full-admin-side .compact-brand b{color:#183653!important}
.side.full-admin-side .compact-brand small{color:#65778e!important}
@media(max-width:820px){
.side.full-admin-side{position:relative!important;top:auto!important;bottom:auto!important;left:auto!important;width:100%!important;max-width:none!important;height:auto!important;min-height:0!important}
.side.full-admin-side nav.tmm-six-nav{display:flex!important;flex-direction:column!important;max-height:50vh!important;overflow-y:auto!important}
.main{width:100%!important;margin:0!important}
}
body{background:#f5f8fc!important;color:#18283b!important;font-family:Inter,system-ui,-apple-system,"Segoe UI",Arial,sans-serif!important}
.main{min-width:0}.content{max-width:1560px;margin:0 auto;padding:28px clamp(16px,3vw,42px)!important}
.topbar{background:#fff!important;border-bottom:1px solid #e4eaf2!important;box-shadow:0 1px 8px #172b4d08}
.side.full-admin-side{background:#fff!important;color:#23344c!important;border-right:1px solid #e1e9f2!important;box-shadow:3px 0 16px #1e385008}
.side.full-admin-side nav a{color:#43566e!important;border-radius:10px!important;transition:background .15s,color .15s}
.side.full-admin-side nav a:hover{background:#edf5fc!important;color:#145b91!important}
.side.full-admin-side nav a.active{background:#e5f2fd!important;color:#075b98!important;font-weight:750!important;box-shadow:inset 3px 0 #0878bf}
.side.full-admin-side .brand{border-color:#e4ebf2!important}
.side.full-admin-side .companybox{background:#f1f7fc!important;color:#23344c!important;border:1px solid #dfebf5!important;border-radius:12px!important}
.pagehead{margin-bottom:24px!important;align-items:center}.pagehead h1{font-size:clamp(24px,2.2vw,34px)!important;letter-spacing:-.035em;color:#142d48!important}.pagehead p{color:#65778e!important}
.kpis{gap:14px!important}.kpi,.panel,.card,.metric{background:#fff!important;border:1px solid #e1e9f1!important;border-radius:15px!important;box-shadow:0 4px 20px #223f5c09!important}
.kpi{padding:18px!important;min-height:112px!important}.kpi b{color:#172f4b!important;font-size:clamp(22px,2vw,30px)!important}.kpi small{color:#61748b!important;font-weight:650}
.panel{padding:20px!important}.panel h2,.panel h3{color:#183653!important;letter-spacing:-.015em}
a.action,.action,.btn{border-radius:10px!important}a.action{background:#f5f9fd!important;border:1px solid #e3edf5!important;color:#194b72!important}
table{border-collapse:collapse}th{background:#f3f7fb!important;color:#50647d!important}td{border-color:#edf1f6!important}
@media(max-width:1100px){.kpis{grid-template-columns:repeat(3,minmax(0,1fr))!important}.dashboard-grid{grid-template-columns:minmax(0,1fr)!important}}
@media(max-width:700px){.kpis{grid-template-columns:repeat(2,minmax(0,1fr))!important}.content{padding:16px!important}.pagehead{align-items:flex-start;gap:12px;flex-wrap:wrap}.kpi{min-height:100px!important}}
@media print{.side.full-admin-side,.topbar{display:none!important}.content{padding:0!important}.main{width:100%!important}}
</style>`;
const viewLabels:Record<string,string>={
 dashboard:"Company Admin Dashboard","machine-monitoring":"Machine Monitoring","machine-history":"Machine History","data-quality":"Data Quality","management-presentation":"Management Presentation",breakdowns:"Breakdowns Dashboard",maintenance:"Maintenance Dashboard",
 production:"Production Dashboard","reports-live":"Reports Dashboard",fleet:"Fleet Dashboard",
 daily:"Daily Reports Dashboard",users:"Users & Roles Dashboard",alerts:"Alerts Dashboard",
 approvals:"Approvals Dashboard","reports-admin":"Reports Centre",previous:"Previous Month Dashboard",
 documents:"Documents Dashboard",setup:"Company Setup",licence:"Licence Dashboard",telematics:"Telematics Dashboard","oem-connections":"OEM Connections",
 settings:"Settings Dashboard",install:"Install TMM Asset Health"
};

function esc(v:unknown){return String(v??"").replace(/[&<>"']/g,c=>({"&":"&amp;","<":"&lt;",">":"&gt;",'"':"&quot;","'":"&#39;"}[c]||c));}
function num(v:unknown,f=0){const n=Number(v);return Number.isFinite(n)?n:f;}
function getCookie(req:Request){for(const p of (req.headers.get("cookie")||"").split(";")){const i=p.indexOf("=");if(i>-1&&p.slice(0,i).trim()==="sas_contractor_v2")return p.slice(i+1).trim()}return "";}
async function sha256(v:string){return Array.from(new Uint8Array(await crypto.subtle.digest("SHA-256",enc.encode(v))),b=>b.toString(16).padStart(2,"0")).join("");}
async function account(req:Request,env:Env){const token=getCookie(req);if(!token)return null;try{return await env.DB.prepare(`SELECT c.id companyId,a.full_name fullName,a.email,COALESCE(NULLIF(s.active_role,''),a.role) role,c.name companyName,c.licence_status licenceStatus FROM contractor_sessions s JOIN contractor_accounts a ON a.id=s.account_id AND a.company_id=s.company_id JOIN companies c ON c.id=s.company_id WHERE s.token_hash=? LIMIT 1`).bind(await sha256(token)).first<Row>()}catch{return null}}
function nextServiceFromHm(hm:number){return (Math.floor(Math.max(0,hm)/SERVICE_INTERVAL_HOURS)+1)*SERVICE_INTERVAL_HOURS;}
function serviceState(remaining:number){
 if(remaining<0)return {label:"OVERDUE",dot:"🔴",bg:"#fff1f2",fg:"#b42318"};
 if(remaining<=30)return {label:"Critical",dot:"🔴",bg:"#fff1f2",fg:"#b42318"};
 if(remaining<=100)return {label:"Due soon",dot:"🟠",bg:"#fff7ed",fg:"#b54708"};
 return {label:"OK",dot:"🟢",bg:"#ecfdf3",fg:"#027a48"};
}

function fullSidebar(view:string,a:Row|null){
 const active=view==="reports"?"reports-live":view;
 const role=String(a?.role||"");
 const permittedNav=fullNav.replace(/<a data-nav="([^"]+)"[^>]*>[\s\S]*?<\/a>/g,(link, key)=>canViewCompanyPage(role,key)?link:"");
 const activeGroups:Record<string,string>={"machine-monitoring":"fleet",fleet:"fleet",daily:"fleet",production:"fleet",previous:"fleet","machine-history":"fleet",maintenance:"maintenance",breakdowns:"maintenance",alerts:"maintenance",recommendations:"engineering","data-quality":"engineering","management-presentation":"engineering","reports-live":"reports","reports-admin":"reports",documents:"reports",users:"admin",approvals:"admin",setup:"admin",settings:"admin",licence:"admin"};
 const selectedGroup=activeGroups[active]||"";
 const groupKeys=["fleet","maintenance","engineering","reports","admin"];
 let nav=permittedNav.replace(`data-nav="${active}"`,`data-nav="${active}" class="active"`);
 let groupIndex=0;
 nav=nav.replace(/<details>/g,()=>`<details${groupKeys[groupIndex++]===selectedGroup?" open":""}>`);
 const label=active==="dashboard"?(isCompanyAdmin(role)?"Admin Dashboard":"Engineer Dashboard"):active==="recommendations"?"Recommendations":viewLabels[active]||"Company Workspace";
 return `<aside class="side full-admin-side"><div class="brand compact-brand"><img src="/sindane-logo.png" alt="Sindane Asset Solutions"><div><b>TMM Asset Health</b><small>${esc(label)}</small></div></div>${nav}<div class="companybox"><small>${esc(isCompanyAdmin(role)?"COMPANY ADMIN":"COMPANY WORKSPACE")}</small><b>${esc(a?.companyName||"Company Workspace")}</b><span>${esc(a?.licenceStatus||"active")} licence</span></div><div class="userbox full-user"><div><b>${esc(a?.fullName||"Company Admin")}</b><small>${esc(a?.email||"")}</small><span>${esc(a?.role||"company_admin")}</span></div><form method="post" action="/api/contractor/logout"><button type="submit">Sign out</button></form></div></aside>`;
}

const monitoringCategories=[
 ["Machine identification","Model, serial number, equipment ID and location","asset"],
 ["Operating hours","Engine, working and idle hours","hours"],
 ["Machine utilisation","Working, idle and available time","utilisation"],
 ["Fuel consumption","Fuel level, consumption and burn rate","fuel"],
 ["Engine performance","RPM, coolant temperature, oil pressure and sensors","engine"],
 ["Fault codes","Diagnostic and event codes, severity and timestamps","faults"],
 ["Machine health","Warnings and abnormal operating conditions","health"],
 ["Maintenance","Service intervals and remaining hours","maintenance"],
 ["Machine location","GPS, movement history and geofencing","location"],
 ["Production","Payload, cycles and material moved","production"],
 ["Historical trends","Operating, fuel and failure history","history"],
 ["Reports","Automatically generated daily, weekly and monthly summaries","reports"]
] as const;

async function machineMonitoringPage(req:Request,env:Env):Promise<Response>{
 const a=await account(req,env);
 if(!a)return Response.redirect(new URL("/contractor-login",req.url).toString(),303);
 const companyId=num(a.companyId);
 let machines:Row[]=[];
 let machineError="";
 try{
   const rows=await env.DB.prepare("SELECT fleet_number,operating_hours,next_service_hours FROM machines WHERE company_id=? ORDER BY fleet_number LIMIT 100").bind(companyId).all<Row>();
   machines=rows.results||[];
 }catch{machineError="Machine register is not yet available in this staging database.";}
 const url=new URL(req.url);
 const selected=url.searchParams.get("machine")||"";
 const chosen=machines.find(m=>String(m.fleet_number)===selected)||machines[0];
 const selectedFleet=String(chosen?.fleet_number||"");
 const hourMeter=chosen?.operating_hours==null?null:num(chosen.operating_hours);
 const nextService=chosen?.next_service_hours==null?null:num(chosen.next_service_hours);
 const value=(v:unknown,unit="")=>v==null?"Not available":esc(v)+unit;
 const cards=monitoringCategories.map(([title,desc,key],i)=>{
   let detail="";
   if(key==="asset")detail=selectedFleet?"Fleet ID: "+esc(selectedFleet):"No machine selected";
   else if(key==="hours")detail="Total hour meter: "+value(hourMeter," h")+"; daily working and idle hours: awaiting OEM feed";
   else if(key==="maintenance")detail="Next service meter: "+value(nextService," h")+(nextService!=null&&hourMeter!=null?"; remaining: "+(nextService-hourMeter).toFixed(1)+" h":"");
   else detail="Awaiting authorised OEM data connection";
   return `<article class="monitor-card"><div class="monitor-card-num">${String(i+1).padStart(2,"0")}</div><h2>${esc(title)}</h2><p>${esc(desc)}</p><div class="monitor-detail">${detail}</div></article>`;
 }).join("");
 const options=machines.map(m=>`<option value="${esc(m.fleet_number)}" ${String(m.fleet_number)===selectedFleet?"selected":""}>${esc(m.fleet_number)}</option>`).join("");
 const html=`<!doctype html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>Machine Monitoring | TMM Asset Health</title><style>
*{box-sizing:border-box}body{margin:0;background:#f3f7fb;color:#17304b;font:15px system-ui,-apple-system,Segoe UI,sans-serif}header{background:#fff;border-bottom:1px solid #dde7f1;padding:18px clamp(18px,4vw,55px);display:flex;justify-content:space-between;align-items:center;gap:12px;flex-wrap:wrap}header b{font-size:18px}a{color:#11618f;text-decoration:none;font-weight:650}main{max-width:1370px;margin:0 auto;padding:28px 22px 55px}.eyebrow{color:#197a79;font-size:12px;font-weight:800;letter-spacing:.1em;text-transform:uppercase}h1{font-size:clamp(26px,3vw,39px);margin:8px 0}p{color:#65768b;line-height:1.5}.notice{border:1px solid #d9e7f2;border-radius:12px;background:#eaf3fa;padding:15px 18px;margin:22px 0}.toolbar{display:flex;align-items:center;gap:15px;flex-wrap:wrap;margin:22px 0}.toolbar select{padding:11px 14px;border:1px solid #c9d7e4;border-radius:9px;min-width:210px;background:#fff}.grid{display:grid;grid-template-columns:repeat(3,minmax(0,1fr));gap:15px}.monitor-card{background:#fff;border:1px solid #e0e8f1;border-radius:15px;padding:21px;min-height:205px;box-shadow:0 4px 18px #233e5a08}.monitor-card-num{font-size:12px;color:#168a83;font-weight:800}.monitor-card h2{font-size:18px;margin:10px 0 7px}.monitor-card p{font-size:13px;margin:0 0 15px}.monitor-detail{border-top:1px solid #e9eef4;padding-top:13px;font-size:12px;font-weight:700;color:#37526b}@media(max-width:900px){.grid{grid-template-columns:repeat(2,minmax(0,1fr))}}@media(max-width:590px){.grid{grid-template-columns:1fr}main{padding:20px 15px}header{padding:16px}}
</style></head><body><header><b>TMM Asset Health · ${esc(a.companyName)}</b><a href="/contractor?view=fleet">← Back to Fleet &amp; Operations</a></header><main><div class="eyebrow">Fleet &amp; Operations / Equipment intelligence</div><h1>Machine Monitoring</h1><p>CAT-style equipment monitoring across 12 categories. All data is scoped to your company.</p><div class="notice"><b>OEM connection status: Not configured.</b> Current machine-register readings are shown where available. Live diagnostics, fuel, production and daily operating data require authorised OEM integration; no readings are simulated.</div>${machineError?`<div class="notice">${esc(machineError)}</div>`:""}<form class="toolbar" method="get" action="/contractor"><input type="hidden" name="view" value="machine-monitoring"><label for="machine">Machine</label><select id="machine" name="machine" onchange="this.form.submit()"><option value="">${machines.length?"Choose equipment":"No equipment registered"}</option>${options}</select><noscript><button type="submit">View</button></noscript></form><div class="grid">${cards}</div></main></body></html>`;
 return new Response(html,{headers:{"content-type":"text/html; charset=utf-8","cache-control":"private, no-store","x-content-type-options":"nosniff"}});
}

async function fleetUpgrade(body:string,env:Env,a:Row|null){
 if(!a?.companyId)return body;
 let rows:Row[]=[];
 try{rows=(await env.DB.prepare("SELECT fleet_number fleet,operating_hours hours,next_service_hours nextService FROM machines WHERE company_id=? ORDER BY fleet_number").bind(num(a.companyId)).all<Row>()).results||[]}catch{}
 const tableRows=rows.map(r=>{
   const hm=num(r.hours),configured=r.nextService==null?null:num(r.nextService),next=configured==null?nextServiceFromHm(hm):configured,remaining=next-hm,state=serviceState(remaining);
   return `<tr><td data-label="Machine"><b>${esc(r.fleet)}</b></td><td data-label="Current HM">${hm.toLocaleString("en-ZA",{maximumFractionDigits:1})} h</td><td data-label="Next Service">${next.toLocaleString("en-ZA",{maximumFractionDigits:1})} h</td><td data-label="Remaining"><b>${remaining.toLocaleString("en-ZA",{maximumFractionDigits:1})} h</b></td><td data-label="Service Status"><span style="display:inline-flex;align-items:center;gap:6px;padding:5px 8px;border-radius:999px;background:${state.bg};color:${state.fg};font-weight:800">${state.dot} ${state.label}</span></td></tr>`;
 }).join("");
 const fleetPanel=`<section class="panel"><h2>Machine register</h2><p style="font-size:11px;color:#667085;margin-top:-4px">Service interval: every ${SERVICE_INTERVAL_HOURS} operating hours. Remaining hours are calculated automatically from the current hour meter.</p><div class="service-table-scroll" role="region" aria-label="Machine service status table" tabindex="0"><table class="bigtable service-table"><thead><tr><th>Machine</th><th>Current HM</th><th>Next Service</th><th>Remaining</th><th>Service Status</th></tr></thead><tbody>${tableRows||`<tr><td colspan="5" class="empty">No machines registered yet.</td></tr>`}</tbody></table></div><p class="service-swipe-note">Swipe the table left or right to see all service information.</p></section>`;
 body=body.replace(/<section class="panel"><h2>Machine register<\/h2>[\s\S]*?<\/section>/,fleetPanel);
 body=body.replace(/<label class="field">Hour meter<input name="operatingHours" type="number" min="0" step="0\.1" value="0"><\/label><label class="field">Next service hour<input name="nextServiceHours" type="number" min="0" step="0\.1"><\/label>/,
 `<label class="field">Current hour meter<input id="currentHm250" name="operatingHours" type="number" min="0" step="0.1" value="0" oninput="window.updateNextService250&&window.updateNextService250()"></label><label class="field">Next service hour (automatic every 250 h)<input id="nextService250" name="nextServiceHours" type="number" min="0" step="0.1" readonly></label>`);
 body=body.replace("Recommended columns: Machine ID, Type, Site, Status, Hour Meter, Next Service Hour.","Recommended columns: Machine ID, Type, Site, Status, Hour Meter. Service interval is 250 h; Next Service Hour may also be supplied if you already have an OEM schedule.");
 const script=`<script>window.updateNextService250=function(){var h=parseFloat((document.getElementById('currentHm250')||{}).value||'0');var n=(Math.floor(Math.max(0,h)/250)+1)*250;var x=document.getElementById('nextService250');if(x)x.value=n.toFixed(1)};window.updateNextService250();</script>`;
 body=body.replace("</body>",script+"</body>");
 return body;
}

const shellFix=`<style id="full-admin-shell-fix">
.app{grid-template-columns:255px minmax(0,1fr)!important}.full-admin-side{display:flex!important;flex-direction:column!important;height:100vh!important;min-height:100vh!important;overflow:hidden!important;padding:14px 10px!important}.full-admin-side .compact-brand{display:flex!important;align-items:center!important;gap:12px!important;padding:4px 0 14px!important;border-bottom:1px solid #2c3950!important;flex:0 0 auto!important}.full-admin-side .compact-brand img{width:54px!important;height:54px!important;object-fit:contain!important;background:#fff!important;border-radius:8px!important;padding:3px!important}.full-admin-side .compact-brand b,.full-admin-side .compact-brand small{display:block!important}.full-admin-side .compact-brand b{font-size:15px!important;color:#fff!important;line-height:1.2!important}.full-admin-side .compact-brand small{font-size:10px!important;color:#9eacc0!important;margin-top:3px!important}.full-admin-side nav{flex:1 1 auto!important;min-height:0!important;overflow-y:auto!important;padding:12px 0 10px!important;display:grid!important;gap:3px!important}.full-admin-side nav a{padding:9px 10px!important;font-size:12px!important;border-radius:8px!important;position:relative!important;z-index:2!important;pointer-events:auto!important;touch-action:manipulation!important;-webkit-tap-highlight-color:rgba(255,255,255,.12)!important}.full-admin-side nav a.active,.full-admin-side nav a:hover{background:#243a5c!important}.full-admin-side .companybox{position:static!important;left:auto!important;bottom:auto!important;width:auto!important;flex:0 0 auto!important;margin-top:7px!important;background:#13233b!important;border:1px solid #2a3b55!important;border-radius:10px!important;padding:9px!important}.full-admin-side .companybox small,.full-admin-side .companybox b,.full-admin-side .companybox span{display:block!important}.full-admin-side .companybox small{font-size:9px!important;color:#9eacc0!important}.full-admin-side .companybox b{font-size:11px!important;margin:3px 0!important}.full-admin-side .companybox span{font-size:9px!important;color:#b9c7d8!important}.full-admin-side .userbox{position:static!important;left:auto!important;right:auto!important;bottom:auto!important;width:auto!important;flex:0 0 auto!important;margin-top:6px!important;padding:9px!important;background:#0d1b31!important;border:1px solid #2a3b55!important;border-radius:10px!important;display:block!important}.full-admin-side .userbox b,.full-admin-side .userbox small,.full-admin-side .userbox span{display:block!important}.full-admin-side .userbox b{font-size:11px!important}.full-admin-side .userbox small{font-size:9px!important;color:#9eacc0!important;margin:3px 0!important;word-break:break-word}.full-admin-side .userbox span{font-size:9px!important;color:#b9c7d8!important;margin-bottom:7px!important}.full-admin-side .userbox form{margin:0!important}.full-admin-side .userbox button{width:100%!important;border:1px solid #40506a!important;background:transparent!important;color:#fff!important;border-radius:7px!important;padding:8px!important;font-size:10px!important;font-weight:800!important;cursor:pointer!important}.topbar{display:none!important}.main{min-width:0!important}.content{padding-top:20px!important}.service-table th,.service-table td{white-space:nowrap!important}.service-swipe-note{display:none;color:#667085!important;font-size:12px!important;margin:10px 0 0!important}@media(max-width:820px){.app{display:block!important;grid-template-columns:minmax(0,1fr)!important;width:100%!important}.full-admin-side{position:relative!important;top:auto!important;width:100%!important;height:auto!important;min-height:0!important;overflow:visible!important;padding:18px!important}.full-admin-side .compact-brand{padding:0 0 18px!important}.full-admin-side .compact-brand img{width:64px!important;height:64px!important}.full-admin-side .compact-brand b{font-size:18px!important}.full-admin-side nav{grid-template-columns:repeat(3,minmax(0,1fr))!important;max-height:none!important;overflow:visible!important;gap:6px!important;padding:16px 0!important}.full-admin-side nav a{min-width:0!important;min-height:64px!important;padding:10px 8px!important;white-space:normal!important;line-height:1.2!important}.full-admin-side nav a span{flex:0 0 22px!important}.full-admin-side .companybox,.full-admin-side .userbox{display:block!important;width:100%!important;padding:13px!important}.main{width:100%!important;overflow:hidden!important}.content{width:100%!important;padding:18px!important}.pagehead{max-width:100%!important}.hero,.panel,.metric{max-width:100%!important;overflow:hidden!important}.service-table-scroll{width:100%!important;overflow-x:auto!important;overflow-y:hidden!important;-webkit-overflow-scrolling:touch!important;touch-action:pan-x pan-y!important;border:1px solid #e0e6ee!important;border-radius:10px!important}.service-table{display:table!important;width:720px!important;min-width:720px!important}.service-table thead{display:table-header-group!important}.service-table tbody{display:table-row-group!important}.service-table tr{display:table-row!important}.service-table th,.service-table td{display:table-cell!important;width:auto!important;white-space:nowrap!important;padding:12px!important;text-align:left!important}.service-table td:before{content:none!important}.service-swipe-note{display:block!important}}@media(max-width:430px){.full-admin-side nav{grid-template-columns:repeat(3,minmax(0,1fr))!important}.full-admin-side nav a{font-size:11px!important;gap:6px!important}.full-admin-side nav a span{width:18px!important;flex-basis:18px!important}}
@media(max-width:820px){.main{width:100%!important;max-width:100vw!important;overflow-x:auto!important;overflow-y:visible!important;-webkit-overflow-scrolling:touch!important;touch-action:pan-x pan-y!important}.content{width:760px!important;min-width:760px!important;max-width:none!important;padding:18px!important}.pagehead,.hero,.panel,.metric{max-width:none!important}.panel{overflow:visible!important}}
</style>`;

function addHourMeterPreview(body:string){
 const fields='<div class="twocol"><label class="field">Hour meter start<input name="hourMeterStart" type="number" min="0" step="0.01"></label><label class="field">Hour meter end<input name="hourMeterEnd" type="number" min="0" step="0.01"></label></div>';
 const upgraded='<div id="hourMeterCaptureFields" hidden><div class="twocol"><label class="field">Hour meter start<input id="dailyHourMeterStart" name="hourMeterStart" type="number" min="0" step="0.01" inputmode="decimal"></label><label class="field">Hour meter end<input id="dailyHourMeterEnd" name="hourMeterEnd" type="number" min="0" step="0.01" inputmode="decimal"></label></div><label class="field">Hours worked (automatic)<input id="dailyMeterHoursWorked" type="text" value="" placeholder="End − start" readonly aria-live="polite"></label></div>';
 const timeFields='<label class="field">Time value<input name="timeValue" type="number" min="0" step="0.001" value="0"></label><div class="units"><label><input type="radio" name="timeUnit" value="hours" checked> Hours</label><label><input type="radio" name="timeUnit" value="minutes"> Minutes</label><label><input type="radio" name="timeUnit" value="seconds"> Seconds</label></div>';
 const timeUpgraded='<div id="timeCaptureFields"><div class="twocol"><label class="field">Time start<input id="dailyTimeStart" type="time"></label><label class="field">Time end<input id="dailyTimeEnd" type="time"></label></div><input id="dailyTimeValue" name="timeValue" type="hidden" value="0"><input name="timeUnit" type="hidden" value="hours"><label class="field">Hours worked (automatic)<input id="dailyTimeHoursWorked" type="text" value="" placeholder="End − start" readonly aria-live="polite"></label></div>';
 if(!body.includes(fields))return body;
 body=body.replace(fields,upgraded);
 body=body.replace(timeFields,timeUpgraded);
 const script=`<script id="capture-basis-fields">(()=>{const radios=[...document.querySelectorAll('input[name="captureBasis"]')],timeGroup=document.getElementById('timeCaptureFields'),meterGroup=document.getElementById('hourMeterCaptureFields'),timeStart=document.getElementById('dailyTimeStart'),timeEnd=document.getElementById('dailyTimeEnd'),timeValue=document.getElementById('dailyTimeValue'),timeWorked=document.getElementById('dailyTimeHoursWorked'),meterStart=document.getElementById('dailyHourMeterStart'),meterEnd=document.getElementById('dailyHourMeterEnd'),meterWorked=document.getElementById('dailyMeterHoursWorked');if(!timeGroup||!meterGroup)return;const plain=v=>v.toFixed(2)+' hours',minutes=v=>{const p=v.split(':').map(Number);return p.length===2?p[0]*60+p[1]:NaN},updateTime=()=>{if(!timeStart.value||!timeEnd.value){timeValue.value='0';timeWorked.value='';return}const a=minutes(timeStart.value),b=minutes(timeEnd.value),hours=((b-a+1440)%1440)/60;timeValue.value=hours.toFixed(3);timeWorked.value=plain(hours)},updateMeter=()=>{const a=Number(meterStart.value),b=Number(meterEnd.value);if(meterStart.value===''||meterEnd.value===''){meterWorked.value='';return}meterWorked.value=b>=a?plain(b-a):'End must be greater than start'},updateMode=()=>{const meter=radios.some(r=>r.checked&&r.value==='hour_meter');timeGroup.hidden=meter;meterGroup.hidden=!meter;timeStart.required=timeEnd.required=!meter;meterStart.required=meterEnd.required=meter;if(meter)timeValue.value='0';else updateTime()};radios.forEach(r=>r.addEventListener('change',updateMode));timeStart.addEventListener('input',updateTime);timeEnd.addEventListener('input',updateTime);meterStart.addEventListener('input',updateMeter);meterEnd.addEventListener('input',updateMeter);updateMode()})()</script>`;
 return body.replace('</body>',script+'</body>');
}

async function polish(req:Request,res:Response,env:Env){
  if(req.method!=="GET")return res;
  const ct=res.headers.get("content-type")||"";
  if(!ct.includes("text/html"))return res;
  let body=await res.text();
  const url=new URL(req.url),view=url.searchParams.get("view")||"dashboard";
  let a=await account(req,env);
  body=body.replace(/<aside class="side">[\s\S]*?<\/aside>/,fullSidebar(view,a));
  body=body.replace(/<a[^>]*href="\/contractor\?view=subscription-request"[^>]*>[\s\S]*?<\/a>/g,"");
  if(view==="fleet"&&isCompanyAdmin(String(a?.role||"")))body=await fleetUpgrade(body,env,a);
  body=filterCompanyForms(body,String(a?.role||""));
  if(a?.role==="engineer"&&["fleet","daily","documents","reports-admin"].includes(view))body=body.replace(/(<h1[^>]*>[\s\S]*?<\/h1>)/,'$1<p>Engineer access: view records and exports. Use Recommendations to add findings or request corrections from the Admin.</p>');
  if(view==="daily"||view==="dashboard")body=addHourMeterPreview(body);
  if(!body.includes('id="tmm-navy-company-theme"')&&body.includes("</head>"))body=body.replace("</head>",navyCompanyTheme+shellFix+lightContractorRefresh+"</head>");
  else if(!body.includes('id="full-admin-shell-fix"')&&body.includes("</head>"))body=body.replace("</head>",shellFix+lightContractorRefresh+"</head>");
  const h=new Headers(res.headers);h.delete("content-length");h.set("cache-control","private, no-store");
  return new Response(body,{status:res.status,statusText:res.statusText,headers:h});
}

export default {
  async fetch(req:Request,env:Env,ctx:ExecutionContext):Promise<Response>{
    const url=new URL(req.url);
    if(url.pathname==="/contractor"&&req.method==="GET"){
      const view=url.searchParams.get("view")||"dashboard";
      if(view==="machine-monitoring")return machineMonitoringPage(req,env);
      if(view==="demo"){url.searchParams.set("view","management-presentation");url.searchParams.delete("download");return new Response(null,{status:303,headers:{location:url.pathname+url.search,"cache-control":"private, no-store"}});}
      if(view==="previous"){
        const a=await account(req,env);
        if(a&&canViewCompanyPage(String(a.role),view)){
          const now=new Date(),month=new Date(Date.UTC(now.getUTCFullYear(),now.getUTCMonth()-1,1)).toISOString().slice(0,7);
          return new Response(null,{status:303,headers:{location:`/contractor-reports?type=monthly&month=${month}`,"cache-control":"private, no-store"}});
        }
      }
      if(SAFE_V3_VIEWS.has(view)){
        const direct=await handleCompanyAdminV3(req,env as never);
        if(direct)return polish(req,direct,env);
      }
    }
    const res=await classicApp.fetch(req,env as never,ctx as never);
    return polish(req,res,env);
  },
  async scheduled(c:ScheduledController,env:Env,ctx:ExecutionContext){
    const app=classicApp as unknown as {scheduled?:(c:ScheduledController,e:Env,x:ExecutionContext)=>Promise<void>|void};
    if(app.scheduled)return app.scheduled(c,env,ctx);
  }
};
