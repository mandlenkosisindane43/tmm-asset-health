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

const fullNav = `<nav>
<a data-nav="dashboard" href="/contractor"><span>⌂</span>Dashboard</a>
<a data-nav="fleet" href="/contractor?view=fleet"><span>▣</span>Fleet</a>
<a data-nav="daily" href="/contractor?view=daily"><span>⇧</span>Daily Reports</a>
<a data-nav="previous" href="/trial-demo"><span>◈</span>Previous Month</a>
<a data-nav="breakdowns" href="/contractor?view=breakdowns"><span>⚙</span>Breakdowns</a>
<a data-nav="maintenance" href="/contractor?view=maintenance"><span>▦</span>Maintenance</a>
<a data-nav="production" href="/contractor?view=production"><span>▥</span>Production</a>
<a data-nav="reports-live" href="/contractor?view=reports-live"><span>▤</span>Reports</a>
<a data-nav="users" href="/contractor?view=users"><span>♙</span>Users & Roles</a>
<a data-nav="alerts" href="/contractor?view=alerts"><span>!</span>Alerts</a>
<a data-nav="approvals" href="/contractor?view=approvals"><span>✓</span>Approvals</a>
<a data-nav="reports-admin" href="/contractor?view=reports-admin"><span>▤</span>Reports Centre</a>
<a data-nav="documents" href="/contractor?view=documents"><span>▱</span>Documents</a>
<a data-nav="setup" href="/contractor?view=setup"><span>⚙</span>Company Setup</a>
<a data-nav="licence" href="/company-licence"><span>▧</span>Licence</a>
<a data-nav="telematics" href="/telemetry"><span>⌁</span>Telematics</a>
<a data-nav="settings" href="/contractor?view=settings"><span>⚙</span>Settings</a>
<a data-nav="install" href="/install-app"><span>⬇</span>Install App</a>
</nav>`;

const viewLabels:Record<string,string>={
 dashboard:"Company Admin Dashboard",breakdowns:"Breakdowns Dashboard",maintenance:"Maintenance Dashboard",
 production:"Production Dashboard","reports-live":"Reports Dashboard",fleet:"Fleet Dashboard",
 daily:"Daily Reports Dashboard",users:"Users & Roles Dashboard",alerts:"Alerts Dashboard",
 approvals:"Approvals Dashboard","reports-admin":"Reports Centre",previous:"Previous Month Dashboard",
 documents:"Documents Dashboard",setup:"Company Setup",licence:"Licence Dashboard",telematics:"Telematics Dashboard",
 settings:"Settings Dashboard",install:"Install TMM Asset Health"
};

