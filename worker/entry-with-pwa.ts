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
document.querySelectorAll("#nav button").forEach(button=>button.addEventListener("click",()=>{document.querySelectorAll("#nav button").forEach(b=>b.classList.toggle("active",b===button));const page=button.dataset.page;document.getElementById("pageTitle").textContent=page;document.getElementById("heroTitle").textContent=page==="Executive Overview"?"Fleet health at a glance":page;document.getElementById("overview").classList.toggle("hidden",page!=="Executive Overview");document.getElementById("module").classList.toggle("hidden",page==="Executive Overview");document.getElementById("moduleTitle").textContent=page}));
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
