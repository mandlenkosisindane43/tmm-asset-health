import currentApp from "./router-trial-insights";

interface ExecutionContext {
  waitUntil(promise: Promise<unknown>): void;
  passThroughOnException(): void;
}
interface ScheduledController {
  scheduledTime: number;
  cron: string;
  noRetry(): void;
}
interface Env {
  DB: D1Database;
  [key: string]: unknown;
}
type Row = Record<string, unknown>;
type Session = { companyId: number };
type Kpi = {
  fleet: string;
  shift: number;
  planned: number;
  unplanned: number;
  required: number;
  available: number;
  operating: number;
  productive: number;
  tonnes: number;
  totalDowntime: number;
  availability: number | null;
  utilisation: number | null;
  effectiveUtilisation: number | null;
  productiveEfficiency: number | null;
  feedRate: number | null;
};

const COOKIE = "sas_contractor_v2";
const enc = new TextEncoder();

function text(v: unknown, max = 300) {
  return String(v ?? "").trim().slice(0, max);
}
function lower(v: unknown) {
  return text(v).toLowerCase();
}
function number(v: unknown, fallback = 0) {
  const n = Number(v);
  return Number.isFinite(n) ? n : fallback;
}
function esc(v: unknown) {
  return String(v ?? "").replace(
    /[&<>"']/g,
    (c) =>
      ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[
        c
      ] || c,
  );
}
function fmt(v: number | null, suffix = "", digits = 1) {
  if (v == null || !Number.isFinite(v)) return "—";
  return `${v.toLocaleString("en-ZA", { maximumFractionDigits: digits })}${suffix}`;
}
function getCookie(req: Request) {
  for (const part of (req.headers.get("cookie") || "").split(";")) {
    const i = part.indexOf("=");
    if (i > -1 && part.slice(0, i).trim() === COOKIE) return part.slice(i + 1).trim();
  }
  return "";
}
async function sha256(value: string) {
  return Array.from(
    new Uint8Array(await crypto.subtle.digest("SHA-256", enc.encode(value))),
    (b) => b.toString(16).padStart(2, "0"),
  ).join("");
}
async function first(env: Env, sql: string, binds: unknown[] = []) {
  try {
    return await env.DB.prepare(sql).bind(...binds).first<Row>();
  } catch {
    return null;
  }
}
async function all(env: Env, sql: string, binds: unknown[] = []) {
  try {
    return ((await env.DB.prepare(sql).bind(...binds).all<Row>()).results || []);
  } catch {
    return [];
  }
}
async function session(req: Request, env: Env): Promise<Session | null> {
  const token = getCookie(req);
  if (!token) return null;
  const row = await first(
    env,
    `SELECT s.company_id AS companyId,s.expires_at AS sessionExpires,
      a.status AS accountStatus,c.licence_status AS licenceStatus,c.expires_at AS licenceExpires,
      c.grace_days AS graceDays
     FROM contractor_sessions s
     JOIN contractor_accounts a ON a.id=s.account_id AND a.company_id=s.company_id
     JOIN companies c ON c.id=s.company_id
     WHERE s.token_hash=? LIMIT 1`,
    [await sha256(token)],
  );
  if (!row || lower(row.accountStatus) !== "active") return null;
  if (new Date(text(row.sessionExpires)).getTime() < Date.now()) return null;
  if (!["active", "trial"].includes(lower(row.licenceStatus))) return null;
  const end = new Date(text(row.licenceExpires)).getTime() + number(row.graceDays) * 86400000;
  if (Number.isFinite(end) && Date.now() > end) return null;
  return { companyId: number(row.companyId) };
}

function calc(row: Row): Kpi {
  const shift = Math.max(0, number(row.shiftHours ?? row.shift));
  const planned = Math.max(0, Math.min(shift, number(row.plannedDowntime ?? row.planned)));
  const unplanned = Math.max(0, Math.min(Math.max(0, shift - planned), number(row.unplannedDowntime ?? row.unplanned)));
  const operating = Math.max(0, number(row.operatingHours ?? row.operating));
  const productive = Math.max(0, number(row.productiveHours ?? row.productive));
  const tonnes = Math.max(0, number(row.tonnes));
  const required = Math.max(0, shift - planned);
  const available = Math.max(0, shift - planned - unplanned);
  return {
    fleet: text(row.fleet, 120),
    shift,
    planned,
    unplanned,
    required,
    available,
    operating,
    productive,
    tonnes,
    totalDowntime: planned + unplanned,
    // Approved TMM definitions:
    // Availability = (Shift - Planned DT - Unplanned DT) / (Shift - Planned DT)
    availability: required > 0 ? (available / required) * 100 : null,
    // Utilisation = Operating time / Available time
    utilisation: available > 0 ? (operating / available) * 100 : null,
    // Effective/Productive utilisation = Productive time / Shift time
    effectiveUtilisation: shift > 0 ? (productive / shift) * 100 : null,
    productiveEfficiency: operating > 0 ? (productive / operating) * 100 : null,
    feedRate: productive > 0 ? tonnes / productive : null,
  };
}

function overall(rows: Kpi[]) {
  const total = (key: keyof Kpi) => rows.reduce((a, r) => a + number(r[key]), 0);
  const shift = total("shift"), planned = total("planned"), unplanned = total("unplanned");
  const operating = total("operating"), productive = total("productive"), tonnes = total("tonnes");
  return calc({
    fleet: "Fleet",
    shiftHours: shift,
    plannedDowntime: planned,
    unplannedDowntime: unplanned,
    operatingHours: operating,
    productiveHours: productive,
    tonnes,
  });
}

function isoDate(d: Date) { return d.toISOString().slice(0, 10); }
function addDays(date: string, days: number) {
  const d = new Date(`${date}T00:00:00Z`); d.setUTCDate(d.getUTCDate() + days); return isoDate(d);
}
function mondayOf(date: string) {
  const d = new Date(`${date}T00:00:00Z`); const day = d.getUTCDay() || 7;
  d.setUTCDate(d.getUTCDate() - day + 1); return isoDate(d);
}
function nextMonth(month: string) {
  const d = new Date(`${month}-01T00:00:00Z`); d.setUTCMonth(d.getUTCMonth() + 1); return d.toISOString().slice(0, 7);
}
function validDate(v: string, fallback: string) { return /^\d{4}-\d{2}-\d{2}$/.test(v) ? v : fallback; }
function validMonth(v: string, fallback: string) { return /^\d{4}-\d{2}$/.test(v) ? v : fallback; }

function formulaPanel(o: Kpi) {
  return `<section class="sas-formula-standard" style="margin:12px 0;background:#f8fbfa;border:1px solid #d8e4df;border-radius:12px;padding:14px"><div style="display:flex;justify-content:space-between;gap:12px;align-items:start"><div><b style="font-size:13px">TMM KPI formula standard</b><p style="font-size:10px;color:#65746f;margin:4px 0 10px">The same definitions are used for the trial, daily, weekly and monthly performance views.</p></div><span style="font-size:9px;font-weight:900;background:#e8f6ee;color:#087548;border-radius:20px;padding:5px 8px">STANDARDISED</span></div><div class="sas-formula-grid" style="display:grid;grid-template-columns:repeat(4,1fr);gap:8px"><div style="background:#fff;border:1px solid #e1e9e5;border-radius:9px;padding:10px"><small style="font-weight:900;color:#087548">AVAILABILITY</small><b style="display:block;font-size:20px;margin:5px 0">${fmt(o.availability, "%")}</b><span style="font-size:9px;color:#65746f">(Shift − Planned DT − Unplanned DT) ÷ (Shift − Planned DT) × 100</span></div><div style="background:#fff;border:1px solid #e1e9e5;border-radius:9px;padding:10px"><small style="font-weight:900;color:#087548">UTILISATION</small><b style="display:block;font-size:20px;margin:5px 0">${fmt(o.utilisation, "%")}</b><span style="font-size:9px;color:#65746f">Operating time ÷ Available time × 100</span></div><div style="background:#fff;border:1px solid #e1e9e5;border-radius:9px;padding:10px"><small style="font-weight:900;color:#087548">TOTAL DOWNTIME</small><b style="display:block;font-size:20px;margin:5px 0">${fmt(o.totalDowntime, " h")}</b><span style="font-size:9px;color:#65746f">Planned downtime + Unplanned downtime</span></div><div style="background:#fff;border:1px solid #e1e9e5;border-radius:9px;padding:10px"><small style="font-weight:900;color:#087548">FEED RATE</small><b style="display:block;font-size:20px;margin:5px 0">${fmt(o.feedRate, " t/h")}</b><span style="font-size:9px;color:#65746f">Tonnes produced ÷ Productive hours</span></div></div><div style="margin-top:8px;font-size:9px;color:#65746f"><b>Effective utilisation:</b> ${fmt(o.effectiveUtilisation, "%")} = Productive time ÷ Shift time × 100 &nbsp; · &nbsp; <b>Productive efficiency:</b> ${fmt(o.productiveEfficiency, "%")} = Productive time ÷ Operating time × 100.</div><style>@media(max-width:850px){.sas-formula-grid{grid-template-columns:1fr 1fr!important}}@media(max-width:520px){.sas-formula-grid{grid-template-columns:1fr!important}}</style></section>`;
}

function machineTable(rows: Kpi[], title = "Fleet performance — standard KPI formulas") {
  const trs = [...rows].sort((a,b) => number(a.availability, 0) - number(b.availability, 0)).map(r =>
    `<tr><td><b>${esc(r.fleet)}</b></td><td>${fmt(r.shift," h")}</td><td>${fmt(r.planned," h")}</td><td>${fmt(r.unplanned," h")}</td><td>${fmt(r.available," h")}</td><td>${fmt(r.operating," h")}</td><td>${fmt(r.productive," h")}</td><td><b>${fmt(r.availability,"%")}</b></td><td>${fmt(r.utilisation,"%")}</td><td>${fmt(r.effectiveUtilisation,"%")}</td><td>${fmt(r.feedRate," t/h")}</td><td>${fmt(r.totalDowntime," h")}</td></tr>`
  ).join("");
  return `<div class="panel"><h2>${esc(title)}</h2><div style="overflow:auto"><table class="table" style="min-width:1050px"><thead><tr><th>Machine</th><th>Shift</th><th>Planned DT</th><th>Unplanned DT</th><th>Available</th><th>Operating</th><th>Productive</th><th>Availability</th><th>Utilisation</th><th>Effective util.</th><th>Feed rate</th><th>Total DT</th></tr></thead><tbody>${trs || `<tr><td colspan="12">No performance data for this period.</td></tr>`}</tbody></table></div></div>`;
}

function replaceDivAt(body: string, start: number, replacement: string) {
  if (start < 0) return body;
  const re = /<div\b[^>]*>|<\/div>/g;
  re.lastIndex = start;
  let depth = 0, match: RegExpExecArray | null;
  while ((match = re.exec(body))) {
    if (match[0].startsWith("</")) depth--; else depth++;
    if (depth === 0) return body.slice(0, start) + replacement + body.slice(re.lastIndex);
  }
  return body;
}
function replacePanel(body: string, heading: string, replacement: string) {
  const h = `<h2>${heading}</h2>`;
  const hi = body.indexOf(h);
  if (hi < 0) return body;
  const start = body.lastIndexOf("<div", hi);
  return replaceDivAt(body, start, replacement);
}
function replaceClassDiv(body: string, className: string, replacement: string) {
  const start = body.indexOf(`<div class="${className}`);
  return replaceDivAt(body, start, replacement);
}

function ranking(rows: Kpi[]) {
  const best = [...rows].sort((a,b)=>number(b.availability)-number(a.availability) || a.unplanned-b.unplanned).slice(0,5);
  const low = [...rows].sort((a,b)=>number(a.availability)-number(b.availability) || b.unplanned-a.unplanned).slice(0,5);
  const card = (title:string, list:Kpi[], bad=false) => `<section class="panel" style="margin:0"><h2>${esc(title)}</h2>${list.map((r,i)=>`<div style="display:grid;grid-template-columns:28px 1fr 80px 85px;gap:8px;padding:9px 0;border-top:${i?"1px solid #e8eeeb":"0"};align-items:center"><b>${i+1}</b><span><b>${esc(r.fleet)}</b></span><b style="color:${bad?"#b42318":"#147a45"}">${fmt(r.availability,"%")}</b><span>${fmt(r.unplanned," h")} DT</span></div>`).join("")}</section>`;
  return `<div class="trial-performance-insights" style="display:grid;grid-template-columns:1fr 1fr;gap:12px;margin-top:12px">${card("Best performing machines — previous month",best)}${card("Lowest performing machines — previous month",low,true)}</div>`;
}

function dayNumber(date: string) {
  const n = Number(date.slice(8,10)); return Number.isFinite(n) ? n : 1;
}
function daysInPeriod(start: string, end: string) {
  return Math.max(1, Math.round((new Date(`${end}T00:00:00Z`).getTime() - new Date(`${start}T00:00:00Z`).getTime()) / 86400000) + 1);
}
function trendPanel(rows: (Kpi & { date: string })[], start: string, end: string) {
  if (!rows.length) return `<div class="panel chart"><h2>Daily availability trend</h2><p class="empty">No trend data yet.</p></div>`;
  const totalDays = daysInPeriod(start,end), left=42, right=700, top=24, bottom=155;
  const x = (date:string) => left + ((dayNumber(date)-dayNumber(start)) / Math.max(1,totalDays-1)) * (right-left);
  const y = (v:number|null) => bottom - (Math.max(0,Math.min(100,number(v))) / 100) * (bottom-top);
  const segments = rows.map((r,i)=>({
    ...r,
    rangeStart:r.date,
    rangeEnd:i+1<rows.length?rows[i+1].date:end,
  }));
  const lines = segments.map(s=>`<line x1="${x(s.rangeStart)}" y1="${y(s.availability)}" x2="${x(s.rangeEnd)}" y2="${y(s.availability)}" stroke="#10975b" stroke-width="4"/><circle cx="${x(s.rangeStart)}" cy="${y(s.availability)}" r="4" fill="#e6a800"/><text x="${(x(s.rangeStart)+x(s.rangeEnd))/2}" y="${Math.max(13,y(s.availability)-8)}" text-anchor="middle" font-size="9" font-weight="800" fill="#334155">${fmt(s.availability,"%")}</text>`).join("");
  const labels = segments.map(s=>`<span style="display:inline-block;margin:3px 5px 3px 0;padding:5px 7px;border-radius:14px;background:#f3f6f5;font-size:9px"><b>${dayNumber(s.rangeStart)}–${dayNumber(s.rangeEnd)} ${esc(start.slice(5,7)==="08"?"Aug":"")}</b> · ${fmt(s.availability,"%")}</span>`).join("");
  return `<div class="panel chart"><h2>Daily availability trend — full month ranges</h2><p class="muted">Each value applies from that report date until the next report date; the final range extends to the month end.</p><svg viewBox="0 0 740 185" role="img" aria-label="Availability range trend"><line x1="${left}" y1="${bottom}" x2="${right}" y2="${bottom}" stroke="#dce5e1"/><line x1="${left}" y1="${top}" x2="${left}" y2="${bottom}" stroke="#dce5e1"/>${lines}<text x="${left}" y="176" font-size="8" fill="#64748b">${esc(start)}</text><text x="${right}" y="176" text-anchor="end" font-size="8" fill="#64748b">${esc(end)}</text></svg><div style="margin-top:5px">${labels}</div></div>`;
}

async function trialRows(env: Env, companyId: number) {
  const batch = await first(env, `SELECT id,period_start AS start,period_end AS end FROM demo_import_batches_v1 WHERE company_id=? ORDER BY id DESC LIMIT 1`, [companyId]);
  if (!batch) return { batch:null as Row|null, machines:[] as Kpi[], days:[] as (Kpi & {date:string})[] };
  const machinesRaw = await all(env, `SELECT fleet_number AS fleet,SUM(shift_hours) AS shiftHours,SUM(planned_downtime) AS plannedDowntime,SUM(unplanned_downtime) AS unplannedDowntime,SUM(operating_hours) AS operatingHours,SUM(productive_hours) AS productiveHours,SUM(tonnes) AS tonnes FROM demo_import_records_v1 WHERE company_id=? AND batch_id=? GROUP BY fleet_number`, [companyId, number(batch.id)]);
  const daysRaw = await all(env, `SELECT report_date AS date,SUM(shift_hours) AS shiftHours,SUM(planned_downtime) AS plannedDowntime,SUM(unplanned_downtime) AS unplannedDowntime,SUM(operating_hours) AS operatingHours,SUM(productive_hours) AS productiveHours,SUM(tonnes) AS tonnes FROM demo_import_records_v1 WHERE company_id=? AND batch_id=? GROUP BY report_date ORDER BY report_date`, [companyId, number(batch.id)]);
  return { batch, machines:machinesRaw.map(calc), days:daysRaw.map(r=>Object.assign(calc(r),{date:text(r.date,10)})) };
}

async function liveRows(env: Env, companyId:number, start:string, end:string) {
  const raw = await all(env, `SELECT fleet_number AS fleet,SUM(shift_hours) AS shiftHours,SUM(planned_downtime) AS plannedDowntime,SUM(unplanned_downtime) AS unplannedDowntime,SUM(operating_hours) AS operatingHours,SUM(productive_hours) AS productiveHours,SUM(tonnes) AS tonnes FROM production_records WHERE company_id=? AND report_date>=? AND report_date<? GROUP BY fleet_number`, [companyId,start,end]);
  return raw.map(calc);
}

function csvCell(v:unknown) { const s=String(v??""); return /[",\r\n]/.test(s)?`"${s.replace(/"/g,'""')}"`:s; }
function csvResponse(rows:unknown[][],name:string) {
  return new Response(rows.map(r=>r.map(csvCell).join(",")).join("\r\n"),{headers:{"content-type":"text/csv; charset=utf-8","content-disposition":`attachment; filename="${name}"`,"cache-control":"private, no-store"}});
}

async function standardExport(req:Request,env:Env) {
  const url=new URL(req.url); if(url.pathname!=="/contractor-reports/export") return null;
  const type=lower(url.searchParams.get("type")); if(!["daily","weekly","monthly"].includes(type)) return null;
  const s=await session(req,env); if(!s) return null;
  const now=isoDate(new Date()); let start="",end="",label="";
  if(type==="daily"){start=validDate(url.searchParams.get("date")||"",now);end=addDays(start,1);label=start;}
  else if(type==="weekly"){start=mondayOf(validDate(url.searchParams.get("date")||"",now));end=addDays(start,7);label=`${start}-to-${addDays(end,-1)}`;}
  else {const month=validMonth(url.searchParams.get("month")||"",new Date().toISOString().slice(0,7));start=`${month}-01`;end=`${nextMonth(month)}-01`;label=month;}
  const rows=await liveRows(env,s.companyId,start,end);
  return csvResponse([["TMM KPI Formula Standard",label],["Machine","Shift h","Planned DT h","Unplanned DT h","Available h","Operating h","Productive h","Availability %","Utilisation %","Effective utilisation %","Productive efficiency %","Feed rate t/h","Total downtime h"],...rows.map(r=>[r.fleet,r.shift,r.planned,r.unplanned,r.available,r.operating,r.productive,r.availability==null?"":r.availability.toFixed(1),r.utilisation==null?"":r.utilisation.toFixed(1),r.effectiveUtilisation==null?"":r.effectiveUtilisation.toFixed(1),r.productiveEfficiency==null?"":r.productiveEfficiency.toFixed(1),r.feedRate==null?"":r.feedRate.toFixed(1),r.totalDowntime])],`tmm-${type}-${label}-standard-kpis.csv`);
}

async function enhanceHtml(req:Request,env:Env,response:Response) {
  if(req.method!=="GET"||response.status!==200||!(response.headers.get("content-type")||"").includes("text/html")) return response;
  const s=await session(req,env); if(!s) return response;
  const url=new URL(req.url); let body=await response.text();
  try {
    if(url.pathname==="/trial-demo"){
      const data=await trialRows(env,s.companyId); if(!data.batch||!data.machines.length) return new Response(body,{status:response.status,headers:response.headers});
      const o=overall(data.machines);
      body=body.replace(/(<small>Availability<\/small><b>)[^<]*(<\/b>)/,`$1${fmt(o.availability,"%")} $2`);
      body=body.replace(/(<small>Utilisation<\/small><b>)[^<]*(<\/b>)/,`$1${fmt(o.utilisation,"%")} $2`);
      body=replacePanel(body,"Daily availability trend",trendPanel(data.days,text(data.batch.start,10),text(data.batch.end,10)));
      body=replacePanel(body,"Daily availability trend — full month ranges",trendPanel(data.days,text(data.batch.start,10),text(data.batch.end,10)));
      body=replacePanel(body,"Machine comparison",machineTable(data.machines,"Machine comparison — standard formulas"));
      body=replaceClassDiv(body,"trial-performance-insights",ranking(data.machines));
      const marker='<div class="grid">'; if(body.includes(marker)) body=body.replace(marker,`${formulaPanel(o)}${marker}`);
      return new Response(body,{status:response.status,headers:response.headers});
    }
    if(url.pathname==="/contractor-reports"){
      const type=lower(url.searchParams.get("type")); if(!["daily","weekly","monthly"].includes(type)) return new Response(body,{status:response.status,headers:response.headers});
      const now=isoDate(new Date()); let start="",end="";
      if(type==="daily"){start=validDate(url.searchParams.get("date")||"",now);end=addDays(start,1);}
      else if(type==="weekly"){start=mondayOf(validDate(url.searchParams.get("date")||"",now));end=addDays(start,7);}
      else {const month=validMonth(url.searchParams.get("month")||"",new Date().toISOString().slice(0,7));start=`${month}-01`;end=`${nextMonth(month)}-01`;}
      const rows=await liveRows(env,s.companyId,start,end); if(!rows.length) return new Response(body,{status:response.status,headers:response.headers});
      const o=overall(rows);
      body=body.replace(/(<small>Availability<\/small><b>)[^<]*(<\/b>)/,`$1${fmt(o.availability,"%")} $2`);
      const heading=type==="daily"?"Production & equipment performance":"Fleet performance";
      body=replacePanel(body,heading,machineTable(rows,type==="daily"?"Production & equipment performance — standard formulas":"Fleet performance — standard formulas"));
      const metricsEnd='</div><div class="panel">';
      const at=body.indexOf(metricsEnd); if(at>-1) body=body.slice(0,at+6)+formulaPanel(o)+body.slice(at+6);
      return new Response(body,{status:response.status,headers:response.headers});
    }
    if(url.pathname==="/contractor" && (!url.searchParams.get("view") || url.searchParams.get("view")==="dashboard")){
      const month=new Date().toISOString().slice(0,7), rows=await liveRows(env,s.companyId,`${month}-01`,`${nextMonth(month)}-01`);
      if(rows.length){const o=overall(rows);body=body.replace(/(<small>Monthly Availability<\/small><b>)[^<]*(<\/b>)/,`$1${fmt(o.availability,"%")} $2`);}
      return new Response(body,{status:response.status,headers:response.headers});
    }
  } catch(error){console.error("KPI formula enhancement failed",error);}
  return new Response(body,{status:response.status,headers:response.headers});
}

export default {
  async fetch(req:Request,env:Env,ctx:ExecutionContext):Promise<Response>{
    try { const exported=await standardExport(req,env); if(exported) return exported; } catch(error){ console.error("KPI export standard failed",error); }
    const response=await currentApp.fetch(req,env as never,ctx as never);
    try { return await enhanceHtml(req,env,response); } catch(error){ console.error("KPI standard failed safely",error); return response; }
  },
  async scheduled(controller:ScheduledController,env:Env,ctx:ExecutionContext){
    return currentApp.scheduled(controller as never,env as never,ctx as never);
  },
};
