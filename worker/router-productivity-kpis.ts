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

type MachineKpi = {
  fleet: string;
  shift: number;
  planned: number;
  unplanned: number;
  operating: number;
  productive: number;
  tonnes: number;
  breakdowns: number;
  eventDowntime: number;
  availability: number;
  utilisation: number | null;
  effectiveUtilisation: number | null;
  feedRate: number | null;
  tonnesPerOperatingHour: number | null;
  downtimeRate: number | null;
  mtbf: number | null;
  mttr: number | null;
};

const COOKIE = "sas_contractor_v2";
const enc = new TextEncoder();

function txt(v: unknown, max = 300) {
  return String(v ?? "").trim().slice(0, max);
}
function lower(v: unknown) {
  return txt(v).toLowerCase();
}
function n(v: unknown, fallback = 0) {
  const x = Number(v);
  return Number.isFinite(x) ? x : fallback;
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
function fmt(v: number | null, digits = 1, suffix = "") {
  if (v == null || !Number.isFinite(v)) return "—";
  return `${v.toLocaleString("en-ZA", { maximumFractionDigits: digits })}${suffix}`;
}
function getCookie(req: Request) {
  for (const p of (req.headers.get("cookie") || "").split(";")) {
    const i = p.indexOf("=");
    if (i > -1 && p.slice(0, i).trim() === COOKIE) return p.slice(i + 1).trim();
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
    return await env.DB.prepare(sql)
      .bind(...binds)
      .first<Row>();
  } catch {
    return null;
  }
}
async function all(env: Env, sql: string, binds: unknown[] = []) {
  try {
    return (
      (
        await env.DB.prepare(sql)
          .bind(...binds)
          .all<Row>()
      ).results || []
    );
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
  if (new Date(txt(row.sessionExpires)).getTime() < Date.now()) return null;
  if (!["active", "trial"].includes(lower(row.licenceStatus))) return null;
  const licenceEnd = new Date(txt(row.licenceExpires)).getTime() + n(row.graceDays) * 86400000;
  if (Number.isFinite(licenceEnd) && Date.now() > licenceEnd) return null;
  return { companyId: n(row.companyId) };
}

function isoDate(d: Date) {
  return d.toISOString().slice(0, 10);
}
function validDate(v: string, fallback: string) {
  return /^\d{4}-\d{2}-\d{2}$/.test(v) ? v : fallback;
}
function validMonth(v: string, fallback: string) {
  return /^\d{4}-\d{2}$/.test(v) ? v : fallback;
}
function addDays(date: string, days: number) {
  const d = new Date(`${date}T00:00:00Z`);
  d.setUTCDate(d.getUTCDate() + days);
  return isoDate(d);
}
function mondayOf(date: string) {
  const d = new Date(`${date}T00:00:00Z`);
  const day = d.getUTCDay() || 7;
  d.setUTCDate(d.getUTCDate() - day + 1);
  return isoDate(d);
}
function nextMonth(month: string) {
  const d = new Date(`${month}-01T00:00:00Z`);
  d.setUTCMonth(d.getUTCMonth() + 1);
  return d.toISOString().slice(0, 7);
}

function calculate(row: Row, breakdowns = 0, eventDowntime = 0): MachineKpi {
  const shift = n(row.shiftHours ?? row.shift);
  const planned = n(row.plannedDowntime ?? row.planned);
  const unplanned = n(row.unplannedDowntime ?? row.unplanned);
  const operating = n(row.operatingHours ?? row.operating);
  const productive = n(row.productiveHours ?? row.productive);
  const tonnes = n(row.tonnes);
  const scheduled = Math.max(0, shift - planned);
  return {
    fleet: txt(row.fleet, 120),
    shift,
    planned,
    unplanned,
    operating,
    productive,
    tonnes,
    breakdowns,
    eventDowntime,
    availability: scheduled > 0 ? (operating / scheduled) * 100 : 0,
    utilisation: operating > 0 && productive >= 0 ? (productive / operating) * 100 : null,
    effectiveUtilisation:
      scheduled > 0 && productive >= 0 ? (productive / scheduled) * 100 : null,
    feedRate: productive > 0 && tonnes >= 0 ? tonnes / productive : null,
    tonnesPerOperatingHour: operating > 0 && tonnes >= 0 ? tonnes / operating : null,
    downtimeRate: scheduled > 0 ? (unplanned / scheduled) * 100 : null,
    mtbf: breakdowns > 0 && operating > 0 ? operating / breakdowns : null,
    mttr: breakdowns > 0 ? eventDowntime / breakdowns : null,
  };
}

function weightedOverall(rows: MachineKpi[]) {
  const shift = rows.reduce((a, r) => a + r.shift, 0);
  const planned = rows.reduce((a, r) => a + r.planned, 0);
  const scheduled = Math.max(0, shift - planned);
  const operating = rows.reduce((a, r) => a + r.operating, 0);
  const productive = rows.reduce((a, r) => a + r.productive, 0);
  const tonnes = rows.reduce((a, r) => a + r.tonnes, 0);
  const unplanned = rows.reduce((a, r) => a + r.unplanned, 0);
  const breakdowns = rows.reduce((a, r) => a + r.breakdowns, 0);
  const eventDowntime = rows.reduce((a, r) => a + r.eventDowntime, 0);
  return {
    availability: scheduled > 0 ? (operating / scheduled) * 100 : null,
    utilisation: operating > 0 ? (productive / operating) * 100 : null,
    effectiveUtilisation: scheduled > 0 ? (productive / scheduled) * 100 : null,
    feedRate: productive > 0 ? tonnes / productive : null,
    tonnesPerOperatingHour: operating > 0 ? tonnes / operating : null,
    downtimeRate: scheduled > 0 ? (unplanned / scheduled) * 100 : null,
    breakdowns,
    mtbf: breakdowns > 0 && operating > 0 ? operating / breakdowns : null,
    mttr: breakdowns > 0 ? eventDowntime / breakdowns : null,
  };
}

function metric(label: string, value: string, note: string) {
  return `<div style="background:#fff;border:1px solid #dce5e1;border-radius:10px;padding:12px"><small style="display:block;color:#687872;font-size:9px;font-weight:800">${esc(label)}</small><b style="display:block;font-size:20px;margin:5px 0 3px">${esc(value)}</b><span style="font-size:9px;color:#718079;line-height:1.35">${esc(note)}</span></div>`;
}

function kpiPanel(rows: MachineKpi[], mode: "trial" | "live") {
  const o = weightedOverall(rows);
  const cards = [
    metric("Utilisation", fmt(o.utilisation, 1, "%"), "Productive hours ÷ operating hours"),
    metric(
      "Effective utilisation",
      fmt(o.effectiveUtilisation, 1, "%"),
      "Productive hours ÷ scheduled available hours",
    ),
    metric("Feed rate", fmt(o.feedRate, 1, " t/h"), "Tonnes ÷ productive hours"),
    metric(
      "Tonnes / operating hour",
      fmt(o.tonnesPerOperatingHour, 1, " t/h"),
      "Production intensity across operating time",
    ),
    metric("Unplanned downtime rate", fmt(o.downtimeRate, 1, "%"), "Unplanned downtime ÷ scheduled available hours"),
    mode === "live"
      ? metric("Logged breakdowns", String(o.breakdowns), "Breakdown events logged in this report period")
      : metric("Fault entries", String(o.breakdowns), "Imported rows with downtime or a fault reason"),
  ].join("");

  const reliability =
    mode === "live"
      ? `${metric("MTBF", fmt(o.mtbf, 1, " h"), "Operating hours ÷ logged breakdown events")}${metric("MTTR", fmt(o.mttr, 1, " h"), "Logged breakdown-event downtime ÷ breakdown events")}`
      : `${metric("Operating availability", fmt(o.availability, 1, "%"), "Operating hours ÷ scheduled available hours")}${metric("Data quality", rows.length ? "Calculated" : "No data", "No estimated values are created when required hours are missing")}`;

  const tableRows = [...rows]
    .sort((a, b) => b.unplanned - a.unplanned || a.availability - b.availability)
    .map(
      (r) => `<tr><td><b>${esc(r.fleet)}</b></td><td>${fmt(r.availability, 1, "%")}</td><td>${fmt(r.utilisation, 1, "%")}</td><td>${fmt(r.feedRate, 1, " t/h")}</td><td>${fmt(r.downtimeRate, 1, "%")}</td><td>${fmt(r.unplanned, 1, " h")}</td><td>${r.breakdowns}</td></tr>`,
    )
    .join("");

  return `<section style="margin-top:12px"><div style="display:flex;justify-content:space-between;gap:12px;align-items:end;margin-bottom:8px"><div><h2 style="margin:0;font-size:15px">Productivity & reliability KPIs</h2><p style="margin:4px 0 0;font-size:10px;color:#718079">Calculated only from captured machine hours, tonnes and logged/imported breakdown data.</p></div></div><div class="sas-productivity-cards" style="display:grid;grid-template-columns:repeat(4,1fr);gap:8px">${cards}${reliability}</div><div style="background:#fff;border:1px solid #dce5e1;border-radius:12px;padding:14px;margin-top:10px;overflow:auto"><h3 style="margin:0 0 9px;font-size:13px">Machine productivity & breakdown impact</h3><table style="width:100%;border-collapse:collapse;font-size:10px;min-width:720px"><thead><tr><th style="text-align:left;padding:8px;background:#f3f6f5">Machine</th><th style="text-align:left;padding:8px;background:#f3f6f5">Availability</th><th style="text-align:left;padding:8px;background:#f3f6f5">Utilisation</th><th style="text-align:left;padding:8px;background:#f3f6f5">Feed rate</th><th style="text-align:left;padding:8px;background:#f3f6f5">DT rate</th><th style="text-align:left;padding:8px;background:#f3f6f5">Unplanned DT</th><th style="text-align:left;padding:8px;background:#f3f6f5">${mode === "live" ? "Breakdowns" : "Fault entries"}</th></tr></thead><tbody>${tableRows || `<tr><td colspan="7" style="padding:12px;color:#718079">No machine KPI data in this period.</td></tr>`}</tbody></table></div><style>@media(max-width:950px){.sas-productivity-cards{grid-template-columns:repeat(2,1fr)!important}}@media(max-width:600px){.sas-productivity-cards{grid-template-columns:1fr!important}}@media print{.sas-productivity-cards{grid-template-columns:repeat(4,1fr)!important}}</style></section>`;
}

async function trialKpis(env: Env, companyId: number) {
  const batch = await first(
    env,
    "SELECT id FROM demo_import_batches_v1 WHERE company_id=? ORDER BY id DESC LIMIT 1",
    [companyId],
  );
  if (!batch) return [] as MachineKpi[];
  const rows = await all(
    env,
    `SELECT fleet_number AS fleet,SUM(shift_hours) AS shiftHours,
      SUM(planned_downtime) AS plannedDowntime,SUM(unplanned_downtime) AS unplannedDowntime,
      SUM(operating_hours) AS operatingHours,SUM(productive_hours) AS productiveHours,
      SUM(tonnes) AS tonnes,
      SUM(CASE WHEN unplanned_downtime>0 OR TRIM(COALESCE(fault_reason,''))<>'' THEN 1 ELSE 0 END) AS faultEntries
     FROM demo_import_records_v1 WHERE company_id=? AND batch_id=? GROUP BY fleet_number`,
    [companyId, n(batch.id)],
  );
  return rows.map((r) => calculate(r, n(r.faultEntries), n(r.unplannedDowntime)));
}

async function liveKpis(env: Env, companyId: number, start: string, end: string) {
  const prod = await all(
    env,
    `SELECT fleet_number AS fleet,SUM(shift_hours) AS shiftHours,
      SUM(planned_downtime) AS plannedDowntime,SUM(unplanned_downtime) AS unplannedDowntime,
      SUM(operating_hours) AS operatingHours,SUM(productive_hours) AS productiveHours,SUM(tonnes) AS tonnes
     FROM production_records WHERE company_id=? AND report_date>=? AND report_date<? GROUP BY fleet_number`,
    [companyId, start, end],
  );
  const events = await all(
    env,
    `SELECT fleet_number AS fleet,COUNT(*) AS breakdowns,SUM(COALESCE(downtime_hours,0)) AS eventDowntime
     FROM events WHERE company_id=? AND opened_at>=? AND opened_at<? GROUP BY fleet_number`,
    [companyId, `${start}T00:00:00.000Z`, `${end}T00:00:00.000Z`],
  );
  const eventMap = new Map(
    events.map((r) => [txt(r.fleet, 120), { count: n(r.breakdowns), downtime: n(r.eventDowntime) }]),
  );
  return prod.map((r) => {
    const e = eventMap.get(txt(r.fleet, 120)) || { count: 0, downtime: 0 };
    return calculate(r, e.count, e.downtime);
  });
}

async function enhance(req: Request, env: Env, response: Response) {
  if (req.method !== "GET" || response.status !== 200) return response;
  if (!(response.headers.get("content-type") || "").includes("text/html")) return response;
  const url = new URL(req.url);
  const s = await session(req, env);
  if (!s) return response;
  let body = await response.text();

  if (url.pathname === "/trial-demo") {
    const rows = await trialKpis(env, s.companyId);
    if (rows.length) {
      const panel = kpiPanel(rows, "trial");
      const marker = '<div class="grid"><div class="panel chart"><h2>Daily availability trend</h2>';
      if (body.includes(marker)) body = body.replace(marker, `${panel}${marker}`);
    }
    return new Response(body, { status: response.status, headers: response.headers });
  }

  if (url.pathname === "/contractor-reports") {
    const type = lower(url.searchParams.get("type"));
    if (!["weekly", "monthly"].includes(type)) return response;
    const now = isoDate(new Date());
    let start = "",
      end = "";
    if (type === "weekly") {
      const anchor = validDate(url.searchParams.get("date") || "", now);
      start = mondayOf(anchor);
      end = addDays(start, 7);
    } else {
      const month = validMonth(url.searchParams.get("month") || "", new Date().toISOString().slice(0, 7));
      start = `${month}-01`;
      end = `${nextMonth(month)}-01`;
    }
    const rows = await liveKpis(env, s.companyId, start, end);
    if (rows.length) {
      const panel = kpiPanel(rows, "live");
      const marker = '<div class="panel"><h2>Fleet performance</h2>';
      if (body.includes(marker)) body = body.replace(marker, `${panel}${marker}`);
    }
    return new Response(body, { status: response.status, headers: response.headers });
  }

  return response;
}

export default {
  async fetch(req: Request, env: Env, ctx: ExecutionContext): Promise<Response> {
    const response = await currentApp.fetch(req, env as never, ctx as never);
    return enhance(req, env, response);
  },
  async scheduled(controller: ScheduledController, env: Env, ctx: ExecutionContext) {
    return currentApp.scheduled(controller as never, env as never, ctx as never);
  },
};
