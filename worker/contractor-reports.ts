export interface ContractorReportsEnv {
  DB: D1Database;
}

type ReportSession = {
  companyId: number;
  accountId: number;
  fullName: string;
  email: string;
  role: string;
  companyName: string;
};

const COOKIE = "sas_contractor_v2";
const enc = new TextEncoder();

function esc(value: unknown) {
  return String(value ?? "").replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c] || c));
}

function csvCell(value: unknown) {
  const s = String(value ?? "");
  return /[",\r\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
}

function csv(rows: unknown[][], filename: string) {
  return new Response(rows.map((r) => r.map(csvCell).join(",")).join("\r\n"), {
    headers: {
      "content-type": "text/csv; charset=utf-8",
      "content-disposition": `attachment; filename="${filename.replace(/[^a-zA-Z0-9._-]/g, "-")}"`,
      "cache-control": "private, no-store",
    },
  });
}

function html(title: string, body: string, status = 200) {
  return new Response(`<!doctype html><html><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>${esc(title)}</title><style>
  *{box-sizing:border-box}body{margin:0;background:#f4f7fb;color:#14213d;font-family:Arial,sans-serif}.top{background:#0c1b33;color:#fff;padding:17px 24px;display:flex;align-items:center;justify-content:space-between;gap:12px}.top b{font-size:18px}.top small{display:block;color:#9fb2c9;margin-top:3px}.top a{color:#fff;text-decoration:none;border:1px solid #526985;border-radius:8px;padding:8px 11px;font-size:12px}.wrap{max-width:1280px;margin:0 auto;padding:22px}.hero{background:linear-gradient(120deg,#123c66,#17629b);color:#fff;border-radius:16px;padding:22px;margin-bottom:16px}.hero h1{margin:4px 0 6px;font-size:25px}.hero p{margin:0;color:#d5e6f5;font-size:13px}.grid{display:grid;grid-template-columns:repeat(3,1fr);gap:12px}.card,.panel,.metric{background:#fff;border:1px solid #dce5ef;border-radius:12px;padding:16px}.card{text-decoration:none;color:#14213d;min-height:124px}.card:hover{border-color:#83b8e2}.card small{display:block;color:#6e7e94;font-size:10px;font-weight:800}.card b{display:block;margin:8px 0;font-size:16px}.card span{font-size:12px;color:#1267b3;font-weight:800}.metrics{display:grid;grid-template-columns:repeat(4,1fr);gap:10px;margin:14px 0}.metric small{display:block;color:#74849a;font-size:10px;font-weight:800}.metric b{display:block;font-size:24px;margin-top:7px}.panel{margin-top:14px}.panel h2{margin:0 0 12px}.toolbar{display:flex;gap:8px;align-items:end;flex-wrap:wrap;margin-bottom:14px}.toolbar label{display:grid;gap:5px;font-size:11px;font-weight:800}.toolbar input,.toolbar select{padding:9px;border:1px solid #cbd5e1;border-radius:8px;background:#fff}.btn{display:inline-block;border:0;background:#1267b3;color:#fff;padding:10px 12px;border-radius:8px;font-weight:800;text-decoration:none;font-size:12px;cursor:pointer}.btn.secondary{background:#fff;color:#28405e;border:1px solid #cbd5e1}.table{overflow:auto}table{border-collapse:collapse;width:100%;font-size:12px}th{background:#f7f9fc;color:#607188;text-align:left;padding:10px;white-space:nowrap}td{padding:10px;border-top:1px solid #edf1f5;white-space:nowrap}.bar{height:11px;background:#e7edf4;border-radius:999px;overflow:hidden;min-width:150px}.bar span{display:block;height:100%;background:#1b73b9}.danger{color:#b42318}.warn{color:#9a5a00}.good{color:#147a45}.note{font-size:11px;color:#65758a;line-height:1.5}.settings{display:flex;gap:9px;align-items:end;flex-wrap:wrap}.settings label{display:grid;gap:5px;font-size:11px;font-weight:800}.settings input{padding:9px;border:1px solid #cbd5e1;border-radius:8px}.empty{color:#74849a;padding:15px 0}.pareto{display:grid;gap:8px}.pareto-row{display:grid;grid-template-columns:minmax(170px,1fr) 3fr 85px 75px;gap:10px;align-items:center;font-size:12px}.foot{margin:18px 0;color:#7b899c;font-size:10px;text-align:center}@media(max-width:900px){.grid{grid-template-columns:1fr 1fr}.metrics{grid-template-columns:1fr 1fr}.pareto-row{grid-template-columns:1fr}.wrap{padding:14px}}@media print{body{background:#fff}.top,.no-print,.grid{display:none!important}.wrap{max-width:none;padding:0}.panel,.metric{box-shadow:none;border-color:#bbb}.hero{background:#fff;color:#111;border:1px solid #bbb}.hero p{color:#444}}
  </style></head><body>${body}</body></html>`, { status, headers: { "content-type": "text/html; charset=utf-8", "cache-control": "private, no-store", "x-frame-options": "DENY", "referrer-policy": "same-origin", "content-security-policy": "default-src 'self'; style-src 'self' 'unsafe-inline'; script-src 'self' 'unsafe-inline'; frame-ancestors 'none'; base-uri 'self'" } });
}

async function sha256(value: string) {
  const bytes = new Uint8Array(await crypto.subtle.digest("SHA-256", enc.encode(value)));
  return Array.from(bytes, (b) => b.toString(16).padStart(2, "0")).join("");
}

function cookie(request: Request) {
  const raw = request.headers.get("cookie") || "";
  for (const part of raw.split(";")) {
    const i = part.indexOf("=");
    if (i > -1 && part.slice(0, i).trim() === COOKIE) return part.slice(i + 1).trim();
  }
  return "";
}

async function session(request: Request, env: ContractorReportsEnv): Promise<ReportSession | null> {
  const token = cookie(request);
  if (!token) return null;
  const row = await env.DB.prepare(`SELECT s.company_id AS companyId,s.account_id AS accountId,s.expires_at AS sessionExpires,
      a.full_name AS fullName,a.email,a.role,a.status AS accountStatus,c.name AS companyName,c.licence_status AS licenceStatus,c.expires_at AS licenceExpires,c.grace_days AS graceDays
    FROM contractor_sessions s JOIN contractor_accounts a ON a.id=s.account_id AND a.company_id=s.company_id JOIN companies c ON c.id=s.company_id
    WHERE s.token_hash=? LIMIT 1`).bind(await sha256(token)).first<Record<string, unknown>>();
  if (!row || String(row.accountStatus) !== "active") return null;
  if (new Date(String(row.sessionExpires)).getTime() < Date.now()) return null;
  const status = String(row.licenceStatus || "").toLowerCase();
  const end = new Date(String(row.licenceExpires)).getTime() + Number(row.graceDays || 0) * 86400000;
  if (!["active", "trial"].includes(status) || Date.now() > end) return null;
  return { companyId: Number(row.companyId), accountId: Number(row.accountId), fullName: String(row.fullName), email: String(row.email), role: String(row.role), companyName: String(row.companyName) };
}

async function ensureSettings(env: ContractorReportsEnv) {
  await env.DB.prepare(`CREATE TABLE IF NOT EXISTS contractor_report_settings (
    company_id INTEGER PRIMARY KEY,
    daily_production_target REAL NOT NULL DEFAULT 0,
    availability_target REAL NOT NULL DEFAULT 90,
    updated_at TEXT NOT NULL
  )`).run();
}

async function getSettings(env: ContractorReportsEnv, companyId: number) {
  await ensureSettings(env);
  const row = await env.DB.prepare("SELECT daily_production_target AS dailyTarget,availability_target AS availabilityTarget FROM contractor_report_settings WHERE company_id=? LIMIT 1").bind(companyId).first<Record<string, unknown>>();
  return { dailyTarget: Number(row?.dailyTarget || 0), availabilityTarget: Number(row?.availabilityTarget || 90) };
}

function isoDate(d: Date) { return d.toISOString().slice(0, 10); }
function currentMonth() { return new Date().toISOString().slice(0, 7); }
function validDate(value: string, fallback: string) { return /^\d{4}-\d{2}-\d{2}$/.test(value) ? value : fallback; }
function validMonth(value: string, fallback: string) { return /^\d{4}-\d{2}$/.test(value) ? value : fallback; }
function addDays(date: string, days: number) { const d = new Date(date + "T00:00:00Z"); d.setUTCDate(d.getUTCDate() + days); return isoDate(d); }
function mondayOf(date: string) { const d = new Date(date + "T00:00:00Z"); const day = d.getUTCDay() || 7; d.setUTCDate(d.getUTCDate() - day + 1); return isoDate(d); }
function nextMonth(month: string) { const d = new Date(month + "-01T00:00:00Z"); d.setUTCMonth(d.getUTCMonth() + 1); return d.toISOString().slice(0, 7); }
function pct(n: number) { return Number.isFinite(n) ? n.toFixed(1) + "%" : "0.0%"; }
function num(n: unknown, digits = 1) { const x = Number(n || 0); return Number.isFinite(x) ? x.toLocaleString(undefined, { maximumFractionDigits: digits }) : "0"; }

function chrome(s: ReportSession, content: string) {
  return `<div class="top"><div><b>TMM Asset Health · Reports</b><small>${esc(s.companyName)} · ${esc(s.fullName)}</small></div><div><a href="/contractor">← Contractor workspace</a></div></div><div class="wrap">${content}<div class="foot">Sindane Asset Solutions · Tenant-isolated contractor reporting</div></div>`;
}

function reportCards() {
  const cards = [
    ["daily", "DAILY", "Daily Operations Report", "Production, availability and breakdown activity for one day."],
    ["weekly", "WEEKLY", "Weekly Fleet Summary", "Seven-day machine performance grouped by fleet number."],
    ["monthly", "MONTHLY", "Monthly Availability", "Monthly operating hours, downtime and physical availability."],
    ["pareto", "DOWNTIME", "Downtime Pareto", "Rank the systems/components causing the most downtime."],
    ["maintenance", "MAINTENANCE", "Maintenance Status", "Service-hour position and machines approaching maintenance."],
    ["production", "PRODUCTION", "Production vs Target", "Daily tonnes compared with the contractor production target."],
  ];
  return `<div class="grid">${cards.map((x) => `<a class="card" href="/contractor-reports?type=${x[0]}"><small>${x[1]}</small><b>${x[2]}</b><p class="note">${x[3]}</p><span>Open report →</span></a>`).join("")}</div>`;
}

async function reportHome(env: ContractorReportsEnv, s: ReportSession) {
  const settings = await getSettings(env, s.companyId);
  const body = chrome(s, `<div class="hero"><small>LIVE CONTRACTOR REPORTING</small><h1>Reports Centre</h1><p>All calculations and exports below use only ${esc(s.companyName)} data.</p></div>${reportCards()}<div class="panel"><h2>Report settings</h2><form class="settings no-print" method="post" action="/contractor-reports/settings"><label>Daily production target (t)<input name="dailyTarget" type="number" min="0" step="0.01" value="${esc(settings.dailyTarget)}"></label><label>Availability target (%)<input name="availabilityTarget" type="number" min="0" max="100" step="0.1" value="${esc(settings.availabilityTarget)}"></label><button class="btn" type="submit">Save targets</button></form><p class="note">These targets are company-specific. They are used in Production vs Target and KPI comparisons.</p></div>`);
  return html("Contractor Reports", body);
}

async function dailyReport(env: ContractorReportsEnv, s: ReportSession, url: URL, asCsv: boolean) {
  const date = validDate(url.searchParams.get("date") || "", isoDate(new Date()));
  const next = addDays(date, 1);
  const rows = (await env.DB.prepare(`SELECT fleet_number AS fleet,shift_hours AS shiftHours,planned_downtime AS plannedDowntime,unplanned_downtime AS unplannedDowntime,operating_hours AS operatingHours,productive_hours AS productiveHours,tonnes FROM production_records WHERE company_id=? AND report_date=? ORDER BY fleet_number,id`).bind(s.companyId, date).all<Record<string, unknown>>()).results;
  const breakdowns = (await env.DB.prepare(`SELECT fleet_number AS fleet,severity,system_name AS system,component,description,downtime_hours AS downtimeHours,status FROM events WHERE company_id=? AND opened_at>=? AND opened_at<? ORDER BY downtime_hours DESC,id DESC`).bind(s.companyId, date + "T00:00:00.000Z", next + "T00:00:00.000Z").all<Record<string, unknown>>()).results;
  const tonnes = rows.reduce((a,r) => a + Number(r.tonnes || 0), 0), scheduled = rows.reduce((a,r) => a + Math.max(0, Number(r.shiftHours || 0)-Number(r.plannedDowntime || 0)), 0), operating = rows.reduce((a,r) => a + Number(r.operatingHours || 0), 0), downtime = rows.reduce((a,r) => a + Number(r.unplannedDowntime || 0), 0), availability = scheduled ? operating / scheduled * 100 : 0;
  if (asCsv) return csv([["Daily Operations Report", s.companyName, date],["Fleet","Shift h","Planned downtime h","Unplanned downtime h","Operating h","Productive h","Tonnes"],...rows.map(r=>[r.fleet,r.shiftHours,r.plannedDowntime,r.unplannedDowntime,r.operatingHours,r.productiveHours,r.tonnes]),[],["Breakdowns"],["Fleet","Severity","System","Component","Description","Downtime h","Status"],...breakdowns.map(r=>[r.fleet,r.severity,r.system,r.component,r.description,r.downtimeHours,r.status])], `daily-operations-${date}.csv`);
  const table = rows.length ? `<div class="table"><table><thead><tr><th>Fleet</th><th>Shift h</th><th>Planned DT</th><th>Unplanned DT</th><th>Operating h</th><th>Tonnes</th><th>Availability</th></tr></thead><tbody>${rows.map(r=>{const sch=Math.max(0,Number(r.shiftHours||0)-Number(r.plannedDowntime||0));const av=sch?Number(r.operatingHours||0)/sch*100:0;return `<tr><td>${esc(r.fleet)}</td><td>${num(r.shiftHours)}</td><td>${num(r.plannedDowntime)}</td><td>${num(r.unplannedDowntime)}</td><td>${num(r.operatingHours)}</td><td>${num(r.tonnes)}</td><td>${pct(av)}</td></tr>`}).join("")}</tbody></table></div>` : `<p class="empty">No production records for this date.</p>`;
  const bd = breakdowns.length ? `<div class="table"><table><thead><tr><th>Fleet</th><th>Severity</th><th>System</th><th>Component</th><th>Description</th><th>Downtime h</th><th>Status</th></tr></thead><tbody>${breakdowns.map(r=>`<tr><td>${esc(r.fleet)}</td><td>${esc(r.severity)}</td><td>${esc(r.system)}</td><td>${esc(r.component)}</td><td>${esc(r.description)}</td><td>${num(r.downtimeHours)}</td><td>${esc(r.status)}</td></tr>`).join("")}</tbody></table></div>` : `<p class="empty">No breakdowns opened on this date.</p>`;
  const content = `<div class="hero"><small>DAILY OPERATIONS</small><h1>${esc(s.companyName)}</h1><p>Report date: ${esc(date)}</p></div><form class="toolbar no-print" method="get"><input type="hidden" name="type" value="daily"><label>Date<input type="date" name="date" value="${esc(date)}"></label><button class="btn">Refresh</button><a class="btn secondary" href="/contractor-reports/export?type=daily&date=${encodeURIComponent(date)}">Download CSV</a><button class="btn secondary" type="button" onclick="window.print()">Print / PDF</button></form><div class="metrics"><div class="metric"><small>Production</small><b>${num(tonnes)} t</b></div><div class="metric"><small>Availability</small><b>${pct(availability)}</b></div><div class="metric"><small>Unplanned downtime</small><b>${num(downtime)} h</b></div><div class="metric"><small>Breakdowns opened</small><b>${breakdowns.length}</b></div></div><div class="panel"><h2>Production & equipment performance</h2>${table}</div><div class="panel"><h2>Breakdown activity</h2>${bd}</div>`;
  return html("Daily Operations Report", chrome(s, content));
}

async function periodFleetReport(env: ContractorReportsEnv, s: ReportSession, type: "weekly"|"monthly", url: URL, asCsv: boolean) {
  const now = isoDate(new Date());
  let start: string, end: string, label: string;
  if (type === "weekly") { const anchor=validDate(url.searchParams.get("date")||"",now); start=mondayOf(anchor); end=addDays(start,7); label=`Week ${start} to ${addDays(end,-1)}`; }
  else { const month=validMonth(url.searchParams.get("month")||"",currentMonth()); start=month+"-01"; end=nextMonth(month)+"-01"; label=month; }
  const rows=(await env.DB.prepare(`SELECT fleet_number AS fleet,COUNT(*) AS records,SUM(shift_hours) AS shiftHours,SUM(planned_downtime) AS plannedDowntime,SUM(unplanned_downtime) AS unplannedDowntime,SUM(operating_hours) AS operatingHours,SUM(productive_hours) AS productiveHours,SUM(tonnes) AS tonnes FROM production_records WHERE company_id=? AND report_date>=? AND report_date<? GROUP BY fleet_number ORDER BY fleet_number`).bind(s.companyId,start,end).all<Record<string,unknown>>()).results;
  const enriched=rows.map(r=>{const scheduled=Math.max(0,Number(r.shiftHours||0)-Number(r.plannedDowntime||0));return {...r,availability:scheduled?Number(r.operatingHours||0)/scheduled*100:0};});
  if(asCsv)return csv([[type==="weekly"?"Weekly Fleet Summary":"Monthly Availability",s.companyName,label],["Fleet","Records","Shift h","Planned DT h","Unplanned DT h","Operating h","Tonnes","Availability %"],...enriched.map(r=>[r.fleet,r.records,r.shiftHours,r.plannedDowntime,r.unplannedDowntime,r.operatingHours,r.tonnes,Number(r.availability).toFixed(1)])],`${type}-${start}.csv`);
  const table=enriched.length?`<div class="table"><table><thead><tr><th>Fleet</th><th>Records</th><th>Shift h</th><th>Planned DT</th><th>Unplanned DT</th><th>Operating h</th><th>Tonnes</th><th>Availability</th></tr></thead><tbody>${enriched.map(r=>`<tr><td>${esc(r.fleet)}</td><td>${esc(r.records)}</td><td>${num(r.shiftHours)}</td><td>${num(r.plannedDowntime)}</td><td>${num(r.unplannedDowntime)}</td><td>${num(r.operatingHours)}</td><td>${num(r.tonnes)}</td><td>${pct(Number(r.availability))}</td></tr>`).join("")}</tbody></table></div>`:`<p class="empty">No production records in this period.</p>`;
  const tonnes=enriched.reduce((a,r)=>a+Number(r.tonnes||0),0), downtime=enriched.reduce((a,r)=>a+Number(r.unplannedDowntime||0),0), scheduled=enriched.reduce((a,r)=>a+Math.max(0,Number(r.shiftHours||0)-Number(r.plannedDowntime||0)),0), operating=enriched.reduce((a,r)=>a+Number(r.operatingHours||0),0), av=scheduled?operating/scheduled*100:0;
  const controls=type==="weekly"?`<label>Week containing<input type="date" name="date" value="${esc(start)}"></label>`:`<label>Month<input type="month" name="month" value="${esc(start.slice(0,7))}"></label>`;
  const qp=type==="weekly"?`date=${encodeURIComponent(start)}`:`month=${encodeURIComponent(start.slice(0,7))}`;
  const content=`<div class="hero"><small>${type.toUpperCase()}</small><h1>${type==="weekly"?"Weekly Fleet Summary":"Monthly Availability"}</h1><p>${esc(label)}</p></div><form class="toolbar no-print" method="get"><input type="hidden" name="type" value="${type}">${controls}<button class="btn">Refresh</button><a class="btn secondary" href="/contractor-reports/export?type=${type}&${qp}">Download CSV</a><button class="btn secondary" type="button" onclick="window.print()">Print / PDF</button></form><div class="metrics"><div class="metric"><small>Production</small><b>${num(tonnes)} t</b></div><div class="metric"><small>Availability</small><b>${pct(av)}</b></div><div class="metric"><small>Unplanned downtime</small><b>${num(downtime)} h</b></div><div class="metric"><small>Fleet with records</small><b>${enriched.length}</b></div></div><div class="panel"><h2>Fleet performance</h2>${table}</div>`;
  return html(type==="weekly"?"Weekly Fleet Summary":"Monthly Availability",chrome(s,content));
}

async function paretoReport(env: ContractorReportsEnv,s:ReportSession,url:URL,asCsv:boolean){
  const month=validMonth(url.searchParams.get("month")||"",currentMonth()),start=month+"-01",end=nextMonth(month)+"-01";
  const rows=(await env.DB.prepare(`SELECT COALESCE(NULLIF(component,''),NULLIF(system_name,''),'Unclassified') AS cause,COUNT(*) AS failures,SUM(downtime_hours) AS downtime FROM events WHERE company_id=? AND opened_at>=? AND opened_at<? GROUP BY cause ORDER BY downtime DESC,failures DESC LIMIT 30`).bind(s.companyId,start+"T00:00:00.000Z",end+"T00:00:00.000Z").all<Record<string,unknown>>()).results;
  const total=rows.reduce((a,r)=>a+Number(r.downtime||0),0);let cumulative=0;const data=rows.map(r=>{const share=total?Number(r.downtime||0)/total*100:0;cumulative+=share;return {...r,share,cumulative};});
  if(asCsv)return csv([["Downtime Pareto",s.companyName,month],["Cause / component","Failures","Downtime h","Share %","Cumulative %"],...data.map(r=>[r.cause,r.failures,r.downtime,Number(r.share).toFixed(1),Number(r.cumulative).toFixed(1)])],`downtime-pareto-${month}.csv`);
  const rowsHtml=data.length?`<div class="pareto">${data.map(r=>`<div class="pareto-row"><b>${esc(r.cause)}</b><div class="bar"><span style="width:${Math.min(100,Number(r.share))}%"></span></div><span>${num(r.downtime)} h</span><span>${pct(Number(r.cumulative))}</span></div>`).join("")}</div>`:`<p class="empty">No breakdown downtime recorded in this month.</p>`;
  const content=`<div class="hero"><small>DOWNTIME ANALYSIS</small><h1>Downtime Pareto</h1><p>Ranks components by total recorded downtime for ${esc(month)}.</p></div><form class="toolbar no-print"><input type="hidden" name="type" value="pareto"><label>Month<input type="month" name="month" value="${esc(month)}"></label><button class="btn">Refresh</button><a class="btn secondary" href="/contractor-reports/export?type=pareto&month=${encodeURIComponent(month)}">Download CSV</a><button class="btn secondary" type="button" onclick="window.print()">Print / PDF</button></form><div class="metrics"><div class="metric"><small>Total downtime</small><b>${num(total)} h</b></div><div class="metric"><small>Failure categories</small><b>${data.length}</b></div><div class="metric"><small>Top cause</small><b style="font-size:15px">${esc(data[0]?.cause||"—")}</b></div><div class="metric"><small>Top-cause share</small><b>${data.length?pct(Number(data[0].share)):"0.0%"}</b></div></div><div class="panel"><h2>Pareto ranking</h2><div class="pareto-row"><span><b>Cause / component</b></span><span><b>Share of downtime</b></span><span><b>Downtime</b></span><span><b>Cumulative</b></span></div>${rowsHtml}</div>`;
  return html("Downtime Pareto",chrome(s,content));
}

async function maintenanceReport(env:ContractorReportsEnv,s:ReportSession,asCsv:boolean){
  const rows=(await env.DB.prepare(`SELECT fleet_number AS fleet,category,site,status,operating_hours AS operatingHours,next_service_hours AS nextServiceHours FROM machines WHERE company_id=? ORDER BY fleet_number`).bind(s.companyId).all<Record<string,unknown>>()).results.map(r=>{const op=Number(r.operatingHours||0),next=r.nextServiceHours==null?null:Number(r.nextServiceHours),remaining=next==null?null:next-op;const serviceStatus=remaining==null?"Not configured":remaining<=0?"Overdue":remaining<=30?"Due within 30 h":"Planned";return {...r,remaining,serviceStatus};});
  if(asCsv)return csv([["Maintenance Status",s.companyName,new Date().toISOString()],["Fleet","Machine","Site","Status","Operating meter h","Next service meter h","Hours remaining","Service status"],...rows.map(r=>[r.fleet,r.category,r.site,r.status,r.operatingHours,r.nextServiceHours??"",r.remaining==null?"":Number(r.remaining).toFixed(1),r.serviceStatus])],`maintenance-status-${isoDate(new Date())}.csv`);
  const overdue=rows.filter(r=>r.serviceStatus==="Overdue").length,due=rows.filter(r=>r.serviceStatus==="Due within 30 h").length;
  const table=rows.length?`<div class="table"><table><thead><tr><th>Fleet</th><th>Machine</th><th>Site</th><th>Machine status</th><th>Operating meter</th><th>Next service meter</th><th>Hours remaining</th><th>Service status</th></tr></thead><tbody>${rows.map(r=>`<tr><td>${esc(r.fleet)}</td><td>${esc(r.category)}</td><td>${esc(r.site)}</td><td>${esc(r.status)}</td><td>${num(r.operatingHours)}</td><td>${r.nextServiceHours==null?"—":num(r.nextServiceHours)}</td><td>${r.remaining==null?"—":num(r.remaining)}</td><td class="${r.serviceStatus==="Overdue"?"danger":r.serviceStatus==="Due within 30 h"?"warn":"good"}">${esc(r.serviceStatus)}</td></tr>`).join("")}</tbody></table></div>`:`<p class="empty">No fleet machines recorded yet.</p>`;
  const content=`<div class="hero"><small>MAINTENANCE</small><h1>Maintenance Status</h1><p>Service position based on each machine's operating-hour meter and configured next-service meter.</p></div><div class="toolbar no-print"><a class="btn secondary" href="/contractor-reports/export?type=maintenance">Download CSV</a><button class="btn secondary" type="button" onclick="window.print()">Print / PDF</button></div><div class="metrics"><div class="metric"><small>Fleet units</small><b>${rows.length}</b></div><div class="metric"><small>Overdue</small><b class="danger">${overdue}</b></div><div class="metric"><small>Due within 30 h</small><b class="warn">${due}</b></div><div class="metric"><small>Service meter configured</small><b>${rows.filter(r=>r.nextServiceHours!=null).length}</b></div></div><div class="panel"><h2>Fleet service position</h2>${table}<p class="note">Hours remaining = next service meter − current operating meter. A negative result is reported as overdue.</p></div>`;
  return html("Maintenance Status",chrome(s,content));
}

async function productionReport(env:ContractorReportsEnv,s:ReportSession,url:URL,asCsv:boolean){
  const month=validMonth(url.searchParams.get("month")||"",currentMonth()),start=month+"-01",end=nextMonth(month)+"-01",settings=await getSettings(env,s.companyId);
  const rows=(await env.DB.prepare(`SELECT report_date AS reportDate,SUM(tonnes) AS tonnes,SUM(shift_hours) AS shiftHours,SUM(operating_hours) AS operatingHours,SUM(unplanned_downtime) AS downtime FROM production_records WHERE company_id=? AND report_date>=? AND report_date<? GROUP BY report_date ORDER BY report_date`).bind(s.companyId,start,end).all<Record<string,unknown>>()).results.map(r=>{const target=settings.dailyTarget,achievement=target?Number(r.tonnes||0)/target*100:0;return {...r,target,achievement};});
  if(asCsv)return csv([["Production vs Target",s.companyName,month],["Date","Actual tonnes","Target tonnes","Achievement %","Operating h","Downtime h"],...rows.map(r=>[r.reportDate,r.tonnes,r.target,Number(r.achievement).toFixed(1),r.operatingHours,r.downtime])],`production-vs-target-${month}.csv`);
  const actual=rows.reduce((a,r)=>a+Number(r.tonnes||0),0),target=rows.length*settings.dailyTarget,achievement=target?actual/target*100:0;
  const table=rows.length?`<div class="table"><table><thead><tr><th>Date</th><th>Actual</th><th>Target</th><th>Achievement</th><th>Progress</th><th>Operating h</th><th>Downtime h</th></tr></thead><tbody>${rows.map(r=>`<tr><td>${esc(r.reportDate)}</td><td>${num(r.tonnes)} t</td><td>${settings.dailyTarget?num(settings.dailyTarget)+" t":"Not set"}</td><td>${settings.dailyTarget?pct(Number(r.achievement)):"—"}</td><td><div class="bar"><span style="width:${settings.dailyTarget?Math.min(100,Number(r.achievement)):0}%"></span></div></td><td>${num(r.operatingHours)}</td><td>${num(r.downtime)}</td></tr>`).join("")}</tbody></table></div>`:`<p class="empty">No production records in this month.</p>`;
  const content=`<div class="hero"><small>PRODUCTION</small><h1>Production vs Target</h1><p>${esc(month)} · Daily target ${settings.dailyTarget?num(settings.dailyTarget)+" t":"has not been configured"}</p></div><form class="toolbar no-print"><input type="hidden" name="type" value="production"><label>Month<input type="month" name="month" value="${esc(month)}"></label><button class="btn">Refresh</button><a class="btn secondary" href="/contractor-reports/export?type=production&month=${encodeURIComponent(month)}">Download CSV</a><button class="btn secondary" type="button" onclick="window.print()">Print / PDF</button></form><div class="metrics"><div class="metric"><small>Actual production</small><b>${num(actual)} t</b></div><div class="metric"><small>Target for recorded days</small><b>${settings.dailyTarget?num(target)+" t":"—"}</b></div><div class="metric"><small>Achievement</small><b>${settings.dailyTarget?pct(achievement):"—"}</b></div><div class="metric"><small>Days reported</small><b>${rows.length}</b></div></div><div class="panel"><h2>Daily production</h2>${table}</div>`;
  return html("Production vs Target",chrome(s,content));
}

async function saveSettings(request:Request,env:ContractorReportsEnv,s:ReportSession){
  const form=await request.formData(),daily=Math.max(0,Number(form.get("dailyTarget")||0)),availability=Math.max(0,Math.min(100,Number(form.get("availabilityTarget")||90)));
  await ensureSettings(env);
  await env.DB.prepare(`INSERT INTO contractor_report_settings(company_id,daily_production_target,availability_target,updated_at) VALUES(?,?,?,?) ON CONFLICT(company_id) DO UPDATE SET daily_production_target=excluded.daily_production_target,availability_target=excluded.availability_target,updated_at=excluded.updated_at`).bind(s.companyId,daily,availability,new Date().toISOString()).run();
  return Response.redirect(new URL("/contractor-reports",request.url),303);
}

export async function handleContractorReports(request:Request,env:ContractorReportsEnv):Promise<Response|null>{
  const url=new URL(request.url),path=url.pathname;
  const managed=path==="/contractor-reports"||path==="/contractor-reports/settings"||path==="/contractor-reports/export"||path==="/api/contractor/reports"||path.startsWith("/api/contractor/reports/");
  if(!managed)return null;
  try{
    const s=await session(request,env);
    if(!s){if(path.startsWith("/api/"))return Response.json({error:"Sign in required."},{status:401});return Response.redirect(new URL("/contractor-login",request.url),302);}
    if(path==="/contractor-reports/settings"&&request.method==="POST")return saveSettings(request,env,s);
    const asCsv=path==="/contractor-reports/export";
    const type=(url.searchParams.get("type")||"").toLowerCase();
    if(!type&&!asCsv)return reportHome(env,s);
    if(type==="daily")return dailyReport(env,s,url,asCsv);
    if(type==="weekly")return periodFleetReport(env,s,"weekly",url,asCsv);
    if(type==="monthly")return periodFleetReport(env,s,"monthly",url,asCsv);
    if(type==="pareto")return paretoReport(env,s,url,asCsv);
    if(type==="maintenance")return maintenanceReport(env,s,asCsv);
    if(type==="production")return productionReport(env,s,url,asCsv);
    return html("Unknown report",chrome(s,`<div class="panel"><h2>Unknown report</h2><a class="btn" href="/contractor-reports">Back to Reports Centre</a></div>`),404);
  }catch(error){console.error("CONTRACTOR_REPORT_ERROR",{path,message:error instanceof Error?error.message:String(error)});return html("Report error",`<div class="wrap"><div class="panel"><h1>Report temporarily unavailable</h1><p>${esc(error instanceof Error?error.message:String(error))}</p><a class="btn" href="/contractor">Back to workspace</a></div></div>`,500);}
}
