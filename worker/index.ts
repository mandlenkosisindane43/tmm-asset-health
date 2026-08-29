/** Cloudflare Worker entry point for TMM Asset Health. */
import { handleImageOptimization, DEFAULT_DEVICE_SIZES, DEFAULT_IMAGE_SIZES } from "vinext/server/image-optimization";
import handler from "vinext/server/app-router-entry";

interface Env {
  ASSETS: Fetcher;
  DB: D1Database;
  BUCKET?: R2Bucket;
  IMAGES?: {
    input(stream: ReadableStream): {
      transform(options: Record<string, unknown>): {
        output(options: { format: string; quality: number }): Promise<{ response(): Response }>;
      };
    };
  };
}

interface ExecutionContext {
  waitUntil(promise: Promise<unknown>): void;
  passThroughOnException(): void;
}

function contractorDemoHtml() {
  return `<!doctype html>
<html lang="en"><head><meta charset="utf-8"/><meta name="viewport" content="width=device-width,initial-scale=1"/><title>TMM Asset Health | Contractor Workspace</title>
<style>
*{box-sizing:border-box}body{margin:0;font-family:Arial,Helvetica,sans-serif;background:#f4f7fb;color:#14213d}.app{min-height:100vh;display:grid;grid-template-columns:260px 1fr}.side{background:#0c1b33;color:#fff;padding:22px 16px;display:flex;flex-direction:column}.brand{padding:4px 8px 20px;border-bottom:1px solid #223552}.brand b{display:block;font-size:17px}.brand span{display:block;color:#91a8c8;font-size:11px;margin-top:4px}.company{margin:18px 2px;padding:13px;border:1px solid #29405f;border-radius:12px;background:#112642}.company b,.company span{display:block}.company b{font-size:12px}.company span{font-size:10px;color:#91a8c8;margin-top:4px}.nav{display:grid;gap:5px}.nav button{border:0;background:transparent;color:#b6c6db;padding:11px 12px;border-radius:9px;text-align:left;font-weight:700;cursor:pointer}.nav button.active,.nav button:hover{background:#19385e;color:#fff}.license{margin-top:auto;border:1px solid #25415e;background:#102846;border-radius:12px;padding:13px}.license small,.license b{display:block}.license small{color:#4dde93}.license b{margin:6px 0}.main{min-width:0}.top{height:84px;background:#fff;border-bottom:1px solid #dce4ef;padding:16px 28px;display:flex;justify-content:space-between;align-items:center}.top small{font-size:10px;color:#78869b;font-weight:800}.top h1{font-size:23px;margin:4px 0 0}.badge{font-size:10px;font-weight:800;background:#fff2c9;color:#7a4a00;border:1px solid #eed48b;padding:6px 8px;border-radius:999px}.content{padding:24px 28px;max-width:1500px;margin:auto}.hero{background:linear-gradient(120deg,#102b4d,#174f80);color:#fff;border-radius:16px;padding:25px 28px;display:flex;justify-content:space-between;align-items:center}.hero h2{margin:4px 0 6px}.hero p{margin:0;color:#c4d8eb;font-size:13px}.hero button{border:0;border-radius:8px;padding:10px 13px;font-weight:800;color:#163e64;cursor:pointer}.metrics{display:grid;grid-template-columns:repeat(4,1fr);gap:14px;margin:16px 0}.metric,.panel{background:#fff;border:1px solid #dde5ef;border-radius:13px;box-shadow:0 4px 12px rgba(31,55,82,.04)}.metric{padding:17px}.metric span,.metric small{display:block;color:#718198}.metric span{font-size:11px;font-weight:800}.metric b{display:block;font-size:27px;margin:8px 0 5px;color:#102943}.metric small{font-size:10px}.grid{display:grid;grid-template-columns:1.05fr .95fr;gap:14px}.panel{padding:18px}.panel h3{margin:0 0 12px;font-size:16px}.row{display:grid;grid-template-columns:80px 1fr auto;gap:8px;padding:11px 2px;border-top:1px solid #edf1f6;align-items:center;font-size:12px}.row span{color:#607087}.pill{font-size:9px;font-weight:800;padding:4px 7px;border-radius:999px}.good{background:#e2f6eb;color:#177245}.warn{background:#fff0d7;color:#9a5a00}.bad{background:#ffe4e4;color:#a82828}.bar{height:10px;background:#e8eef5;border-radius:999px;overflow:hidden}.bar i{display:block;width:84.6%;height:100%;background:#1d75bd}.tab{display:none}.tab.active{display:block}.table{overflow:auto;background:#fff;border:1px solid #dde5ef;border-radius:13px}.table h2{padding:20px 22px 0;margin:0}.table p{padding:0 22px 16px;margin:5px 0;color:#718198;font-size:12px}table{width:100%;border-collapse:collapse;font-size:12px}th{background:#f7f9fc;color:#65758b;font-size:9px;text-transform:uppercase;text-align:left;padding:11px 14px}td{padding:13px 14px;border-top:1px solid #edf1f5}.cards{display:grid;grid-template-columns:repeat(3,1fr);gap:14px}.card{background:#fff;border:1px solid #dde5ef;border-radius:13px;padding:20px}.card small{color:#7e8da3}.card b{display:block;margin:8px 0}.card span{color:#1267b3;font-size:11px;font-weight:800}@media(max-width:900px){.app{grid-template-columns:78px 1fr}.side{padding:14px 8px}.brand span,.company,.license{display:none}.brand b{font-size:11px}.nav button{font-size:0;text-align:center}.nav button:before{content:'•';font-size:18px}.metrics{grid-template-columns:1fr 1fr}.grid{grid-template-columns:1fr}.cards{grid-template-columns:1fr 1fr}}@media(max-width:600px){.app{display:block}.side{display:block}.nav{grid-template-columns:repeat(4,1fr)}.nav button{padding:8px}.top{height:auto;padding:14px 16px}.content{padding:14px}.hero{display:block}.hero button{margin-top:14px}.metrics{grid-template-columns:1fr 1fr}.cards{grid-template-columns:1fr}}
</style></head><body>
<div class="app"><aside class="side"><div class="brand"><b>TMM Asset Health</b><span>Sindane Asset Solutions</span></div><div class="company"><b>Mining Contractor Demo</b><span>North Pit Operations</span></div><div class="nav">
<button class="active" data-tab="dashboard">Dashboard</button><button data-tab="fleet">Fleet</button><button data-tab="breakdowns">Breakdowns</button><button data-tab="maintenance">Maintenance</button><button data-tab="workorders">Work orders</button><button data-tab="production">Production</button><button data-tab="documents">Documents</button><button data-tab="reports">Reports</button>
</div><div class="license"><small>● Licence active</small><b>Contractor Professional</b><small>Secure company workspace</small></div></aside>
<main class="main"><div class="top"><div><small>CONTRACTOR PORTAL</small><h1 id="pageTitle">Operations Dashboard</h1></div><span class="badge">LIVE DEMO</span></div><div class="content">
<section id="dashboard" class="tab active"><div class="hero"><div><small>LIVE CONTRACTOR WORKSPACE</small><h2>Good morning, Contractor Team</h2><p>One view of fleet health, downtime, maintenance and production performance.</p></div><button onclick="openTab('breakdowns')">View breakdowns →</button></div>
<div class="metrics"><div class="metric"><span>Fleet availability</span><b>83.3%</b><small>Target ≥ 90%</small></div><div class="metric"><span>Units operating</span><b>4 / 6</b><small>1 attention · 1 down</small></div><div class="metric"><span>Open breakdowns</span><b>3</b><small>2 require workshop action</small></div><div class="metric"><span>Production today</span><b>8 460 t</b><small>84.6% of target</small></div></div>
<div class="grid"><div class="panel"><h3>Fleet status</h3><div class="row"><b>ADT-01</b><span>Articulated Dump Truck</span><i class="pill good">Operating</i></div><div class="row"><b>ADT-02</b><span>Articulated Dump Truck</span><i class="pill good">Operating</i></div><div class="row"><b>EXC-01</b><span>Excavator</span><i class="pill warn">Attention</i></div><div class="row"><b>EXC-02</b><span>Excavator</span><i class="pill good">Operating</i></div><div class="row"><b>DOZ-01</b><span>Dozer</span><i class="pill bad">Down</i></div></div>
<div class="panel"><h3>Production vs target</h3><p>Actual 8 460 t / Target 10 000 t</p><div class="bar"><i></i></div><div class="row"><b>84.6%</b><span>Shift achievement</span><i class="pill warn">-1 540 t</i></div><div class="row"><b>79.4%</b><span>Utilisation</span><i class="pill good">Tracked</i></div><div class="row"><b>4.7 h</b><span>Total downtime</span><i class="pill bad">Today</i></div></div></div></section>
<section id="fleet" class="tab"><div class="table"><h2>Contractor fleet register</h2><p>Current machine status, site and service position.</p><table><thead><tr><th>Fleet no.</th><th>Machine</th><th>Site</th><th>Status</th><th>Hours</th><th>Service due</th></tr></thead><tbody><tr><td>ADT-01</td><td>Articulated Dump Truck</td><td>North Pit</td><td>Operating</td><td>6 842</td><td>72 h</td></tr><tr><td>ADT-02</td><td>Articulated Dump Truck</td><td>North Pit</td><td>Operating</td><td>6 179</td><td>118 h</td></tr><tr><td>EXC-01</td><td>Excavator</td><td>Box Cut</td><td>Attention</td><td>9 251</td><td>18 h</td></tr><tr><td>EXC-02</td><td>Excavator</td><td>South Pit</td><td>Operating</td><td>7 714</td><td>146 h</td></tr><tr><td>DOZ-01</td><td>Dozer</td><td>Discard</td><td>Down</td><td>11 032</td><td>0 h</td></tr></tbody></table></div></section>
<section id="breakdowns" class="tab"><div class="table"><h2>Breakdown register</h2><p>Open equipment faults and current downtime.</p><table><thead><tr><th>Fleet</th><th>Fault</th><th>Opened</th><th>Downtime</th><th>Priority</th></tr></thead><tbody><tr><td>DOZ-01</td><td>Hydraulic hose failure</td><td>29 Aug 08:15</td><td>2.8 h</td><td>Critical</td></tr><tr><td>EXC-01</td><td>Boom cylinder oil leak</td><td>29 Aug 06:40</td><td>1.2 h</td><td>High</td></tr><tr><td>ADT-02</td><td>Intermittent brake warning</td><td>28 Aug 15:30</td><td>0.7 h</td><td>Medium</td></tr></tbody></table></div></section>
<section id="maintenance" class="tab"><div class="table"><h2>Planned maintenance</h2><p>Services and inspections approaching due hours.</p><table><thead><tr><th>Fleet</th><th>Task</th><th>Due in</th><th>Responsible</th></tr></thead><tbody><tr><td>EXC-01</td><td>250 h service</td><td>18 h</td><td>Workshop Team</td></tr><tr><td>ADT-01</td><td>500 h service</td><td>72 h</td><td>Mechanic A</td></tr><tr><td>ADT-02</td><td>250 h service</td><td>118 h</td><td>Mechanic B</td></tr><tr><td>EXC-02</td><td>500 h service</td><td>146 h</td><td>Workshop Team</td></tr></tbody></table></div></section>
<section id="workorders" class="tab"><div class="table"><h2>Work orders</h2><p>Track assigned maintenance actions to completion.</p><table><thead><tr><th>Work order</th><th>Fleet</th><th>Job</th><th>Status</th></tr></thead><tbody><tr><td>WO-1042</td><td>DOZ-01</td><td>Replace failed hydraulic hose</td><td>In progress</td></tr><tr><td>WO-1041</td><td>EXC-01</td><td>Inspect boom cylinder leak</td><td>Assigned</td></tr><tr><td>WO-1038</td><td>ADT-02</td><td>Brake warning diagnosis</td><td>Waiting test</td></tr></tbody></table></div></section>
<section id="production" class="tab"><div class="table"><h2>Daily production</h2><p>Shift performance linked to equipment availability.</p><table><thead><tr><th>Date</th><th>Shift</th><th>Target</th><th>Actual</th><th>Availability</th><th>Utilisation</th></tr></thead><tbody><tr><td>29 Aug 2026</td><td>Day</td><td>10 000 t</td><td>8 460 t</td><td>83.3%</td><td>79.4%</td></tr><tr><td>28 Aug 2026</td><td>Day</td><td>10 000 t</td><td>9 180 t</td><td>91.7%</td><td>84.2%</td></tr><tr><td>27 Aug 2026</td><td>Day</td><td>10 000 t</td><td>9 640 t</td><td>94.1%</td><td>87.0%</td></tr></tbody></table></div></section>
<section id="documents" class="tab"><div class="cards"><div class="card"><small>DOCUMENTS</small><b>Purchase orders & quotations</b><span>Open module →</span></div><div class="card"><small>DOCUMENTS</small><b>OEM manuals & service sheets</b><span>Open module →</span></div><div class="card"><small>DOCUMENTS</small><b>Inspection documents</b><span>Open module →</span></div><div class="card"><small>DOCUMENTS</small><b>Job card attachments</b><span>Open module →</span></div><div class="card"><small>DOCUMENTS</small><b>Breakdown evidence</b><span>Open module →</span></div><div class="card"><small>DOCUMENTS</small><b>Maintenance certificates</b><span>Open module →</span></div></div></section>
<section id="reports" class="tab"><div class="cards"><div class="card"><small>REPORT</small><b>Daily operations report</b><span>Export →</span></div><div class="card"><small>REPORT</small><b>Weekly fleet summary</b><span>Export →</span></div><div class="card"><small>REPORT</small><b>Monthly availability report</b><span>Export →</span></div><div class="card"><small>REPORT</small><b>Downtime Pareto report</b><span>Export →</span></div><div class="card"><small>REPORT</small><b>Maintenance compliance</b><span>Export →</span></div><div class="card"><small>REPORT</small><b>Production vs target</b><span>Export →</span></div></div></section>
</div></main></div>
<script>
const titles={dashboard:'Operations Dashboard',fleet:'Fleet',breakdowns:'Breakdowns',maintenance:'Maintenance',workorders:'Work orders',production:'Production',documents:'Documents',reports:'Reports'};
function openTab(id){document.querySelectorAll('.tab').forEach(x=>x.classList.remove('active'));document.querySelectorAll('.nav button').forEach(x=>x.classList.remove('active'));document.getElementById(id).classList.add('active');const b=document.querySelector('[data-tab="'+id+'"]');if(b)b.classList.add('active');document.getElementById('pageTitle').textContent=titles[id]||'Contractor Workspace'}
document.querySelectorAll('.nav button').forEach(b=>b.addEventListener('click',()=>openTab(b.dataset.tab)));
</script></body></html>`;
}

