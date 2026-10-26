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
</style></head><body>
<div class="layout"><aside><div><div class="logo"><span>▲</span> TMM Asset Health</div><div class="subtitle">SINDANE ASSET SOLUTIONS</div></div>
<nav id="nav" aria-label="Dashboard modules">
<button class="active" data-page="Executive Overview">▣ Executive Overview</button>
<button data-page="Fleet Intelligence">▤ Fleet Intelligence</button>
<button data-page="Machine Health">◈ Machine Health</button>
<button data-page="Maintenance">⚙ Maintenance</button>
<button data-page="Reports">▥ Reports</button>
<button data-page="OEM Integrations">↔ OEM Integrations</button></nav>
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
<svg id="trend" viewBox="0 0 650 260" role="img" aria-label="Illustrative availability and utilisation trend chart"></svg><p id="chartInfo">Hover over chart points for illustrative readings.</p></section>
<section class="panel"><h3>Fleet operating status</h3><div class="donut"><div><strong>24</strong><small>Machines</small></div></div>
<div class="status"><div><span><i class="dot green"></i>Operating</span><b>20</b></div><div><span><i class="dot gold"></i>Idle</span><b>2</b></div><div><span><i class="dot red"></i>Unavailable</span><b>2</b></div></div><p>Illustrative distribution</p></section></div>
<div class="grid"><section class="panel"><h3>Downtime Pareto analysis</h3><div id="pareto" class="pareto"></div><p>Illustrative downtime hours by fault category</p></section>
<section class="panel"><h3>Engineering intelligence</h3><p>Machine diagnostic codes, service-meter hours, recurring failures, condition alerts and maintenance recommendations will appear here once authorised sources are connected.</p><h3>OEM connectivity</h3><p>Planned: CAT, Volvo and mixed-fleet connector support, subject to customer permission and available APIs.</p></section></div></div>
<section id="fleet" class="hidden">
<div class="kpis">
<div class="kpi"><small>Tracked machines</small><strong id="fleetCount">8</strong><div class="foot">Demonstration fleet</div></div>
<div class="kpi"><small>Average availability</small><strong id="fleetAvailability">—</strong><div class="foot">Selected machines</div></div>
<div class="kpi"><small>Average utilisation</small><strong id="fleetUtilisation">—</strong><div class="foot">Selected machines</div></div>
<div class="kpi"><small>Total engine hours</small><strong id="fleetHours">—</strong><div class="foot">Illustrative meter readings</div></div>
</div>
<div class="panel" style="margin-top:15px">
<h3>Fleet register and performance</h3>
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
<section id="module" class="panel module hidden"><h3 id="moduleTitle"></h3><p>This section is being developed. The preview is deliberately disconnected from production and does not read or modify any customer records.</p></section>
<div class="footer">TMM Asset Health · Development branch preview · Sample data · No D1, R2 or OEM requests</div></main></div>
<script>
(function(){
const datasets={"7 days":{labels:["Mon","Tue","Wed","Thu","Fri","Sat","Sun"],a:[86,89,87,93,91,94,92],u:[65,70,68,74,76,79,77]},"30 days":{labels:["Week 1","Week 2","Week 3","Week 4"],a:[84,88,90,92],u:[62,69,73,77]},"90 days":{labels:["Month 1","Month 2","Month 3"],a:[83,87,92],u:[61,70,77]}};
const ns="http://www.w3.org/2000/svg";const chart=document.getElementById("trend");const period=document.getElementById("period");
function el(tag,attrs,text){const node=document.createElementNS(ns,tag);Object.keys(attrs).forEach(k=>node.setAttribute(k,attrs[k]));if(text!==undefined)node.textContent=text;return node}
function draw(){const d=datasets[period.value];chart.replaceChildren();[40,60,80,100].forEach(v=>{const y=225-(v-40)*2.9;chart.append(el("line",{x1:43,y1:y,x2:635,y2:y,stroke:"#34556b","stroke-dasharray":"4 5"}));chart.append(el("text",{x:5,y:y+4,fill:"#a8c0d1","font-size":"12"},v+"%"))});
[[d.a,"#f2b94b"],[d.u,"#52a4f5"]].forEach(([arr,color])=>{const pts=arr.map((v,i)=>(43+i*590/(arr.length-1))+","+(225-(v-40)*2.9)).join(" ");chart.append(el("polyline",{points:pts,stroke:color,"stroke-width":"4",fill:"none","stroke-linecap":"round","stroke-linejoin":"round"}))});
d.labels.forEach((label,i)=>{const x=43+i*590/(d.labels.length-1);chart.append(el("text",{x,y:251,fill:"#b6cad8","text-anchor":"middle","font-size":"11"},label));const hotspot=el("rect",{x:x-18,y:0,width:36,height:225,fill:"transparent"});hotspot.addEventListener("mouseenter",()=>document.getElementById("chartInfo").textContent=label+" · Availability "+d.a[i]+"% · Utilisation "+d.u[i]+"% (sample)");chart.append(hotspot)})}
period.addEventListener("change",draw);draw();
[["Hydraulic",32],["Engine",18],["Electrical",12],["Undercarriage",8],["Other",6]].forEach(([name,h])=>{const row=document.createElement("div");row.className="barrow";const title=document.createElement("span");title.textContent=name;const track=document.createElement("div");track.className="track";const fill=document.createElement("div");fill.className="fill";fill.style.width=(h/32*100)+"%";track.append(fill);const amount=document.createElement("strong");amount.textContent=h+"h";row.append(title,track,amount);document.getElementById("pareto").append(row)});
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
document.querySelectorAll("#nav button").forEach(button=>button.addEventListener("click",()=>{document.querySelectorAll("#nav button").forEach(b=>b.classList.toggle("active",b===button));const page=button.dataset.page;document.getElementById("pageTitle").textContent=page;document.getElementById("heroTitle").textContent=page==="Executive Overview"?"Fleet health at a glance":page;document.getElementById("overview").classList.toggle("hidden",page!=="Executive Overview");document.getElementById("fleet").classList.toggle("hidden",page!=="Fleet Intelligence");document.getElementById("health").classList.toggle("hidden",page!=="Machine Health");document.getElementById("module").classList.toggle("hidden",page==="Executive Overview"||page==="Fleet Intelligence"||page==="Machine Health");document.getElementById("moduleTitle").textContent=page}));
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
