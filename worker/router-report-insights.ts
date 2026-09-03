import currentApp from "./router-user-removal";

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
type Session = { companyId: number; accountId: number };

const COOKIE = "sas_contractor_v2";
const enc = new TextEncoder();

function txt(v: unknown, max = 300) {
  return String(v ?? "").trim().slice(0, max);
}
function lower(v: unknown) {
  return txt(v).toLowerCase();
}
function num(v: unknown, fallback = 0) {
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
function getCookie(req: Request) {
  for (const part of (req.headers.get("cookie") || "").split(";")) {
    const i = part.indexOf("=");
    if (i > -1 && part.slice(0, i).trim() === COOKIE)
      return part.slice(i + 1).trim();
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
    `SELECT s.company_id AS companyId,s.account_id AS accountId,s.expires_at AS sessionExpires,
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
  const licenceEnd =
    new Date(txt(row.licenceExpires)).getTime() + num(row.graceDays) * 86400000;
  if (Number.isFinite(licenceEnd) && Date.now() > licenceEnd) return null;
  return { companyId: num(row.companyId), accountId: num(row.accountId) };
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
  const d = new Date(date + "T00:00:00Z");
  d.setUTCDate(d.getUTCDate() + days);
  return isoDate(d);
}
function mondayOf(date: string) {
  const d = new Date(date + "T00:00:00Z");
  const day = d.getUTCDay() || 7;
  d.setUTCDate(d.getUTCDate() - day + 1);
  return isoDate(d);
}
function nextMonth(month: string) {
  const d = new Date(month + "-01T00:00:00Z");
  d.setUTCMonth(d.getUTCMonth() + 1);
  return d.toISOString().slice(0, 7);
}
function fmt(v: unknown, digits = 1) {
  const n = num(v);
  return n.toLocaleString("en-ZA", { maximumFractionDigits: digits });
}

async function availabilityTarget(env: Env, companyId: number) {
  const report = await first(
    env,
    "SELECT availability_target AS target FROM contractor_report_settings WHERE company_id=? LIMIT 1",
    [companyId],
  );
  if (report?.target != null) return num(report.target, 90);
  const company = await first(
    env,
    "SELECT availability_target AS target FROM company_settings_v3 WHERE company_id=? LIMIT 1",
    [companyId],
  );
  return company?.target != null ? num(company.target, 90) : 90;
}

async function periodRows(env: Env, companyId: number, start: string, end: string) {
  const rows = await all(
    env,
    `SELECT fleet_number AS fleet,COUNT(*) AS records,
      SUM(shift_hours) AS shiftHours,SUM(planned_downtime) AS plannedDowntime,
      SUM(unplanned_downtime) AS unplannedDowntime,SUM(operating_hours) AS operatingHours,
      SUM(tonnes) AS tonnes
     FROM production_records
     WHERE company_id=? AND report_date>=? AND report_date<?
     GROUP BY fleet_number`,
    [companyId, start, end],
  );
  return rows.map((r) => {
    const scheduled = Math.max(0, num(r.shiftHours) - num(r.plannedDowntime));
    const availability = scheduled > 0 ? (num(r.operatingHours) / scheduled) * 100 : 0;
    return { ...r, availability };
  });
}

function rankingCard(
  title: string,
  subtitle: string,
  rows: Row[],
  target: number,
  low = false,
) {
  const items = rows.length
    ? rows
        .map((r, i) => {
          const av = num(r.availability);
          const status = av >= target ? "On / above target" : "Below target";
          return `<div style="display:grid;grid-template-columns:34px minmax(90px,1fr) 88px 92px;gap:9px;align-items:center;padding:10px 0;border-top:${i ? "1px solid #edf1f5" : "0"}"><div style="width:28px;height:28px;border-radius:50%;display:grid;place-items:center;background:${low ? "#fff0ef" : "#eaf7ef"};color:${low ? "#b42318" : "#147a45"};font-weight:900;font-size:11px">${i + 1}</div><div><b style="font-size:13px">${esc(r.fleet)}</b><div style="font-size:9px;color:#74849a;margin-top:3px">${esc(status)}</div></div><div><b style="font-size:14px;color:${low ? "#b42318" : "#147a45"}">${fmt(av)}%</b><div style="font-size:9px;color:#74849a">availability</div></div><div><b style="font-size:12px">${fmt(r.unplannedDowntime)} h</b><div style="font-size:9px;color:#74849a">unplanned DT</div></div></div>`;
        })
        .join("")
    : `<p style="color:#74849a;font-size:11px">No machine records in this period.</p>`;
  return `<section style="background:#fff;border:1px solid #dce5ef;border-radius:12px;padding:16px"><div style="display:flex;justify-content:space-between;gap:10px;align-items:start"><div><h2 style="font-size:16px;margin:0">${esc(title)}</h2><p style="font-size:10px;color:#74849a;margin:5px 0 8px">${esc(subtitle)}</p></div><span style="font-size:9px;font-weight:900;padding:5px 8px;border-radius:20px;background:${low ? "#fff0ef" : "#eaf7ef"};color:${low ? "#b42318" : "#147a45"}">TARGET ${fmt(target)}%</span></div>${items}</section>`;
}

