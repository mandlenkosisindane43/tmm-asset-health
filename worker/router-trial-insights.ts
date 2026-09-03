import currentApp from "./router-report-insights";

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
function fmt(v: unknown, digits = 1) {
  return num(v).toLocaleString("en-ZA", { maximumFractionDigits: digits });
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
  const licenceEnd =
    new Date(txt(row.licenceExpires)).getTime() + num(row.graceDays) * 86400000;
  if (Number.isFinite(licenceEnd) && Date.now() > licenceEnd) return null;
  return { companyId: num(row.companyId) };
}

function shortDate(date: string) {
  const d = new Date(`${date}T00:00:00Z`);
  if (!Number.isFinite(d.getTime())) return date.slice(5);
  const months = [
    "Jan",
    "Feb",
    "Mar",
    "Apr",
    "May",
    "Jun",
    "Jul",
    "Aug",
    "Sep",
    "Oct",
    "Nov",
    "Dec",
  ];
  return `${d.getUTCDate()} ${months[d.getUTCMonth()]}`;
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

async function latestTrialRows(env: Env, companyId: number) {
  const batch = await first(
    env,
    `SELECT id,period_start AS periodStart,period_end AS periodEnd
     FROM demo_import_batches_v1 WHERE company_id=? ORDER BY id DESC LIMIT 1`,
    [companyId],
  );
  if (!batch) return { batch: null as Row | null, rows: [] as Row[] };
  const rows = await all(
    env,
    `SELECT fleet_number AS fleet,COUNT(*) AS records,
      SUM(shift_hours) AS shiftHours,SUM(planned_downtime) AS plannedDowntime,
      SUM(unplanned_downtime) AS unplannedDowntime,SUM(operating_hours) AS operatingHours,
      SUM(tonnes) AS tonnes
     FROM demo_import_records_v1
     WHERE batch_id=? AND company_id=?
     GROUP BY fleet_number`,
    [num(batch.id), companyId],
  );
  return {
    batch,
    rows: rows.map((r) => {
      const scheduled = Math.max(0, num(r.shiftHours) - num(r.plannedDowntime));
      return {
        ...r,
        availability: scheduled > 0 ? (num(r.operatingHours) / scheduled) * 100 : 0,
      };
    }),
  };
}

function rankingCard(title: string, subtitle: string, rows: Row[], target: number, low = false) {
  const items = rows.length
    ? rows
        .map((r, i) => {
          const av = num(r.availability);
          const status = av >= target ? "On / above target" : "Below target";
          return `<div style="display:grid;grid-template-columns:34px minmax(95px,1fr) 92px 92px;gap:8px;align-items:center;padding:10px 0;border-top:${i ? "1px solid #e8eeeb" : "0"}"><div style="width:28px;height:28px;border-radius:50%;display:grid;place-items:center;background:${low ? "#ffe8e8" : "#e9f7ef"};color:${low ? "#bd1e1e" : "#14653e"};font-weight:900;font-size:11px">${i + 1}</div><div><b style="font-size:13px">${esc(r.fleet)}</b><div style="font-size:9px;color:#718079;margin-top:3px">${esc(status)}</div></div><div><b style="font-size:14px;color:${low ? "#bd1e1e" : "#14653e"}">${fmt(av)}%</b><div style="font-size:9px;color:#718079">availability</div></div><div><b style="font-size:12px">${fmt(r.unplannedDowntime)} h</b><div style="font-size:9px;color:#718079">unplanned DT</div></div></div>`;
        })
        .join("")
    : `<p class="muted">No machine records available.</p>`;
  return `<section class="panel" style="margin:0"><div style="display:flex;justify-content:space-between;gap:10px;align-items:start"><div><h2 style="margin:0">${esc(title)}</h2><p class="muted" style="margin:5px 0 9px">${esc(subtitle)}</p></div><span class="pill ${low ? "red" : ""}" style="white-space:nowrap">Target ${fmt(target)}%</span></div>${items}</section>`;
}

async function enhanceTrial(req: Request, env: Env, response: Response) {
  if (req.method !== "GET" || response.status !== 200) return response;
  const url = new URL(req.url);
  if (url.pathname !== "/trial-demo") return response;
  if (!(response.headers.get("content-type") || "").includes("text/html"))
    return response;

  const s = await session(req, env);
  if (!s) return response;

  let body = await response.text();

  // Give the daily trend enough room for an x-axis date under each point.
  body = body.replace(
    '<svg viewBox="0 0 640 170" role="img" aria-label="Daily availability trend">',
    '<svg viewBox="0 0 640 190" role="img" aria-label="Daily availability trend with availability percentages and dates">',
  );

  // The underlying report-insights layer already adds the % above each point.
  // Add the matching report date underneath each point so the line can be read directly.
  body = body.replace(
    /(<circle cx="([0-9.]+)" cy="([0-9.]+)" r="4" fill="#e6a800"><title>([^<]*?): ([0-9.,]+)%<\/title><\/circle><text x="\2" y="[0-9.]+" text-anchor="middle" font-size="9" font-weight="800" fill="#334155">\5%<\/text>)/g,
    (_m, existing: string, cx: string, _cy: string, date: string) =>
      `${existing}<text x="${cx}" y="176" text-anchor="middle" font-size="7.5" font-weight="700" fill="#64748b">${esc(shortDate(date))}</text>`,
  );

  const trendTitle = '<h2>Daily availability trend</h2>';
  const oldNote = '<p class="muted" style="margin-top:-5px">Availability % is shown above every daily point.</p>';
  if (body.includes(oldNote))
    body = body.replace(
      oldNote,
      '<p class="muted" style="margin-top:-5px">Availability % is shown above each point and the report date is shown underneath. Example: <b>56%</b> above the point and <b>3 Aug</b> below it.</p>',
    );
  else if (body.includes(trendTitle))
    body = body.replace(
      trendTitle,
      `${trendTitle}<p class="muted" style="margin-top:-5px">Availability % is shown above each point and the report date is shown underneath.</p>`,
    );

  const trial = await latestTrialRows(env, s.companyId);
  if (trial.batch && trial.rows.length) {
    const target = await availabilityTarget(env, s.companyId);
    const best = [...trial.rows]
      .sort(
        (a, b) =>
          num(b.availability) - num(a.availability) ||
          num(a.unplannedDowntime) - num(b.unplannedDowntime) ||
          num(b.tonnes) - num(a.tonnes),
      )
      .slice(0, 5);
    const lowest = [...trial.rows]
      .sort(
        (a, b) =>
          num(a.availability) - num(b.availability) ||
          num(b.unplannedDowntime) - num(a.unplannedDowntime) ||
          num(a.tonnes) - num(b.tonnes),
      )
      .slice(0, 5);
    const period = `${txt(trial.batch.periodStart, 10)} to ${txt(trial.batch.periodEnd, 10)}`;
    const rankings = `<div class="trial-performance-insights" style="display:grid;grid-template-columns:1fr 1fr;gap:12px;margin-top:12px">${rankingCard(
      "Best performing machines — previous month",
      `${period}. Ranked mainly by availability; lower downtime and higher production break ties.`,
      best,
      target,
      false,
    )}${rankingCard(
      "Lowest performing machines — previous month",
      `${period}. These machines should be prioritised for reliability review, maintenance planning and root-cause investigation.`,
      lowest,
      target,
      true,
    )}</div><style>@media(max-width:900px){.trial-performance-insights{grid-template-columns:1fr!important}}@media print{.trial-performance-insights{break-inside:avoid}}</style>`;

    const marker = '<div class="panel"><h2>Machine comparison</h2>';
    if (body.includes(marker)) body = body.replace(marker, `${rankings}${marker}`);
  }

  return new Response(body, { status: response.status, headers: response.headers });
}

export default {
  async fetch(req: Request, env: Env, ctx: ExecutionContext): Promise<Response> {
    let response = await currentApp.fetch(req, env as never, ctx as never);
    response = await enhanceTrial(req, env, response);
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
