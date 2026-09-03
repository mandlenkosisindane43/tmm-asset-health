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

function dateMs(date: string) {
  const t = new Date(`${date}T00:00:00Z`).getTime();
  return Number.isFinite(t) ? t : 0;
}
function dayDiff(a: string, b: string) {
  const start = dateMs(a),
    end = dateMs(b);
  return start && end ? Math.max(0, Math.round((end - start) / 86400000)) : 0;
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
function rangeLabel(start: string, end: string) {
  const a = new Date(`${start}T00:00:00Z`),
    b = new Date(`${end}T00:00:00Z`);
  if (!Number.isFinite(a.getTime()) || !Number.isFinite(b.getTime()))
    return `${start}–${end}`;
  const sameMonth =
    a.getUTCFullYear() === b.getUTCFullYear() && a.getUTCMonth() === b.getUTCMonth();
  if (sameMonth) {
    const month = shortDate(end).split(" ")[1] || "";
    return a.getUTCDate() === b.getUTCDate()
      ? `${a.getUTCDate()} ${month}`
      : `${a.getUTCDate()}–${b.getUTCDate()} ${month}`;
  }
  return `${shortDate(start)}–${shortDate(end)}`;
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
  if (!batch)
    return { batch: null as Row | null, rows: [] as Row[], days: [] as Row[] };
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
  const days = await all(
    env,
    `SELECT report_date AS date,COUNT(*) AS records,
      SUM(shift_hours) AS shiftHours,SUM(planned_downtime) AS plannedDowntime,
      SUM(unplanned_downtime) AS unplannedDowntime,SUM(operating_hours) AS operatingHours,
      SUM(tonnes) AS tonnes,
      100.0*SUM(operating_hours)/NULLIF(SUM(shift_hours)-SUM(planned_downtime),0) AS availability
     FROM demo_import_records_v1
     WHERE batch_id=? AND company_id=?
     GROUP BY report_date ORDER BY report_date`,
    [num(batch.id), companyId],
  );
  return {
    batch,
    days,
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

function fullMonthRangeTrend(days: Row[], periodStart: string, periodEnd: string) {
  if (!days.length)
    return `<div class="panel chart"><h2>Availability trend by date range</h2><p class="empty">No trend data yet.</p></div>`;

  const sorted = [...days]
    .filter((r) => /^\d{4}-\d{2}-\d{2}$/.test(txt(r.date, 10)))
    .sort((a, b) => txt(a.date, 10).localeCompare(txt(b.date, 10)));
  if (!sorted.length)
    return `<div class="panel chart"><h2>Availability trend by date range</h2><p class="empty">No trend data yet.</p></div>`;

  const totalDays = Math.max(1, dayDiff(periodStart, periodEnd));
  const left = 34,
    right = 622,
    top = 28,
    bottom = 148,
    labelY = 181,
    width = right - left;
  const x = (date: string) =>
    left + (Math.min(totalDays, Math.max(0, dayDiff(periodStart, date))) / totalDays) * width;
  const y = (availability: number) => bottom - (Math.max(0, Math.min(100, availability)) / 100) * (bottom - top);

  const ranges = sorted.map((r, i) => {
    const start = txt(r.date, 10);
    const next = i + 1 < sorted.length ? txt(sorted[i + 1].date, 10) : periodEnd;
    const end = dateMs(next) < dateMs(start) ? start : next;
    return { start, end, availability: num(r.availability) };
  });

  const grid = [0, 25, 50, 75, 100]
    .map((v) => {
      const gy = y(v);
      return `<line x1="${left}" y1="${gy}" x2="${right}" y2="${gy}" stroke="#e6ece9" stroke-width="1"/><text x="${left - 7}" y="${gy + 3}" text-anchor="end" font-size="8" fill="#718079">${v}%</text>`;
    })
    .join("");

  const rangeLines = ranges
    .map((r, i) => {
      const x1 = x(r.start),
        x2 = x(r.end),
        yy = y(r.availability),
        mid = (x1 + x2) / 2,
        range = rangeLabel(r.start, r.end),
        connector =
          i < ranges.length - 1
            ? `<line x1="${x2}" y1="${yy}" x2="${x2}" y2="${y(ranges[i + 1].availability)}" stroke="#10975b" stroke-width="2" opacity=".65"/>`
            : "";
      return `<g><line x1="${x1}" y1="${yy}" x2="${x2}" y2="${yy}" stroke="#10975b" stroke-width="5" stroke-linecap="round"/><circle cx="${x1}" cy="${yy}" r="4" fill="#e6a800"><title>${esc(range)}: ${fmt(r.availability)}%</title></circle>${i === ranges.length - 1 ? `<circle cx="${x2}" cy="${yy}" r="4" fill="#e6a800"/>` : ""}<text x="${mid}" y="${Math.max(12, yy - 9)}" text-anchor="middle" font-size="9" font-weight="900" fill="#263b35">${fmt(r.availability)}%</text><text x="${mid}" y="${labelY + (i % 2) * 11}" text-anchor="middle" font-size="7.5" font-weight="800" fill="#5f7069">${esc(range)}</text>${connector}</g>`;
    })
    .join("");

  const startX = x(periodStart),
    endX = x(periodEnd);
  const monthAxis = `<line x1="${left}" y1="${bottom}" x2="${right}" y2="${bottom}" stroke="#cad5d0"/><text x="${startX}" y="212" text-anchor="start" font-size="8" font-weight="800" fill="#718079">Month starts ${esc(shortDate(periodStart))}</text><text x="${endX}" y="212" text-anchor="end" font-size="8" font-weight="800" fill="#718079">Month ends ${esc(shortDate(periodEnd))}</text>`;

  const chips = ranges
    .map(
      (r) =>
        `<span style="display:inline-flex;gap:5px;align-items:center;padding:5px 8px;border:1px solid #dce5e1;border-radius:999px;background:#f8fbf9;font-size:9px"><b>${esc(rangeLabel(r.start, r.end))}</b><span style="color:#14653e;font-weight:900">${fmt(r.availability)}%</span></span>`,
    )
    .join("");

  return `<div class="panel chart"><h2>Availability trend by date range</h2><p class="muted" style="margin-top:-5px">The chart spans the complete imported month, from <b>${esc(shortDate(periodStart))}</b> to <b>${esc(shortDate(periodEnd))}</b>. Each horizontal section shows the availability applying between one imported report date and the next. The final section extends to the month end.</p><svg viewBox="0 0 640 222" role="img" aria-label="Previous-month availability by date range from ${esc(periodStart)} to ${esc(periodEnd)}">${grid}${monthAxis}${rangeLines}</svg><div style="display:flex;flex-wrap:wrap;gap:6px;margin-top:6px">${chips}</div></div>`;
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
  const trial = await latestTrialRows(env, s.companyId);

  if (trial.batch) {
    const periodStart = txt(trial.batch.periodStart, 10),
      periodEnd = txt(trial.batch.periodEnd, 10);
    const replacement = fullMonthRangeTrend(trial.days, periodStart, periodEnd);
    body = body.replace(
      /<div class="panel chart"><h2>Daily availability trend<\/h2>[\s\S]*?<\/div><div class="panel"><h2>Operating vs downtime<\/h2>/,
      `${replacement}<div class="panel"><h2>Operating vs downtime</h2>`,
    );
  }

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