async function enhancePeriodicReport(req: Request, env: Env, response: Response) {
  if (req.method !== "GET" || response.status !== 200) return response;
  const url = new URL(req.url);
  if (url.pathname !== "/contractor-reports") return response;
  const type = lower(url.searchParams.get("type"));
  if (!["weekly", "monthly"].includes(type)) return response;
  if (!(response.headers.get("content-type") || "").includes("text/html")) return response;

  const s = await session(req, env);
  if (!s) return response;

  const now = isoDate(new Date());
  let start = "",
    end = "";
  if (type === "weekly") {
    const anchor = validDate(url.searchParams.get("date") || "", now);
    start = mondayOf(anchor);
    end = addDays(start, 7);
  } else {
    const month = validMonth(
      url.searchParams.get("month") || "",
      new Date().toISOString().slice(0, 7),
    );
    start = month + "-01";
    end = nextMonth(month) + "-01";
  }

  const target = await availabilityTarget(env, s.companyId);
  const rows = await periodRows(env, s.companyId, start, end);
  const bestCount = type === "weekly" ? 3 : 5;
  const lowCount = type === "weekly" ? 3 : 5;
  const best = [...rows]
    .sort(
      (a, b) =>
        num(b.availability) - num(a.availability) ||
        num(a.unplannedDowntime) - num(b.unplannedDowntime) ||
        num(b.tonnes) - num(a.tonnes),
    )
    .slice(0, bestCount);
  const lowest = [...rows]
    .sort(
      (a, b) =>
        num(a.availability) - num(b.availability) ||
        num(b.unplannedDowntime) - num(a.unplannedDowntime) ||
        num(a.tonnes) - num(b.tonnes),
    )
    .slice(0, lowCount);

  const label =
    type === "weekly"
      ? `Performance ranking for ${start} to ${addDays(end, -1)}`
      : `Performance ranking for ${start.slice(0, 7)}`;
  const insight = `<div style="display:grid;grid-template-columns:1fr 1fr;gap:12px;margin-top:14px" class="performance-insights">${rankingCard(
    type === "weekly" ? "Best performing this week" : "Best performing this month",
    `${label}. Ranked mainly by availability; downtime and production break ties.`,
    best,
    target,
    false,
  )}${rankingCard(
    type === "weekly" ? "Lowest performing this week" : "Lowest performing this month",
    type === "weekly"
      ? "Machines needing attention before the next weekly review."
      : "Lowest-availability machines for the monthly management review and reliability action plan.",
    lowest,
    target,
    true,
  )}</div><style>@media(max-width:760px){.performance-insights{grid-template-columns:1fr!important}}@media print{.performance-insights{break-inside:avoid}}</style>`;

  let body = await response.text();
  const marker = '<div class="panel"><h2>Fleet performance</h2>';
  if (body.includes(marker)) body = body.replace(marker, `${insight}${marker}`);
  return new Response(body, { status: response.status, headers: response.headers });
}

function enhanceTrendLabels(req: Request, response: Response) {
  if (req.method !== "GET" || response.status !== 200) return response;
  const url = new URL(req.url);
  if (url.pathname !== "/trial-demo") return response;
  if (!(response.headers.get("content-type") || "").includes("text/html"))
    return response;

  return (async () => {
    let body = await response.text();
    body = body.replace(
      /<circle cx="([0-9.]+)" cy="([0-9.]+)" r="4" fill="#e6a800"><title>([^<]*?): ([0-9.,]+)%<\/title><\/circle>/g,
      (_m, cx: string, cyRaw: string, date: string, value: string) => {
        const cy = Number(cyRaw);
        const y = Number.isFinite(cy) ? Math.max(11, cy - 9) : cyRaw;
        return `<circle cx="${cx}" cy="${cyRaw}" r="4" fill="#e6a800"><title>${esc(date)}: ${esc(value)}%</title></circle><text x="${cx}" y="${y}" text-anchor="middle" font-size="9" font-weight="800" fill="#334155">${esc(value)}%</text>`;
      },
    );
    const title = '<h2>Daily availability trend</h2>';
    if (body.includes(title))
      body = body.replace(
        title,
        `${title}<p class="muted" style="margin-top:-5px">Availability % is shown above every daily point.</p>`,
      );
    return new Response(body, { status: response.status, headers: response.headers });
  })();
}

export default {
  async fetch(req: Request, env: Env, ctx: ExecutionContext): Promise<Response> {
    let response = await currentApp.fetch(req, env as never, ctx as never);
    response = await enhanceTrendLabels(req, response);
    response = await enhancePeriodicReport(req, env, response);
    return response;
  },

  async scheduled(
    controller: ScheduledController,
    env: Env,
    ctx: ExecutionContext,
  ) {
    return currentApp.scheduled(controller as never, env as never, ctx as never);
  },
};