function esc(v:unknown){return String(v??"").replace(/[&<>"']/g,c=>({"&":"&amp;","<":"&lt;",">":"&gt;",'"':"&quot;","'":"&#39;"}[c]||c));}
function num(v:unknown,f=0){const n=Number(v);return Number.isFinite(n)?n:f;}
function getCookie(req:Request){for(const p of (req.headers.get("cookie")||"").split(";")){const i=p.indexOf("=");if(i>-1&&p.slice(0,i).trim()==="sas_contractor_v2")return p.slice(i+1).trim()}return "";}
async function sha256(v:string){return Array.from(new Uint8Array(await crypto.subtle.digest("SHA-256",enc.encode(v))),b=>b.toString(16).padStart(2,"0")).join("");}
async function account(req:Request,env:Env){const token=getCookie(req);if(!token)return null;try{return await env.DB.prepare(`SELECT c.id companyId,a.full_name fullName,a.email,a.role,c.name companyName,c.licence_status licenceStatus FROM contractor_sessions s JOIN contractor_accounts a ON a.id=s.account_id AND a.company_id=s.company_id JOIN companies c ON c.id=s.company_id WHERE s.token_hash=? LIMIT 1`).bind(await sha256(token)).first<Row>()}catch{return null}}
function nextServiceFromHm(hm:number){return (Math.floor(Math.max(0,hm)/SERVICE_INTERVAL_HOURS)+1)*SERVICE_INTERVAL_HOURS;}
function serviceState(remaining:number){
 if(remaining<0)return {label:"OVERDUE",dot:"🔴",bg:"#fff1f2",fg:"#b42318"};
 if(remaining<=30)return {label:"Critical",dot:"🔴",bg:"#fff1f2",fg:"#b42318"};
 if(remaining<=100)return {label:"Due soon",dot:"🟠",bg:"#fff7ed",fg:"#b54708"};
 return {label:"OK",dot:"🟢",bg:"#ecfdf3",fg:"#027a48"};
}

function fullSidebar(view:string,a:Row|null){
 const active=view==="reports"?"reports-live":view;
 const nav=fullNav.replace(`data-nav="${active}"`,`data-nav="${active}" class="active"`);
 const label=viewLabels[active]||"Company Admin Dashboard";
 return `<aside class="side full-admin-side"><div class="brand compact-brand"><img src="/sindane-logo.png" alt="Sindane Asset Solutions"><div><b>TMM Asset Health</b><small>${esc(label)}</small></div></div>${nav}<div class="companybox"><small>COMPANY ADMIN</small><b>${esc(a?.companyName||"Company Workspace")}</b><span>${esc(a?.licenceStatus||"active")} licence</span></div><div class="userbox full-user"><div><b>${esc(a?.fullName||"Company Admin")}</b><small>${esc(a?.email||"")}</small><span>${esc(a?.role||"company_admin")}</span></div><form method="post" action="/api/contractor/logout"><button type="submit">Sign out</button></form></div></aside>`;
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
.app{grid-template-columns:255px minmax(0,1fr)!important}.full-admin-side{display:flex!important;flex-direction:column!important;height:100vh!important;min-height:100vh!important;overflow:hidden!important;padding:14px 10px!important}.full-admin-side .compact-brand{display:flex!important;align-items:center!important;gap:12px!important;padding:4px 0 14px!important;border-bottom:1px solid #2c3950!important;flex:0 0 auto!important}.full-admin-side .compact-brand img{width:54px!important;height:54px!important;object-fit:contain!important;background:#fff!important;border-radius:8px!important;padding:3px!important}.full-admin-side .compact-brand b,.full-admin-side .compact-brand small{display:block!important}.full-admin-side .compact-brand b{font-size:15px!important;color:#fff!important;line-height:1.2!important}.full-admin-side .compact-brand small{font-size:10px!important;color:#9eacc0!important;margin-top:3px!important}.full-admin-side nav{flex:1 1 auto!important;min-height:0!important;overflow-y:auto!important;padding:12px 0 10px!important;display:grid!important;gap:3px!important}.full-admin-side nav a{padding:9px 10px!important;font-size:12px!important;border-radius:8px!important}.full-admin-side nav a.active,.full-admin-side nav a:hover{background:#243a5c!important}.full-admin-side .companybox{position:static!important;left:auto!important;bottom:auto!important;width:auto!important;flex:0 0 auto!important;margin-top:7px!important;background:#13233b!important;border:1px solid #2a3b55!important;border-radius:10px!important;padding:9px!important}.full-admin-side .companybox small,.full-admin-side .companybox b,.full-admin-side .companybox span{display:block!important}.full-admin-side .companybox small{font-size:9px!important;color:#9eacc0!important}.full-admin-side .companybox b{font-size:11px!important;margin:3px 0!important}.full-admin-side .companybox span{font-size:9px!important;color:#b9c7d8!important}.full-admin-side .userbox{position:static!important;left:auto!important;right:auto!important;bottom:auto!important;width:auto!important;flex:0 0 auto!important;margin-top:6px!important;padding:9px!important;background:#0d1b31!important;border:1px solid #2a3b55!important;border-radius:10px!important;display:block!important}.full-admin-side .userbox b,.full-admin-side .userbox small,.full-admin-side .userbox span{display:block!important}.full-admin-side .userbox b{font-size:11px!important}.full-admin-side .userbox small{font-size:9px!important;color:#9eacc0!important;margin:3px 0!important;word-break:break-word}.full-admin-side .userbox span{font-size:9px!important;color:#b9c7d8!important;margin-bottom:7px!important}.full-admin-side .userbox form{margin:0!important}.full-admin-side .userbox button{width:100%!important;border:1px solid #40506a!important;background:transparent!important;color:#fff!important;border-radius:7px!important;padding:8px!important;font-size:10px!important;font-weight:800!important;cursor:pointer!important}.topbar{display:none!important}.main{min-width:0!important}.content{padding-top:20px!important}.service-table th,.service-table td{white-space:nowrap!important}.service-swipe-note{display:none;color:#667085!important;font-size:12px!important;margin:10px 0 0!important}@media(max-width:820px){.app{display:block!important;grid-template-columns:minmax(0,1fr)!important;width:100%!important}.full-admin-side{position:relative!important;top:auto!important;width:100%!important;height:auto!important;min-height:0!important;overflow:visible!important;padding:18px!important}.full-admin-side .compact-brand{padding:0 0 18px!important}.full-admin-side .compact-brand img{width:64px!important;height:64px!important}.full-admin-side .compact-brand b{font-size:18px!important}.full-admin-side nav{grid-template-columns:repeat(3,minmax(0,1fr))!important;max-height:none!important;overflow:visible!important;gap:6px!important;padding:16px 0!important}.full-admin-side nav a{min-width:0!important;min-height:64px!important;padding:10px 8px!important;white-space:normal!important;line-height:1.2!important}.full-admin-side nav a span{flex:0 0 22px!important}.full-admin-side .companybox,.full-admin-side .userbox{display:block!important;width:100%!important;padding:13px!important}.main{width:100%!important;overflow:hidden!important}.content{width:100%!important;padding:18px!important}.pagehead{max-width:100%!important}.hero,.panel,.metric{max-width:100%!important;overflow:hidden!important}.service-table-scroll{width:100%!important;overflow-x:auto!important;overflow-y:hidden!important;-webkit-overflow-scrolling:touch!important;touch-action:pan-x pan-y!important;border:1px solid #e0e6ee!important;border-radius:10px!important}.service-table{display:table!important;width:720px!important;min-width:720px!important}.service-table thead{display:table-header-group!important}.service-table tbody{display:table-row-group!important}.service-table tr{display:table-row!important}.service-table th,.service-table td{display:table-cell!important;width:auto!important;white-space:nowrap!important;padding:12px!important;text-align:left!important}.service-table td:before{content:none!important}.service-swipe-note{display:block!important}}@media(max-width:430px){.full-admin-side nav{grid-template-columns:repeat(3,minmax(0,1fr))!important}.full-admin-side nav a{font-size:11px!important;gap:6px!important}.full-admin-side nav a span{width:18px!important;flex-basis:18px!important}}
@media(max-width:820px){.main{width:100%!important;max-width:100vw!important;overflow-x:auto!important;overflow-y:visible!important;-webkit-overflow-scrolling:touch!important;touch-action:pan-x pan-y!important}.content{width:760px!important;min-width:760px!important;max-width:none!important;padding:18px!important}.pagehead,.hero,.panel,.metric{max-width:none!important}.panel{overflow:visible!important}}
</style>`;

function addHourMeterPreview(body:string){
 const fields='<div class="twocol"><label class="field">Hour meter start<input name="hourMeterStart" type="number" min="0" step="0.01"></label><label class="field">Hour meter end<input name="hourMeterEnd" type="number" min="0" step="0.01"></label></div>';
 const upgraded='<div class="twocol"><label class="field">Hour meter start<input id="dailyHourMeterStart" name="hourMeterStart" type="number" min="0" step="0.01" inputmode="decimal"></label><label class="field">Hour meter end<input id="dailyHourMeterEnd" name="hourMeterEnd" type="number" min="0" step="0.01" inputmode="decimal"></label></div><label class="field">Hours worked (automatic)<input id="dailyHoursWorked" type="text" value="" placeholder="End − start" readonly aria-live="polite"></label>';
 if(!body.includes(fields))return body;
 body=body.replace(fields,upgraded);
 const script=`<script id="hour-meter-preview">(()=>{const start=document.getElementById('dailyHourMeterStart'),end=document.getElementById('dailyHourMeterEnd'),worked=document.getElementById('dailyHoursWorked');if(!start||!end||!worked)return;const update=()=>{const a=Number(start.value),b=Number(end.value);if(start.value===''||end.value===''||!Number.isFinite(a)||!Number.isFinite(b)){worked.value='';return}worked.value=b>=a?(b-a).toFixed(2)+' hours':'End must be greater than start'};start.addEventListener('input',update);end.addEventListener('input',update);update()})()</script>`;
 return body.replace('</body>',script+'</body>');
}

async function polish(req:Request,res:Response,env:Env){
  if(req.method!=="GET")return res;
  const ct=res.headers.get("content-type")||"";
  if(!ct.includes("text/html"))return res;
  let body=await res.text();
  const url=new URL(req.url),view=url.searchParams.get("view")||"dashboard";
  const a=await account(req,env);
  body=body.replace(/<aside class="side">[\s\S]*?<\/aside>/,fullSidebar(view,a));
  body=body.replace(/<a[^>]*href="\/contractor\?view=subscription-request"[^>]*>[\s\S]*?<\/a>/g,"");
  if(view==="fleet")body=await fleetUpgrade(body,env,a);
  if(view==="daily"||view==="dashboard")body=addHourMeterPreview(body);
  if(!body.includes('id="tmm-navy-company-theme"')&&body.includes("</head>"))body=body.replace("</head>",navyCompanyTheme+shellFix+"</head>");
  else if(!body.includes('id="full-admin-shell-fix"')&&body.includes("</head>"))body=body.replace("</head>",shellFix+"</head>");
  const h=new Headers(res.headers);h.delete("content-length");h.set("cache-control","private, no-store");
  return new Response(body,{status:res.status,statusText:res.statusText,headers:h});
}

export default {
  async fetch(req:Request,env:Env,ctx:ExecutionContext):Promise<Response>{
    const url=new URL(req.url);
    if(url.pathname==="/contractor"&&req.method==="GET"){
      const view=url.searchParams.get("view")||"dashboard";
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
