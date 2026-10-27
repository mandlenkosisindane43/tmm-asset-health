import { ensureAccountRoles } from "./account-roles";
import app from "./mobile-install-email";
import pwaApp from "./router-pwa";
import loginApp from "./router-login-recovery";

interface ExecutionContext { waitUntil(promise: Promise<unknown>): void; passThroughOnException(): void; }
interface ScheduledController { scheduledTime:number; cron:string; noRetry():void; }
interface Env { DB:D1Database; [key:string]:unknown; }

const PWA_PATHS = new Set([
  "/install-app",
  "/install-owner-app",
  "/app.webmanifest",
  "/owner-app.webmanifest",
  "/app-icon.svg",
  "/owner-app-icon.svg",
  "/pwa-register.js",
  "/sw.js",
  "/app-start",
  "/contractor-login",
  "/api/contractor/login",
]);

export default {
  async fetch(req:Request,env:Env,ctx:ExecutionContext):Promise<Response>{
    const path=new URL(req.url).pathname;
    if (path === "/industrial-preview/api/test-fleet") {
      if(req.method!=="GET")return Response.json({ok:false,error:"Method not allowed"},{status:405});
      try{
        const rows=await env.DB.prepare("SELECT m.fleet_number fleet,m.category,m.site,m.status,m.operating_hours hours,m.next_service_hours nextService FROM machines m JOIN companies c ON c.id=m.company_id WHERE c.licence_key=? ORDER BY m.fleet_number LIMIT 30").bind("TMM-PREVIEW-TEST-ONLY-2026").all<Record<string,unknown>>();
        return Response.json({ok:true,source:"preview_test_company_only",machines:rows.results||[],count:(rows.results||[]).length},{headers:{"Cache-Control":"no-store","X-Content-Type-Options":"nosniff"}});
      }catch(error){
        return Response.json({ok:false,error:"Preview test fleet is not ready. Create the preview-only test machines first."},{status:503,headers:{"Cache-Control":"no-store"}});
      }
    }
    if (path === "/industrial-preview/api/fleet") {
      const denied=(status:number,message:string)=>Response.json({ok:false,error:message},{status,headers:{"Cache-Control":"private, no-store"}});
      if(req.method!=="GET")return denied(405,"Method not allowed");
      const cookie=(req.headers.get("cookie")||"").split(";").map(x=>x.trim()).find(x=>x.startsWith("sas_contractor_v2="));
      const token=cookie?cookie.slice("sas_contractor_v2=".length):"";
      if(!token)return denied(401,"Sign in to your existing TMM company account to view real fleet data");
      const digest=await crypto.subtle.digest("SHA-256",new TextEncoder().encode(token));
      const hash=Array.from(new Uint8Array(digest),b=>b.toString(16).padStart(2,"0")).join("");
      try{
        const session=await env.DB.prepare("SELECT s.company_id companyId,s.expires_at sessionExpires,a.status accountStatus,COALESCE(NULLIF(s.active_role,''),a.role) role,c.licence_status licenceStatus,c.expires_at licenceExpires,c.grace_days graceDays FROM contractor_sessions s JOIN contractor_accounts a ON a.id=s.account_id AND a.company_id=s.company_id JOIN companies c ON c.id=s.company_id WHERE s.token_hash=? LIMIT 1").bind(hash).first<Record<string,unknown>>();
        if(!session||String(session.accountStatus||"").toLowerCase()!=="active"||Date.parse(String(session.sessionExpires||""))<=Date.now())return denied(401,"Company session expired or inactive");
        const role=String(session.role||"").toLowerCase();
        if(!["admin","engineer"].includes(role))return denied(403,"Only Admin and Engineer can access this view");
        const licence=String(session.licenceStatus||"").toLowerCase();
        const until=Date.parse(String(session.licenceExpires||""))+Number(session.graceDays||0)*86400000;
        if(!["active","trial"].includes(licence)||!Number.isFinite(until)||until<Date.now())return denied(403,"Company licence is not active");
        const companyId=Number(session.companyId);
        if(!Number.isSafeInteger(companyId)||companyId<=0)return denied(403,"Invalid company context");
        const rows=await env.DB.prepare("SELECT id,fleet_number fleet,category,site,status,operating_hours hours,next_service_hours nextService FROM machines WHERE company_id=? ORDER BY fleet_number LIMIT 250").bind(companyId).all<Record<string,unknown>>();
        return Response.json({ok:true,source:"existing_tmm_d1",machines:rows.results||[],count:(rows.results||[]).length},{headers:{"Cache-Control":"private, no-store","X-Content-Type-Options":"nosniff"}});
      }catch{return denied(503,"Fleet data temporarily unavailable. No changes were made");}
    }
    if (path === "/industrial-preview" || path === "/industrial-preview/") {
      const html = `<!doctype html>
<html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">
<meta name="robots" content="noindex,nofollow"><title>TMM Asset Health | Industrial Preview</title>
<style>
:root{color-scheme:dark;--bg:#081521;--surface:#102639;--border:#29465b;--muted:#9eb6c8;--gold:#f2b94b;--blue:#52a4f5;--green:#61c99a;--red:#f07472}
*{box-sizing:border-box}body{margin:0;background:var(--bg);color:#edf5fb;font-family:Inter,Segoe UI,Arial,sans-serif;font-size:14px}
.layout{display:grid;grid-template-columns:245px minmax(0,1fr);min-height:100vh}
aside{background:#091c2c;border-right:1px solid var(--border);padding:27px 16px;display:flex;flex-direction:column;gap:35px}
.logo{font-size:20px;font-weight:800}.logo span{color:var(--gold)}.subtitle{color:var(--muted);font-size:10px;letter-spacing:1.8px;margin-top:7px}
nav{display:grid;gap:8px}nav button{width:100%;border:0;border-radius:9px;text-align:left;padding:13px;background:transparent;color:#b8cad8;cursor:pointer;font:inherit}
nav button.active,nav button:hover{background:#26394a;color:#ffcc6e}
.sidebar-note{margin-top:auto;color:var(--muted);font-size:12px;line-height:1.7}
main{padding:27px;min-width:0}.top{display:flex;align-items:center;justify-content:space-between;gap:15px;padding-bottom:20px;border-bottom:1px solid var(--border)}
.top h2{margin:0;font-size:20px}.pill{border:1px solid #95763a;color:#ffd27d;background:#3c2e1c;padding:8px 12px;border-radius:20px;font-size:11px}
.hero{margin:22px 0;padding:28px;border:1px solid #3a5667;border-radius:15px;background:linear-gradient(110deg,#103149 0%,#1b4054 65%,#59452b 100%)}
.hero small{color:#ffd079;letter-spacing:2px}.hero h1{font-size:clamp(25px,3vw,38px);margin:12px 0}.hero p{color:#c4d7e3;margin:0}
.notice{border:1px solid #6f603b;background:#332b1e;color:#f4d69b;padding:12px 15px;border-radius:9px;font-size:12px;margin-bottom:17px}
.kpis{display:grid;grid-template-columns:repeat(4,minmax(0,1fr));gap:14px}.kpi,.panel{border:1px solid var(--border);background:var(--surface);border-radius:12px}
.kpi{padding:19px;border-top:3px solid var(--gold)}.kpi:nth-child(2){border-top-color:var(--blue)}.kpi:nth-child(3){border-top-color:var(--green)}.kpi:nth-child(4){border-top-color:var(--red)}
.kpi small{color:var(--muted)}.kpi strong{display:block;font-size:32px;margin:13px 0 8px}.kpi .foot{color:#b8ccda;font-size:12px}
.grid{display:grid;grid-template-columns:1.55fr 1fr;gap:15px;margin-top:15px}.panel{padding:20px;min-width:0}.panel h3{font-size:16px;margin:0 0 14px}
.panel p{font-size:12px;color:var(--muted);line-height:1.6}.controls{display:flex;justify-content:space-between;align-items:center;gap:8px;flex-wrap:wrap}
select{background:#0b1d2b;border:1px solid #4d7087;color:white;border-radius:7px;padding:8px}.legend{font-size:12px;color:#c1d3df}
.dot{display:inline-block;width:9px;height:9px;border-radius:50%;margin:0 5px 0 12px}.dot:first-child{margin-left:0}.gold{background:var(--gold)}.blue{background:var(--blue)}.green{background:var(--green)}.red{background:var(--red)}
#trend{width:100%;height:auto;display:block;margin-top:13px}.donut{width:175px;height:175px;border-radius:50%;margin:18px auto;background:conic-gradient(var(--green) 0 83.33%,var(--gold) 83.33% 91.67%,var(--red) 91.67%);display:grid;place-items:center}
.donut div{background:var(--surface);width:119px;height:119px;border-radius:50%;display:grid;place-content:center;text-align:center}.donut strong{font-size:35px}.donut small{color:var(--muted)}
.status{display:grid;gap:12px}.status div{display:flex;justify-content:space-between;font-size:13px}.pareto{display:grid;gap:13px;margin-top:20px}.barrow{display:grid;grid-template-columns:110px minmax(0,1fr) 42px;gap:9px;align-items:center;font-size:12px}.track{height:17px;background:#203c50;border-radius:4px;overflow:hidden}.fill{height:100%;background:linear-gradient(90deg,#4a9fea,#f2b94b);border-radius:4px}
.hidden{display:none}.module{min-height:220px}.footer{margin:23px 0;color:var(--muted);font-size:11px}
@media(max-width:1050px){.kpis{grid-template-columns:repeat(2,minmax(0,1fr))}.grid{grid-template-columns:1fr}}
@media(max-width:700px){.layout{display:block}aside{padding:14px;gap:13px}.sidebar-note{display:none}nav{display:flex;overflow-x:auto}nav button{white-space:nowrap}main{padding:15px}.hero{padding:23px}}
@media(max-width:440px){.kpis{grid-template-columns:1fr}.barrow{grid-template-columns:85px minmax(0,1fr) 35px}}

/* Native anchor navigation: functions even if dashboard JavaScript fails. */
#nav a{display:block;width:100%;border:0;border-radius:9px;text-align:left;padding:13px;background:transparent;color:#b8cad8;text-decoration:none;cursor:pointer;font:inherit}
#nav a:hover,#nav a:focus-visible{background:#26394a;color:#ffcc6e;outline-offset:2px}
#nav a[href="#overview"]{background:#26394a;color:#ffcc6e}
body:has(#fleet:target) #nav a[href="#overview"],body:has(#health:target) #nav a[href="#overview"],body:has(#maintenance:target) #nav a[href="#overview"],body:has(#reports:target) #nav a[href="#overview"],body:has(#oem:target) #nav a[href="#overview"]{background:transparent;color:#b8cad8}
body:has(#fleet:target) #nav a[href="#fleet"],body:has(#health:target) #nav a[href="#health"],body:has(#maintenance:target) #nav a[href="#maintenance"],body:has(#reports:target) #nav a[href="#reports"],body:has(#oem:target) #nav a[href="#oem"]{background:#26394a;color:#ffcc6e}
#fleet:target,#health:target,#maintenance:target,#reports:target,#oem:target{display:block!important}
body:has(#fleet:target) #overview,body:has(#health:target) #overview,body:has(#maintenance:target) #overview,body:has(#reports:target) #overview,body:has(#oem:target) #overview{display:none!important}
@media(max-width:700px){#nav a{white-space:nowrap}}
</style></head><body>
<div class="layout"><aside><div><div class="logo"><span>▲</span> TMM Asset Health</div><div class="subtitle">SINDANE ASSET SOLUTIONS</div></div>
<nav id="nav" aria-label="Dashboard modules">
<a href="#overview">▣ Executive Overview</a>
<a href="#fleet">▤ Fleet Intelligence</a>
<a href="#health">◈ Machine Health</a>
<a href="#maintenance">⚙ Maintenance</a>
<a href="#reports">▥ Reports</a>
<a href="#oem">↔ OEM Integrations</a></nav>
<div class="sidebar-note">Isolated design preview<br>No live data or database requests<br>Production remains unchanged</div></aside>
<main><header class="top"><h2 id="pageTitle">Executive Overview</h2><span class="pill">● DEMO PREVIEW</span></header>
<section class="hero"><small>MINING FLEET INTELLIGENCE</small><h1 id="heroTitle">Fleet health at a glance</h1><p>Engineering insights for safer, more reliable and productive mining operations.</p></section>
<div class="notice">DEMONSTRATION DATA ONLY — All metrics are illustrative, not actual mine telemetry or OEM readings.</div>
<div id="overview"><div class="kpis">
<div class="kpi"><small>Fleet availability</small><strong>92%</strong><div class="foot">Illustrative value</div></div>
<div class="kpi"><small>Fleet utilisation</small><strong>77%</strong><div class="foot">Illustrative value</div></div>
<div class="kpi"><small>Machines reporting</small><strong>24</strong><div class="foot">Illustrative value</div></div>
<div class="kpi"><small>Critical alerts</small><strong>2</strong><div class="foot">Illustrative value</div></div></div>
<div class="grid"><section class="panel"><h3>Availability & utilisation trends</h3><div class="controls"><div class="legend"><i class="dot gold"></i>Availability <i class="dot blue"></i>Utilisation</div><label>Period <select id="period"><option>7 days</option><option>30 days</option><option>90 days</option></select></label></div>
<svg id="trend" viewBox="0 0 650 260" role="img" aria-label="Illustrative availability and utilisation trend chart"><line x1="43" y1="225" x2="635" y2="225" stroke="#34556b" stroke-dasharray="4 5"/><text x="5" y="229" fill="#a8c0d1" font-size="12">40%</text><line x1="43" y1="167" x2="635" y2="167" stroke="#34556b" stroke-dasharray="4 5"/><text x="5" y="171" fill="#a8c0d1" font-size="12">60%</text><line x1="43" y1="109" x2="635" y2="109" stroke="#34556b" stroke-dasharray="4 5"/><text x="5" y="113" fill="#a8c0d1" font-size="12">80%</text><line x1="43" y1="51" x2="635" y2="51" stroke="#34556b" stroke-dasharray="4 5"/><text x="5" y="55" fill="#a8c0d1" font-size="12">100%</text><polyline points="43,91.6 141.33333333333331,82.9 239.66666666666666,88.70000000000002 338,71.30000000000001 436.3333333333333,77.1 534.6666666666667,68.4 633,74.20000000000002" stroke="#f2b94b" stroke-width="4" fill="none" stroke-linecap="round" stroke-linejoin="round"/><circle cx="43" cy="91.6" r="4" fill="#f2b94b"><title>Mon: 86% (demo)</title></circle><circle cx="141.33333333333331" cy="82.9" r="4" fill="#f2b94b"><title>Tue: 89% (demo)</title></circle><circle cx="239.66666666666666" cy="88.70000000000002" r="4" fill="#f2b94b"><title>Wed: 87% (demo)</title></circle><circle cx="338" cy="71.30000000000001" r="4" fill="#f2b94b"><title>Thu: 93% (demo)</title></circle><circle cx="436.3333333333333" cy="77.1" r="4" fill="#f2b94b"><title>Fri: 91% (demo)</title></circle><circle cx="534.6666666666667" cy="68.4" r="4" fill="#f2b94b"><title>Sat: 94% (demo)</title></circle><circle cx="633" cy="74.20000000000002" r="4" fill="#f2b94b"><title>Sun: 92% (demo)</title></circle><polyline points="43,152.5 141.33333333333331,138 239.66666666666666,143.8 338,126.4 436.3333333333333,120.60000000000001 534.6666666666667,111.9 633,117.7" stroke="#52a4f5" stroke-width="4" fill="none" stroke-linecap="round" stroke-linejoin="round"/><circle cx="43" cy="152.5" r="4" fill="#52a4f5"><title>Mon: 65% (demo)</title></circle><circle cx="141.33333333333331" cy="138" r="4" fill="#52a4f5"><title>Tue: 70% (demo)</title></circle><circle cx="239.66666666666666" cy="143.8" r="4" fill="#52a4f5"><title>Wed: 68% (demo)</title></circle><circle cx="338" cy="126.4" r="4" fill="#52a4f5"><title>Thu: 74% (demo)</title></circle><circle cx="436.3333333333333" cy="120.60000000000001" r="4" fill="#52a4f5"><title>Fri: 76% (demo)</title></circle><circle cx="534.6666666666667" cy="111.9" r="4" fill="#52a4f5"><title>Sat: 79% (demo)</title></circle><circle cx="633" cy="117.7" r="4" fill="#52a4f5"><title>Sun: 77% (demo)</title></circle><text x="43" y="251" fill="#b6cad8" text-anchor="middle" font-size="11">Mon</text><text x="141.33333333333331" y="251" fill="#b6cad8" text-anchor="middle" font-size="11">Tue</text><text x="239.66666666666666" y="251" fill="#b6cad8" text-anchor="middle" font-size="11">Wed</text><text x="338" y="251" fill="#b6cad8" text-anchor="middle" font-size="11">Thu</text><text x="436.3333333333333" y="251" fill="#b6cad8" text-anchor="middle" font-size="11">Fri</text><text x="534.6666666666667" y="251" fill="#b6cad8" text-anchor="middle" font-size="11">Sat</text><text x="633" y="251" fill="#b6cad8" text-anchor="middle" font-size="11">Sun</text></svg><p id="chartInfo">Hover over chart points for illustrative readings.</p></section>
<section class="panel"><h3>Fleet operating status</h3><div class="donut"><div><strong>24</strong><small>Machines</small></div></div>
<div class="status"><div><span><i class="dot green"></i>Operating</span><b>20</b></div><div><span><i class="dot gold"></i>Idle</span><b>2</b></div><div><span><i class="dot red"></i>Unavailable</span><b>2</b></div></div><p>Illustrative distribution</p></section></div>
<div class="grid"><section class="panel"><h3>Downtime Pareto analysis</h3><div id="pareto" class="pareto"><div class="barrow"><span>Hydraulic</span><div class="track"><div class="fill" style="width:100%"></div></div><strong>32h</strong></div><div class="barrow"><span>Engine</span><div class="track"><div class="fill" style="width:56.25%"></div></div><strong>18h</strong></div><div class="barrow"><span>Electrical</span><div class="track"><div class="fill" style="width:37.5%"></div></div><strong>12h</strong></div><div class="barrow"><span>Undercarriage</span><div class="track"><div class="fill" style="width:25%"></div></div><strong>8h</strong></div><div class="barrow"><span>Other</span><div class="track"><div class="fill" style="width:18.75%"></div></div><strong>6h</strong></div></div><p>Illustrative downtime hours by fault category</p></section>
<section class="panel"><h3>Engineering intelligence</h3><p>Machine diagnostic codes, service-meter hours, recurring failures, condition alerts and maintenance recommendations will appear here once authorised sources are connected.</p><h3>OEM connectivity</h3><p>Planned: CAT, Volvo and mixed-fleet connector support, subject to customer permission and available APIs.</p></section></div></div>
<section id="fleet" class="hidden"><div class="panel" style="margin-top:15px"><h3>Existing TMM fleet · Read-only connection</h3><p>This securely reads fleet records from your existing company workspace after login. It does not modify machines or replace the demonstration dashboard.</p><button id="loadPreviewFleet" type="button" style="padding:11px 16px;border:1px solid #947a3e;background:#44371f;color:#ffdc8b;border-radius:8px;cursor:pointer;margin-right:10px">Load preview test fleet (no login)</button> <button id="loadRealFleet" type="button" style="padding:11px 16px;border:1px solid #4d7087;background:#173a52;color:white;border-radius:8px;cursor:pointer">Load my existing TMM fleet</button><p id="realFleetStatus" role="status">Not connected. Demonstration data is shown below.</p><div id="realFleetTable" style="overflow-x:auto"></div></div>
<div class="kpis">
<div class="kpi"><small>Tracked machines</small><strong id="fleetCount">8</strong><div class="foot">Demonstration fleet</div></div>
<div class="kpi"><small>Average availability</small><strong id="fleetAvailability">—</strong><div class="foot">Selected machines</div></div>
<div class="kpi"><small>Average utilisation</small><strong id="fleetUtilisation">—</strong><div class="foot">Selected machines</div></div>
<div class="kpi"><small>Total engine hours</small><strong id="fleetHours">—</strong><div class="foot">Illustrative meter readings</div></div>
</div>
<div class="panel" style="margin-top:15px">
<h3>Fleet register and performance</h3><p>Illustrative asset register · Click a machine to inspect its trend and operating details.</p><button id="fleetExport" type="button" style="background:#173a52;color:#fff;border:1px solid #4d7087;border-radius:7px;padding:9px 14px;cursor:pointer;margin:4px 0 12px">Export filtered demo fleet (CSV)</button><p id="fleetExportStatus" role="status"></p>
<div class="controls" style="margin:15px 0"><label>Search assets <input id="fleetSearch" aria-label="Search fleet" placeholder="Machine ID, model or OEM" style="background:#091c2c;border:1px solid #4d7087;border-radius:7px;padding:9px;color:white;max-width:100%"></label>
<label>OEM <select id="fleetOEM"><option value="all">All manufacturers</option><option>CAT</option><option>Volvo</option><option>Komatsu</option></select></label>
<label>Status <select id="fleetStatus"><option value="all">All statuses</option><option>Operating</option><option>Idle</option><option>Unavailable</option></select></label></div>
<div style="overflow-x:auto"><table style="width:100%;border-collapse:collapse;min-width:700px;text-align:left" id="fleetTable">
<thead><tr style="color:#b4cbd9;border-bottom:1px solid #34556b"><th style="padding:12px">Asset</th><th>OEM / model</th><th>Status</th><th>Engine hours</th><th>Availability</th><th>Utilisation</th><th>Last update</th></tr></thead><tbody id="fleetRows"></tbody></table></div>
<p id="fleetEmpty" class="hidden">No machines match the selected filters.</p>
</div>
<div class="grid"><section class="panel"><h3>Selected machine trends</h3><div class="controls"><label>Asset <select id="fleetAsset"></select></label><label>Period <select id="fleetPeriod"><option value="7">7 days</option><option value="30">30 days</option></select></label></div>
<svg id="fleetTrend" viewBox="0 0 650 260" role="img" aria-label="Illustrative selected machine performance chart" style="width:100%;height:auto;margin-top:12px"></svg><p><i class="dot gold"></i>Availability <i class="dot blue"></i>Utilisation · Illustrative history</p></section>
<section class="panel"><h3>Machine detail</h3><div id="fleetDetail" style="line-height:2"></div><p>All readings are synthetic. No OEM connection or database access.</p></section></div>
</section>
<section id="health" class="hidden">
<div class="kpis">
<div class="kpi"><small>Active fault events</small><strong id="healthTotal">—</strong><div class="foot">Synthetic events</div></div>
<div class="kpi"><small>Critical alerts</small><strong id="healthCritical" style="color:#f07472">—</strong><div class="foot">Requires urgent review</div></div>
<div class="kpi"><small>Machines affected</small><strong id="healthAffected">—</strong><div class="foot">Unique assets</div></div>
<div class="kpi"><small>Recurring fault groups</small><strong id="healthRecurring">—</strong><div class="foot">Repeated asset and code</div></div>
</div>
<div class="panel" style="margin-top:15px"><h3>Diagnostic alerts and fault history</h3>
<p>Demonstration data only — no live OEM diagnostics, predictive failure claims or maintenance work orders.</p>
<div class="controls" style="margin:15px 0;gap:12px;display:flex;flex-wrap:wrap">
<label>Machine <select id="healthAsset"><option value="all">All machines</option></select></label>
<label>Severity <select id="healthSeverity"><option value="all">All severities</option><option>Critical</option><option>Warning</option><option>Info</option></select></label>
<label>Status <select id="healthState"><option value="all">All statuses</option><option>Active</option><option>Resolved</option></select></label></div>
<div style="overflow-x:auto"><table style="width:100%;min-width:720px;border-collapse:collapse;text-align:left">
<thead><tr style="color:#b4cbd9;border-bottom:1px solid #34556b"><th style="padding:12px">Asset</th><th>Fault code</th><th>Description</th><th>Severity</th><th>Status</th><th>Occurrence</th></tr></thead><tbody id="healthRows"></tbody></table></div>
<p id="healthEmpty" class="hidden">No diagnostic events match the selected filters.</p></div>
<div class="grid">
<section class="panel"><h3>Condition indicators</h3><div id="healthIndicators"></div><p style="font-size:12px">Illustrative risk indicators, not measured temperatures, pressures or verified failure probabilities.</p></section>
<section class="panel"><h3>Engineering review queue</h3><div id="healthActions"></div><p style="font-size:12px">Recommendations are generic inspection prompts. Confirm against the OEM manual and site procedures before acting.</p></section>
</div></section>
<section id="maintenance" class="hidden">
<div class="kpis">
<div class="kpi"><small>Overdue services</small><strong id="maintOverdue" style="color:#f07472">—</strong><div class="foot">Based on sample meter hours</div></div>
<div class="kpi"><small>Services due soon</small><strong id="maintSoon">—</strong><div class="foot">Within 100 engine hours</div></div>
<div class="kpi"><small>Open work orders</small><strong id="maintOpen">—</strong><div class="foot">Illustrative maintenance tasks</div></div>
<div class="kpi"><small>Breakdown hours</small><strong id="maintDowntime">—</strong><div class="foot">Sample historical downtime</div></div>
</div>
<div class="panel" style="margin-top:15px"><h3>Preventive maintenance schedule</h3><p>Demo data only. Service intervals are illustrative and must be replaced with OEM-approved schedules.</p>
<div class="controls" style="display:flex;flex-wrap:wrap;gap:12px;margin:15px 0"><label>Search asset <input id="maintSearch" placeholder="Asset or service" style="background:#091c2c;border:1px solid #4d7087;border-radius:7px;padding:9px;color:white"></label><label>Priority <select id="maintPriority"><option value="all">All priorities</option><option>Overdue</option><option>Due soon</option><option>Scheduled</option></select></label></div>
<div style="overflow-x:auto"><table style="width:100%;min-width:760px;border-collapse:collapse;text-align:left"><thead><tr style="color:#b4cbd9;border-bottom:1px solid #34556b"><th style="padding:12px">Asset</th><th>Service / inspection</th><th>Current meter</th><th>Due at</th><th>Hours remaining</th><th>Priority</th></tr></thead><tbody id="maintRows"></tbody></table></div><p id="maintEmpty" class="hidden">No maintenance tasks match your filters.</p></div>
<div class="grid"><section class="panel"><h3>Work-order queue</h3><div id="maintOrders"></div><p style="font-size:12px">Read-only sample work orders. No work orders are created or closed in production.</p></section>
<section class="panel"><h3>Breakdown history</h3><div id="maintBreakdowns"></div><p style="font-size:12px">Illustrative downtime only. Actual root causes require engineering verification.</p></section></div>
</section>
<section id="reports" class="hidden">
<div class="panel"><div class="controls"><h3>Management performance report</h3><div><label>Reporting period <select id="reportPeriod"><option value="daily">Daily</option><option value="weekly">Weekly</option><option value="monthly">Monthly</option></select></label> <button id="reportCSV" type="button" style="padding:10px 14px;border:1px solid #947a3e;border-radius:8px;background:#44371f;color:#ffdc8b;cursor:pointer">Download CSV</button> <button id="reportPrint" type="button" style="padding:10px 14px;border:1px solid #4d7087;border-radius:8px;background:#183348;color:white;cursor:pointer">Print report</button></div></div><p id="reportSubtitle">Illustrative report — not verified operational data.</p></div>
<div class="kpis" style="margin-top:15px"><div class="kpi"><small>Average availability</small><strong id="reportAvail">—</strong><div class="foot">Illustrative KPI</div></div><div class="kpi"><small>Average utilisation</small><strong id="reportUtil">—</strong><div class="foot">Illustrative KPI</div></div><div class="kpi"><small>Production units</small><strong id="reportProduction">—</strong><div class="foot">Synthetic tonnes</div></div><div class="kpi"><small>Downtime hours</small><strong id="reportDowntime">—</strong><div class="foot">Synthetic downtime</div></div></div>
<div class="grid"><section class="panel"><h3>Performance by reporting interval</h3><svg id="reportTrend" viewBox="0 0 650 260" role="img" aria-label="Illustrative management performance trends" style="width:100%;height:auto"></svg><p><i class="dot gold"></i>Availability <i class="dot blue"></i>Utilisation · Sample data</p></section><section class="panel"><h3>Downtime contributors</h3><div id="reportPareto" class="pareto"></div><p>Illustrative category breakdown, not root-cause findings.</p></section></div>
<div class="panel" style="margin-top:15px"><h3>Reporting-period detail</h3><div style="overflow-x:auto"><table style="width:100%;min-width:650px;border-collapse:collapse;text-align:left"><thead><tr style="color:#b4cbd9;border-bottom:1px solid #34556b"><th style="padding:12px">Period</th><th>Availability</th><th>Utilisation</th><th>Production (t)</th><th>Downtime (h)</th><th>KPI status</th></tr></thead><tbody id="reportRows"></tbody></table></div><p>Example KPI targets: availability ≥ 90%, utilisation ≥ 75%. These are demonstration thresholds, not agreed mine targets.</p></div>
</section>
<section id="oem" class="hidden">
<div class="kpis"><div class="kpi"><small>Live OEM connections</small><strong>0</strong><div class="foot">No credentials configured</div></div><div class="kpi"><small>Supported preview profiles</small><strong>3</strong><div class="foot">CAT, Volvo, mixed fleet</div></div><div class="kpi"><small>Telemetry status</small><strong style="font-size:21px;color:#f2b94b">Not connected</strong><div class="foot">No machine data is being collected</div></div><div class="kpi"><small>Data source</small><strong style="font-size:21px">Demo only</strong><div class="foot">Synthetic sample payloads</div></div></div>
<div class="panel" style="margin-top:15px"><h3>OEM integration readiness</h3><p>These are integration planning profiles, not working API connections. Actual availability of fields depends on the OEM, machine model, telematics hardware, licences and access permissions.</p>
<div class="controls" style="display:flex;flex-wrap:wrap;gap:12px;margin:15px 0"><label>Manufacturer <select id="oemProfile"><option value="cat">CAT / Caterpillar</option><option value="volvo">Volvo Construction Equipment</option><option value="mixed">Mixed-fleet gateway</option></select></label><label>Sample record <select id="oemSample"><option value="normal">Normal operation</option><option value="alert">Fault event</option></select></label></div>
<div id="oemSummary"></div></div>
<div class="grid"><section class="panel"><h3>Standardised TMM data mapping</h3><div style="overflow-x:auto"><table style="width:100%;min-width:470px;border-collapse:collapse;text-align:left"><thead><tr style="color:#b4cbd9;border-bottom:1px solid #34556b"><th style="padding:10px">TMM field</th><th>Example source field</th><th>Readiness</th></tr></thead><tbody id="oemFields"></tbody></table></div><p style="font-size:12px">Example source-field names are conceptual placeholders, not confirmed OEM API schemas.</p></section><section class="panel"><h3>Example telemetry payload</h3><pre id="oemPayload" style="white-space:pre-wrap;overflow-wrap:anywhere;background:#071725;border:1px solid #315069;border-radius:9px;padding:15px;font-size:12px;line-height:1.7"></pre><p style="font-size:12px">Synthetic JSON generated locally in this preview. No network requests or credentials.</p></section></div>
<div class="panel" style="margin-top:15px"><h3>Steps required before live connection</h3><div id="oemChecklist"></div><p style="font-size:12px">Integration must use backend-only secret storage, company-level access control, rate limits, retries, validation and audit logs. Never paste API keys into this preview.</p></div>
</section>
<section id="module" class="panel module hidden"><h3 id="moduleTitle"></h3><p>This section is being developed. The preview is deliberately disconnected from production and does not read or modify any customer records.</p></section>
<div class="footer">TMM Asset Health · Development branch preview · Sample data · No D1, R2 or OEM requests</div></main></div>

<script>
document.addEventListener("click",async function(event){
  if(event.target.id!=="loadRealFleet"&&event.target.id!=="loadPreviewFleet")return;
  const button=event.target,isDemo=button.id==="loadPreviewFleet",status=document.getElementById("realFleetStatus"),container=document.getElementById("realFleetTable");
  button.disabled=true;status.textContent=isDemo?"Reading isolated preview test fleet…":"Checking your company session and reading fleet records…";
  try{
    const res=await fetch(isDemo?"/industrial-preview/api/test-fleet":"/industrial-preview/api/fleet",{credentials:"same-origin",cache:"no-store"});
    const data=await res.json();
    if(!res.ok||!data.ok)throw Error(data.error||"Unable to load fleet");
    container.replaceChildren();
    const table=document.createElement("table");table.style.cssText="width:100%;min-width:650px;border-collapse:collapse;text-align:left";
    const head=document.createElement("tr");
    ["Fleet number","Category","Site","Status","Operating hours","Next service hours"].forEach(x=>{const th=document.createElement("th");th.textContent=x;th.style.padding="10px";head.append(th)});
    table.append(head);
    data.machines.forEach(m=>{const tr=document.createElement("tr");tr.style.borderTop="1px solid #34556b";[m.fleet,m.category,m.site,m.status,m.hours,m.nextService].forEach(v=>{const td=document.createElement("td");td.textContent=v==null?"—":String(v);td.style.padding="10px";tr.append(td)});table.append(tr)});
    container.append(table);status.textContent=(isDemo?"Connected to isolated preview test database · ":"Connected to existing TMM · ")+data.count+" fleet records · Read-only. Dashboard metrics below remain synthetic.";
  }catch(error){status.textContent="Not connected: "+error.message+(isDemo?" The preview test company may not have machine records yet.":" The preview uses a separate database and cannot authenticate your production account.");container.replaceChildren();}
  finally{button.disabled=false;}
});
</script>
<script>
(function(){
const datasets={"7 days":{labels:["Mon","Tue","Wed","Thu","Fri","Sat","Sun"],a:[86,89,87,93,91,94,92],u:[65,70,68,74,76,79,77]},"30 days":{labels:["Week 1","Week 2","Week 3","Week 4"],a:[84,88,90,92],u:[62,69,73,77]},"90 days":{labels:["Month 1","Month 2","Month 3"],a:[83,87,92],u:[61,70,77]}};
const ns="http://www.w3.org/2000/svg";const chart=document.getElementById("trend");const period=document.getElementById("period");
function el(tag,attrs,text){const node=document.createElementNS(ns,tag);Object.keys(attrs).forEach(k=>node.setAttribute(k,attrs[k]));if(text!==undefined)node.textContent=text;return node}
function draw(){const d=datasets[period.value];chart.replaceChildren();[40,60,80,100].forEach(v=>{const y=225-(v-40)*2.9;chart.append(el("line",{x1:43,y1:y,x2:635,y2:y,stroke:"#34556b","stroke-dasharray":"4 5"}));chart.append(el("text",{x:5,y:y+4,fill:"#a8c0d1","font-size":"12"},v+"%"))});
[[d.a,"#f2b94b"],[d.u,"#52a4f5"]].forEach(([arr,color])=>{const pts=arr.map((v,i)=>(43+i*590/(arr.length-1))+","+(225-(v-40)*2.9)).join(" ");chart.append(el("polyline",{points:pts,stroke:color,"stroke-width":"4",fill:"none","stroke-linecap":"round","stroke-linejoin":"round"}))});
d.labels.forEach((label,i)=>{const x=43+i*590/(d.labels.length-1);chart.append(el("text",{x,y:251,fill:"#b6cad8","text-anchor":"middle","font-size":"11"},label));const hotspot=el("rect",{x:x-18,y:0,width:36,height:225,fill:"transparent"});hotspot.addEventListener("mouseenter",()=>document.getElementById("chartInfo").textContent=label+" · Availability "+d.a[i]+"% · Utilisation "+d.u[i]+"% (sample)");chart.append(hotspot)})}
period.addEventListener("change",draw);
const machines=[
{id:"EX-101",oem:"CAT",model:"320 GC",status:"Operating",hours:4820,a:94,u:82,updated:"2 min ago"},
{id:"EX-102",oem:"CAT",model:"336",status:"Operating",hours:6134,a:91,u:79,updated:"4 min ago"},
{id:"ADT-201",oem:"Volvo",model:"A40G",status:"Operating",hours:3288,a:96,u:85,updated:"3 min ago"},
{id:"ADT-202",oem:"Volvo",model:"A35G",status:"Idle",hours:4012,a:88,u:57,updated:"12 min ago"},
{id:"LD-301",oem:"Komatsu",model:"WA470",status:"Operating",hours:7102,a:93,u:80,updated:"5 min ago"},
{id:"LD-302",oem:"CAT",model:"950",status:"Unavailable",hours:5490,a:72,u:31,updated:"1 hr ago"},
{id:"EX-103",oem:"Komatsu",model:"PC350",status:"Operating",hours:2940,a:95,u:83,updated:"7 min ago"},
{id:"ADT-203",oem:"Volvo",model:"A45G",status:"Operating",hours:3675,a:92,u:76,updated:"6 min ago"}];
const fSearch=document.getElementById("fleetSearch"),fOEM=document.getElementById("fleetOEM"),fStatus=document.getElementById("fleetStatus"),fAsset=document.getElementById("fleetAsset"),fPeriod=document.getElementById("fleetPeriod");
machines.forEach(m=>{const opt=document.createElement("option");opt.value=m.id;opt.textContent=m.id+" · "+m.oem+" "+m.model;fAsset.append(opt)});
function fleetFilter(){const q=fSearch.value.trim().toLowerCase();const selected=machines.filter(m=>(fOEM.value==="all"||m.oem===fOEM.value)&&(fStatus.value==="all"||m.status===fStatus.value)&&[m.id,m.oem,m.model].some(v=>v.toLowerCase().includes(q)));const tbody=document.getElementById("fleetRows");tbody.replaceChildren();
selected.forEach(m=>{const tr=document.createElement("tr");tr.style.borderBottom="1px solid #2b465a";[m.id,m.oem+" "+m.model,m.status,m.hours.toLocaleString()+" h",m.a+"%",m.u+"%",m.updated].forEach((v,i)=>{const td=document.createElement("td");td.textContent=v;td.style.padding="12px 8px";if(i===2)td.style.color=m.status==="Operating"?"#61c99a":m.status==="Idle"?"#f2b94b":"#f07472";tr.append(td)});tr.style.cursor="pointer";tr.title="View illustrative machine trend";tr.addEventListener("click",()=>{fAsset.value=m.id;drawFleet()});tbody.append(tr)});
document.getElementById("fleetEmpty").classList.toggle("hidden",selected.length!==0);document.getElementById("fleetCount").textContent=String(selected.length);
document.getElementById("fleetAvailability").textContent=selected.length?Math.round(selected.reduce((sum,m)=>sum+m.a,0)/selected.length)+"%":"—";
document.getElementById("fleetUtilisation").textContent=selected.length?Math.round(selected.reduce((sum,m)=>sum+m.u,0)/selected.length)+"%":"—";
document.getElementById("fleetHours").textContent=selected.length?selected.reduce((sum,m)=>sum+m.hours,0).toLocaleString()+" h":"—";
}
function drawFleet(){const m=machines.find(x=>x.id===fAsset.value)||machines[0];const n=Number(fPeriod.value)===7?7:6;const chart=document.getElementById("fleetTrend");chart.replaceChildren();
[40,60,80,100].forEach(v=>{const y=225-(v-40)*2.9;chart.append(el("line",{x1:43,y1:y,x2:635,y2:y,stroke:"#34556b","stroke-dasharray":"4 5"}));chart.append(el("text",{x:5,y:y+4,fill:"#a8c0d1","font-size":"12"},v+"%"))});
[[m.a,"#f2b94b"],[m.u,"#52a4f5"]].forEach(([base,color],series)=>{const values=Array.from({length:n},(_,i)=>Math.max(40,Math.min(99,base+Math.round(Math.sin(i*1.6+m.hours/700+series)*4))));chart.append(el("polyline",{points:values.map((v,i)=>(43+i*590/(n-1))+","+(225-(v-40)*2.9)).join(" "),fill:"none",stroke:color,"stroke-width":"4","stroke-linecap":"round"}))});
Array.from({length:n},(_,i)=>{chart.append(el("text",{x:43+i*590/(n-1),y:251,fill:"#b6cad8","text-anchor":"middle","font-size":"11"},fPeriod.value==="7"?"D"+(i+1):"P"+(i+1)))});
const detail=document.getElementById("fleetDetail");detail.replaceChildren();[["Asset",m.id],["Manufacturer",m.oem],["Model",m.model],["Status",m.status],["Engine hours",m.hours.toLocaleString()+" h"],["Availability",m.a+"%"],["Utilisation",m.u+"%"],["Last update",m.updated]].forEach(([key,value])=>{const row=document.createElement("div");row.style.borderBottom="1px solid #28465b";const label=document.createElement("span");label.style.color="#9eb6c8";label.textContent=key+": ";const strong=document.createElement("strong");strong.textContent=value;row.append(label,strong);detail.append(row)})}
document.getElementById("fleetExport").addEventListener("click",()=>{const q=fSearch.value.trim().toLowerCase();const selected=machines.filter(m=>(fOEM.value==="all"||m.oem===fOEM.value)&&(fStatus.value==="all"||m.status===fStatus.value)&&[m.id,m.oem,m.model].some(v=>v.toLowerCase().includes(q)));const headers=["Asset","OEM","Model","Status","Engine hours (demo)","Availability % (demo)","Utilisation % (demo)","Last update (demo)"];const escapeCSV=v=>'"'+String(v).replace(/"/g,'""')+'"';const csv=[headers,...selected.map(m=>[m.id,m.oem,m.model,m.status,m.hours,m.a,m.u,m.updated])].map(row=>row.map(escapeCSV).join(",")).join("\\r\\n");const blob=new Blob([csv],{type:"text/csv;charset=utf-8"});const url=URL.createObjectURL(blob);const link=document.createElement("a");link.href=url;link.download="tmm-demo-fleet.csv";document.body.append(link);link.click();link.remove();setTimeout(()=>URL.revokeObjectURL(url),1000);document.getElementById("fleetExportStatus").textContent="Exported "+selected.length+" demonstration assets. No real fleet records included.";});
[fSearch,fOEM,fStatus].forEach(input=>input.addEventListener(input===fSearch?"input":"change",fleetFilter));[fAsset,fPeriod].forEach(input=>input.addEventListener("change",drawFleet));fleetFilter();drawFleet();
const healthEvents=[
{asset:"EX-101",code:"E101",desc:"Hydraulic pressure event",severity:"Critical",state:"Active",when:"Today 08:12",action:"Inspect hydraulic circuit and confirm sensor readings"},
{asset:"EX-101",code:"E101",desc:"Hydraulic pressure event",severity:"Critical",state:"Active",when:"Yesterday 14:30",action:"Review repeat occurrence and maintenance history"},
{asset:"ADT-202",code:"W204",desc:"Engine temperature warning",severity:"Warning",state:"Active",when:"Today 07:48",action:"Check cooling system and verify temperature"},
{asset:"LD-302",code:"E320",desc:"Electrical supply fault",severity:"Critical",state:"Active",when:"Today 06:05",action:"Request qualified electrical inspection"},
{asset:"LD-302",code:"E320",desc:"Electrical supply fault",severity:"Warning",state:"Resolved",when:"Yesterday 16:10",action:"Review recurrence and repair records"},
{asset:"EX-103",code:"I015",desc:"Scheduled service approaching",severity:"Info",state:"Active",when:"Today 05:50",action:"Verify service meter and maintenance plan"},
{asset:"ADT-201",code:"W410",desc:"Fuel system event",severity:"Warning",state:"Resolved",when:"Yesterday 11:15",action:"Review fuel system event history"}
];
const hAsset=document.getElementById("healthAsset"),hSeverity=document.getElementById("healthSeverity"),hState=document.getElementById("healthState");
[...new Set(healthEvents.map(e=>e.asset))].sort().forEach(id=>{const o=document.createElement("option");o.value=id;o.textContent=id;hAsset.append(o)});
function renderHealth(){const list=healthEvents.filter(e=>(hAsset.value==="all"||e.asset===hAsset.value)&&(hSeverity.value==="all"||e.severity===hSeverity.value)&&(hState.value==="all"||e.state===hState.value));
const active=list.filter(e=>e.state==="Active");document.getElementById("healthTotal").textContent=String(active.length);document.getElementById("healthCritical").textContent=String(active.filter(e=>e.severity==="Critical").length);document.getElementById("healthAffected").textContent=String(new Set(active.map(e=>e.asset)).size);
const counts={};list.forEach(e=>{const k=e.asset+" "+e.code;counts[k]=(counts[k]||0)+1});document.getElementById("healthRecurring").textContent=String(Object.values(counts).filter(v=>v>1).length);
const tbody=document.getElementById("healthRows");tbody.replaceChildren();list.forEach(e=>{const tr=document.createElement("tr");tr.style.borderBottom="1px solid #2b465a";[e.asset,e.code,e.desc,e.severity,e.state,e.when].forEach((v,i)=>{const td=document.createElement("td");td.textContent=v;td.style.padding="12px 8px";if(i===3)td.style.color=e.severity==="Critical"?"#f07472":e.severity==="Warning"?"#f2b94b":"#61c99a";tr.append(td)});tbody.append(tr)});document.getElementById("healthEmpty").classList.toggle("hidden",list.length!==0);
const indicators=document.getElementById("healthIndicators");indicators.replaceChildren();const groups=[["Critical",active.filter(e=>e.severity==="Critical").length,"#f07472"],["Warning",active.filter(e=>e.severity==="Warning").length,"#f2b94b"],["Information",active.filter(e=>e.severity==="Info").length,"#61c99a"]];groups.forEach(([label,num,color])=>{const wrap=document.createElement("div");wrap.style.margin="17px 0";const caption=document.createElement("div");caption.textContent=label+" · "+num+" active events";caption.style.marginBottom="7px";const track=document.createElement("div");track.style.background="#25465b";track.style.borderRadius="7px";track.style.height="13px";const bar=document.createElement("div");bar.style.width=(active.length?100*num/active.length:0)+"%";bar.style.height="100%";bar.style.background=color;bar.style.borderRadius="7px";track.append(bar);wrap.append(caption,track);indicators.append(wrap)});
const actions=document.getElementById("healthActions");actions.replaceChildren();const seen=new Set();active.slice().sort((a,b)=>(a.severity==="Critical"?0:1)-(b.severity==="Critical"?0:1)).forEach(e=>{const key=e.asset+" "+e.code;if(seen.has(key))return;seen.add(key);const row=document.createElement("div");row.style.padding="12px 0";row.style.borderBottom="1px solid #2b465a";const title=document.createElement("strong");title.textContent=e.asset+" · "+e.code+" · "+e.severity;title.style.color=e.severity==="Critical"?"#f07472":"#f2b94b";const p=document.createElement("p");p.textContent=e.action;row.append(title,p);actions.append(row)})}
[hAsset,hSeverity,hState].forEach(x=>x.addEventListener("change",renderHealth));renderHealth();
const maintSchedule=[
{asset:"EX-101",task:"Hydraulic system inspection",meter:4820,due:4800},
{asset:"EX-102",task:"Engine oil and filter service",meter:6134,due:6250},
{asset:"ADT-201",task:"Transmission inspection",meter:3288,due:3350},
{asset:"ADT-202",task:"Cooling system inspection",meter:4012,due:4000},
{asset:"LD-301",task:"General preventive service",meter:7102,due:7250},
{asset:"LD-302",task:"Electrical system inspection",meter:5490,due:5450},
{asset:"EX-103",task:"Undercarriage inspection",meter:2940,due:3000},
{asset:"ADT-203",task:"Brake system inspection",meter:3675,due:3850}
];
const maintOrders=[
{id:"WO-101",asset:"EX-101",job:"Inspect hydraulic pressure fault",priority:"Critical",status:"Open"},
{id:"WO-102",asset:"LD-302",job:"Investigate electrical supply issue",priority:"Critical",status:"Open"},
{id:"WO-103",asset:"ADT-202",job:"Check cooling system",priority:"High",status:"In review"},
{id:"WO-104",asset:"EX-103",job:"Plan undercarriage inspection",priority:"Normal",status:"Planned"}
];
const maintFailures=[
{asset:"EX-101",reason:"Hydraulic fault",hours:12},
{asset:"LD-302",reason:"Electrical failure",hours:8},
{asset:"ADT-202",reason:"Cooling system",hours:5},
{asset:"EX-102",reason:"Engine fault",hours:4}
];
const maintSearch=document.getElementById("maintSearch"),maintPriority=document.getElementById("maintPriority");
function maintClass(m){const remaining=m.due-m.meter;return remaining<0?"Overdue":remaining<=100?"Due soon":"Scheduled"}
function renderMaintenance(){
const filtered=maintSchedule.filter(m=>(maintPriority.value==="all"||maintClass(m)===maintPriority.value)&&[m.asset,m.task].some(v=>v.toLowerCase().includes(maintSearch.value.trim().toLowerCase())));
document.getElementById("maintOverdue").textContent=String(maintSchedule.filter(m=>maintClass(m)==="Overdue").length);
document.getElementById("maintSoon").textContent=String(maintSchedule.filter(m=>maintClass(m)==="Due soon").length);
document.getElementById("maintOpen").textContent=String(maintOrders.filter(o=>o.status==="Open").length);
document.getElementById("maintDowntime").textContent=maintFailures.reduce((a,b)=>a+b.hours,0)+" h";
const rows=document.getElementById("maintRows");rows.replaceChildren();filtered.sort((a,b)=>(a.due-a.meter)-(b.due-b.meter)).forEach(m=>{const tr=document.createElement("tr");tr.style.borderBottom="1px solid #2b465a";[m.asset,m.task,m.meter.toLocaleString()+" h",m.due.toLocaleString()+" h",(m.due-m.meter)+" h",maintClass(m)].forEach((v,i)=>{const td=document.createElement("td");td.textContent=v;td.style.padding="12px 8px";if(i===5)td.style.color=maintClass(m)==="Overdue"?"#f07472":maintClass(m)==="Due soon"?"#f2b94b":"#61c99a";tr.append(td)});rows.append(tr)});document.getElementById("maintEmpty").classList.toggle("hidden",filtered.length!==0);
}
[maintSearch,maintPriority].forEach(el=>el.addEventListener(el===maintSearch?"input":"change",renderMaintenance));renderMaintenance();
const orderBox=document.getElementById("maintOrders");maintOrders.forEach(o=>{const div=document.createElement("div");div.style.cssText="padding:12px 0;border-bottom:1px solid #2b465a";const strong=document.createElement("strong");strong.textContent=o.id+" · "+o.asset+" · "+o.priority;strong.style.color=o.priority==="Critical"?"#f07472":"#f2b94b";const p=document.createElement("p");p.textContent=o.job+" — "+o.status;div.append(strong,p);orderBox.append(div)});
const failureBox=document.getElementById("maintBreakdowns");maintFailures.forEach(f=>{const div=document.createElement("div");div.style.margin="15px 0";const label=document.createElement("div");label.textContent=f.asset+" · "+f.reason+" · "+f.hours+" h";label.style.marginBottom="6px";const track=document.createElement("div");track.style.cssText="height:12px;background:#25465b;border-radius:6px";const bar=document.createElement("div");bar.style.cssText="height:100%;border-radius:6px;background:linear-gradient(90deg,#52a4f5,#f2b94b);width:"+(f.hours/12*100)+"%";track.append(bar);div.append(label,track);failureBox.append(div)});
const reportSets={
daily:{labels:["Mon","Tue","Wed","Thu","Fri","Sat","Sun"],a:[88,91,93,89,94,92,95],u:[70,75,78,72,81,77,83],production:[1200,1350,1430,1280,1510,1460,1580],down:[5,3,2,4,1,2,1]},
weekly:{labels:["Week 1","Week 2","Week 3","Week 4"],a:[87,90,92,94],u:[69,73,77,81],production:[8300,8700,9400,10200],down:[25,19,14,10]},
monthly:{labels:["May","Jun","Jul","Aug","Sep","Oct"],a:[84,86,88,91,92,94],u:[65,68,71,75,77,81],production:[34000,35900,37200,39100,40200,42500],down:[92,83,72,59,51,43]}
};
const reportPeriod=document.getElementById("reportPeriod");
function reportData(){return reportSets[reportPeriod.value]}
function avg(values){return Math.round(values.reduce((a,b)=>a+b,0)/values.length)}
function reportCSV(){const d=reportData();const rows=[["Period","Availability (%)","Utilisation (%)","Production (t)","Downtime (h)","KPI status"]];d.labels.forEach((label,i)=>rows.push([label,d.a[i],d.u[i],d.production[i],d.down[i],d.a[i]>=90&&d.u[i]>=75?"On target":"Below target"]));const csv="# DEMONSTRATION DATA ONLY - NOT REAL MINE RECORDS\r\n"+rows.map(row=>row.map(v=>'"'+String(v).replace(/"/g,'""')+'"').join(",")).join("\r\n");const blob=new Blob([csv],{type:"text/csv;charset=utf-8"});const url=URL.createObjectURL(blob);const a=document.createElement("a");a.href=url;a.download="TMM_Management_Report_DEMO_"+reportPeriod.value+".csv";document.body.append(a);a.click();a.remove();setTimeout(()=>URL.revokeObjectURL(url),1000)}
function renderReport(){const d=reportData();document.getElementById("reportAvail").textContent=avg(d.a)+"%";document.getElementById("reportUtil").textContent=avg(d.u)+"%";document.getElementById("reportProduction").textContent=d.production.reduce((a,b)=>a+b,0).toLocaleString()+" t";document.getElementById("reportDowntime").textContent=d.down.reduce((a,b)=>a+b,0)+" h";document.getElementById("reportSubtitle").textContent="Illustrative "+reportPeriod.options[reportPeriod.selectedIndex].text.toLowerCase()+" management report — no operational records connected.";
const chart=document.getElementById("reportTrend");chart.replaceChildren();[40,60,80,100].forEach(v=>{const y=225-(v-40)*2.9;chart.append(el("line",{x1:43,y1:y,x2:635,y2:y,stroke:"#34556b","stroke-dasharray":"4 5"}));chart.append(el("text",{x:5,y:y+4,fill:"#a8c0d1","font-size":"12"},v+"%"))});[[d.a,"#f2b94b"],[d.u,"#52a4f5"]].forEach(([values,color])=>chart.append(el("polyline",{points:values.map((v,i)=>(43+i*590/(values.length-1))+","+(225-(v-40)*2.9)).join(" "),fill:"none",stroke:color,"stroke-width":"4","stroke-linecap":"round"})));d.labels.forEach((label,i)=>chart.append(el("text",{x:43+i*590/(d.labels.length-1),y:251,fill:"#b6cad8","text-anchor":"middle","font-size":"11"},label)));
const rows=document.getElementById("reportRows");rows.replaceChildren();d.labels.forEach((label,i)=>{const tr=document.createElement("tr");tr.style.borderBottom="1px solid #2b465a";const ok=d.a[i]>=90&&d.u[i]>=75;[label,d.a[i]+"%",d.u[i]+"%",d.production[i].toLocaleString(),d.down[i]+" h",ok?"On target":"Below target"].forEach((v,j)=>{const td=document.createElement("td");td.textContent=v;td.style.padding="12px 8px";if(j===5)td.style.color=ok?"#61c99a":"#f2b94b";tr.append(td)});rows.append(tr)});
const pareto=document.getElementById("reportPareto");pareto.replaceChildren();const total=d.down.reduce((a,b)=>a+b,0);[["Hydraulic",0.38],["Engine",0.25],["Electrical",0.19],["Other",0.18]].forEach(([name,share])=>{const hours=Math.round(total*share*10)/10;const row=document.createElement("div");row.className="barrow";const label=document.createElement("span");label.textContent=name;const track=document.createElement("div");track.className="track";const fill=document.createElement("div");fill.className="fill";fill.style.width=(share/0.38*100)+"%";track.append(fill);const val=document.createElement("strong");val.textContent=hours+"h";row.append(label,track,val);pareto.append(row)})}
reportPeriod.addEventListener("change",renderReport);document.getElementById("reportCSV").addEventListener("click",reportCSV);document.getElementById("reportPrint").addEventListener("click",()=>window.print());renderReport();
const oemProfiles={
cat:{title:"CAT / Caterpillar",route:"OEM-authorised telematics API or approved integration partner",sample:"EX-101",model:"320 GC"},
volvo:{title:"Volvo Construction Equipment",route:"OEM-authorised telematics API or approved integration partner",sample:"ADT-201",model:"A40G"},
mixed:{title:"Mixed-fleet gateway",route:"Approved telematics aggregator or multiple OEM integrations",sample:"LD-301",model:"WA470"}
};
const oemFields=[["Machine identity","machineId / serialNumber"],["Timestamp","eventTime / recordedAt"],["Engine hours","engineHours"],["Location (optional)","latitude / longitude"],["Operating state","machineState"],["Fault events","diagnosticCode / severity"],["Fuel level (optional)","fuelLevelPercent"],["Production (if available)","payload / cycleCount"]];
function renderOEM(){const key=document.getElementById("oemProfile").value,p=oemProfiles[key],alert=document.getElementById("oemSample").value==="alert";
const summary=document.getElementById("oemSummary");summary.replaceChildren();const name=document.createElement("strong");name.textContent=p.title+" · Not connected";name.style.color="#f2b94b";const info=document.createElement("p");info.textContent="Potential integration path: "+p.route+". Access and exact data fields require vendor confirmation.";summary.append(name,info);
const rows=document.getElementById("oemFields");rows.replaceChildren();oemFields.forEach(([field,source])=>{const tr=document.createElement("tr");tr.style.borderBottom="1px solid #2b465a";[field,source,"Needs API verification"].forEach((v,i)=>{const td=document.createElement("td");td.textContent=v;td.style.padding="10px";if(i===2)td.style.color="#f2b94b";tr.append(td)});rows.append(tr)});
const payload={source:"SYNTHETIC_DEMO",profile:p.title,machineId:p.sample,model:p.model,eventTime:"2026-10-27T08:00:00+02:00",engineHours:key==="cat"?4820:key==="volvo"?3288:7102,machineState:alert?"Stopped":"Operating",availabilityPercent:alert?72:94,utilisationPercent:alert?31:81,diagnostics:alert?[{code:"DEMO-FAULT-01",severity:"Warning",description:"Illustrative fault event"}]:[]};
document.getElementById("oemPayload").textContent=JSON.stringify(payload,null,2);
const checklist=document.getElementById("oemChecklist");checklist.replaceChildren();["Obtain written mine/operator authorisation for each machine and company","Confirm OEM or aggregator API programme, licensing and supported models","Obtain API documentation and approved server-side credentials","Map identifiers, timestamps, engine hours, status and fault-code definitions","Validate sample data in a sandbox; handle missing and stale readings","Implement secure Worker ingestion, company isolation, D1/R2 storage and retry controls","Verify calculations against site records before enabling live management KPIs"].forEach((step,i)=>{const row=document.createElement("div");row.style.cssText="padding:11px 0;border-bottom:1px solid #2b465a";const number=document.createElement("strong");number.textContent=(i+1)+". ";number.style.color="#f2b94b";const label=document.createElement("span");label.textContent=step;row.append(number,label);checklist.append(row)})}
document.getElementById("oemProfile").addEventListener("change",renderOEM);document.getElementById("oemSample").addEventListener("change",renderOEM);renderOEM();

})();
</script></body></html>`;
      return new Response(html, {
        headers: {
          "Content-Type": "text/html; charset=utf-8",
          "Cache-Control": "no-store",
          "X-Robots-Tag": "noindex, nofollow"
        }
      });
    }
    // The isolated industrial preview has no database reads or writes.\n    // Avoid global role-schema initialization on its requests; it can exhaust\n    // the Worker subrequest budget and unnecessarily touch the D1 binding.\n    if (path !== "/industrial-preview" && !path.startsWith("/industrial-preview/")) {\n      await ensureAccountRoles(env);\n    }
    if(path==="/contractor-login" || path==="/api/contractor/login") return loginApp.fetch(req,env as never,ctx as never);
    if(PWA_PATHS.has(path)) return pwaApp.fetch(req,env as never,ctx as never);
    return app.fetch(req,env as never,ctx as never);
  },
  async scheduled(c:ScheduledController,env:Env,ctx:ExecutionContext){
    const target=app as unknown as {scheduled?:(c:ScheduledController,e:Env,x:ExecutionContext)=>Promise<void>|void};
    if(target.scheduled) return target.scheduled(c,env,ctx);
  }
};