const worker = {
  async fetch(request: Request, env: Env, ctx: ExecutionContext): Promise<Response> {
    const url = new URL(request.url);

    if (url.pathname === "/health") {
      return Response.json({
        ok: true,
        service: "tmm-asset-health",
        database: Boolean(env.DB),
        storage: Boolean(env.BUCKET),
        images: Boolean(env.IMAGES),
        time: new Date().toISOString(),
      });
    }

    if (url.pathname === "/contractor-demo" || url.pathname === "/contractor-demo/") {
      return new Response(contractorDemoHtml(), {
        status: 200,
        headers: {
          "content-type": "text/html; charset=utf-8",
          "cache-control": "no-store",
          "x-tmm-surface": "contractor-demo",
        },
      });
    }

    if (url.pathname === "/_vinext/image") {
      if (!env.IMAGES) {
        console.error("TMM_IMAGE_BINDING_MISSING", { pathname: url.pathname });
        return new Response("Image service is temporarily unavailable.", { status: 503 });
      }
      const allowedWidths = [...DEFAULT_DEVICE_SIZES, ...DEFAULT_IMAGE_SIZES];
      return handleImageOptimization(request, {
        fetchAsset: (path) => env.ASSETS.fetch(new Request(new URL(path, request.url))),
        transformImage: async (body, { width, format, quality }) => {
          const result = await env.IMAGES!.input(body).transform(width > 0 ? { width } : {}).output({ format, quality });
          return result.response();
        },
      }, allowedWidths);
    }

    try {
      return await handler.fetch(request, env, ctx);
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      const name = error instanceof Error ? error.name : "UnknownError";
      console.error("TMM_WORKER_RENDER_ERROR", { pathname: url.pathname, method: request.method, name, message });
      return new Response("TMM Asset Health is temporarily unavailable. The error has been logged for diagnosis.", {
        status: 500,
        headers: { "content-type": "text/plain; charset=utf-8" },
      });
    }
  },
};

export default worker;
