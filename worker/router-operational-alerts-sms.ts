import currentAlerts from "./router-operational-alerts";
import {
  normalizePhone,
  sendTwilioSmsMany,
  smsConfigured,
  type TwilioSmsEnv,
} from "./twilio-sms";

interface ExecutionContext {
  waitUntil(promise: Promise<unknown>): void;
  passThroughOnException(): void;
}
interface ScheduledController {
  scheduledTime: number;
  cron: string;
  noRetry(): void;
}
interface Env extends TwilioSmsEnv {
  DB: D1Database;
  [key: string]: unknown;
}
type Row = Record<string, unknown>;
type AlertKind =
  | "breakdown"
  | "critical"
  | "service_due"
  | "po"
  | "missing_report"
  | "repeat_failure";
type TrialSession = {
  companyId: number;
  accountId: number;
  role: string;
  companyName: string;
  licenceStatus: string;
  token: string;
};

const COOKIE = "sas_contractor_v2";
const enc = new TextEncoder();
const ORIGIN = "https://tmm-asset-health.mandlenkosisindane43.workers.dev";

function txt(v: unknown, max = 500) {
  return String(v ?? "").trim().slice(0, max);
}
function lower(v: unknown) {
  return txt(v, 300).toLowerCase();
}
function num(v: unknown, f = 0) {
  const n = Number(v);
  return Number.isFinite(n) ? n : f;
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
function trimSms(value: unknown, max = 700) {
  const s = String(value ?? "").replace(/\s+/g, " ").trim();
  return s.length > max ? `${s.slice(0, max - 1)}…` : s;
}
function getCookie(req: Request, name: string) {
  for (const p of (req.headers.get("cookie") || "").split(";")) {
    const i = p.indexOf("=");
    if (i > -1 && p.slice(0, i).trim() === name) return p.slice(i + 1).trim();
  }
  return "";
}
async function sha256(v: string) {
  return Array.from(
    new Uint8Array(await crypto.subtle.digest("SHA-256", enc.encode(v))),
    (b) => b.toString(16).padStart(2, "0"),
  ).join("");
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
async function first(env: Env, sql: string, binds: unknown[] = []) {
  try {
    return await env.DB.prepare(sql)
      .bind(...binds)
      .first<Row>();
  } catch {
    return null;
  }
}
function zaNow() {
  return new Date(Date.now() + 2 * 3600000);
}
function zaDate() {
  return zaNow().toISOString().slice(0, 10);
}
function dayDiff(date: string) {
  const t = new Date(date.length <= 10 ? `${date}T00:00:00Z` : date).getTime();
  const today = new Date(`${zaDate()}T00:00:00Z`).getTime();
  return Number.isFinite(t) ? Math.ceil((t - today) / 86400000) : 99999;
}
function kindEnabled(row: Row, kind: AlertKind) {
  if (kind === "breakdown") return num(row.breakdown) === 1;
  if (kind === "service_due") return num(row.serviceDue ?? row.service_due) === 1;
  if (kind === "missing_report")
    return num(row.missingReport ?? row.missing_report) === 1;
  if (kind === "po") return num(row.po) === 1;
  return num(row.critical) === 1;
}

async function ensureSchema(env: Env) {
  await env.DB.prepare(
    `CREATE TABLE IF NOT EXISTS operational_sms_audit_v1(
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      company_id INTEGER NOT NULL,
      alert_key TEXT NOT NULL UNIQUE,
      alert_kind TEXT NOT NULL,
      recipients TEXT NOT NULL,
      status TEXT NOT NULL,
      provider_ids TEXT,
      error TEXT,
      created_at TEXT NOT NULL
    )`,
  ).run();
  await env.DB.prepare(
    `CREATE INDEX IF NOT EXISTS idx_operational_sms_company ON operational_sms_audit_v1(company_id,created_at)`,
  ).run();
  await env.DB.prepare(
    `CREATE TABLE IF NOT EXISTS demo_sms_deliveries_v1(
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      batch_id INTEGER NOT NULL,
      company_id INTEGER NOT NULL,
      recipients TEXT NOT NULL,
      status TEXT NOT NULL,
      provider_ids TEXT,
      error TEXT,
      sent_by INTEGER NOT NULL,
      sent_at TEXT NOT NULL
    )`,
  ).run();
}

async function companyFromRequest(req: Request, env: Env) {
  const token = getCookie(req, COOKIE);
  if (!token) return 0;
  const row = await first(
    env,
    "SELECT company_id AS companyId FROM contractor_sessions WHERE token_hash=? AND datetime(expires_at)>datetime('now') LIMIT 1",
    [await sha256(token)],
  );
  return num(row?.companyId);
}
async function trialSession(req: Request, env: Env): Promise<TrialSession | null> {
  const token = getCookie(req, COOKIE);
  if (!token) return null;
  const row = await first(
    env,
    `SELECT s.company_id AS companyId,s.account_id AS accountId,
      COALESCE(NULLIF(s.active_role,''),a.role) AS role,
      a.status AS accountStatus,c.name AS companyName,c.licence_status AS licenceStatus
     FROM contractor_sessions s
     JOIN contractor_accounts a ON a.id=s.account_id AND a.company_id=s.company_id
     JOIN companies c ON c.id=s.company_id
     WHERE s.token_hash=? AND datetime(s.expires_at)>datetime('now') LIMIT 1`,
    [await sha256(token)],
  );
  if (!row || lower(row.accountStatus) !== "active") return null;
  return {
    companyId: num(row.companyId),
    accountId: num(row.accountId),
    role: lower(row.role),
    companyName: txt(row.companyName, 150),
    licenceStatus: lower(row.licenceStatus),
    token,
  };
}
async function companyName(env: Env, cid: number) {
  const row = await first(env, "SELECT name FROM companies WHERE id=? LIMIT 1", [cid]);
  return txt(row?.name || `Company ${cid}`, 150);
}
async function smsRecipients(env: Env, cid: number, kind: AlertKind) {
  const rows = await all(
    env,
    "SELECT phone,breakdown,service_due AS serviceDue,missing_report AS missingReport,po,critical FROM alert_contacts_v3 WHERE company_id=? AND active=1 AND phone IS NOT NULL AND trim(phone)<>''",
    [cid],
  );
  const selected = rows
    .filter((r) => kindEnabled(r, kind))
    .map((r) => normalizePhone(r.phone))
    .filter(Boolean);
  if (selected.length) return [...new Set(selected)].slice(0, 10);
  const fallback = await first(
    env,
    "SELECT contact_phone AS phone FROM company_settings_v3 WHERE company_id=? LIMIT 1",
    [cid],
  );
  const phone = normalizePhone(fallback?.phone);
  return phone ? [phone] : [];
}

async function deliverSms(
  env: Env,
  cid: number,
  kind: AlertKind,
  key: string,
  body: string,
) {
  await ensureSchema(env);
  const exists = await first(
    env,
    "SELECT id FROM operational_sms_audit_v1 WHERE alert_key=? LIMIT 1",
    [key],
  );
  if (exists) return false;
  const recipients = await smsRecipients(env, cid, kind);
  if (!recipients.length) return false;

  let status = "failed";
  let providerIds: string[] = [];
  let error = "";
  if (!smsConfigured(env)) {
    error =
      "Twilio SMS is not configured. Add TWILIO_ACCOUNT_SID, TWILIO_AUTH_TOKEN and a sender.";
  } else {
    const results = await sendTwilioSmsMany(env, recipients, trimSms(body));
    const ok = results.filter((r) => r.status === "sent");
    providerIds = ok.map((r) => r.providerId).filter(Boolean);
    error = results
      .filter((r) => r.status !== "sent")
      .map((r) => r.error)
      .filter(Boolean)
      .join(" | ");
    status = ok.length === results.length ? "sent" : ok.length ? "partial" : "failed";
  }

  await env.DB.prepare(
    "INSERT OR IGNORE INTO operational_sms_audit_v1(company_id,alert_key,alert_kind,recipients,status,provider_ids,error,created_at) VALUES(?,?,?,?,?,?,?,?)",
  )
    .bind(
      cid,
      key,
      kind,
      recipients.join(","),
      status,
      providerIds.join(","),
      error || null,
      new Date().toISOString(),
    )
    .run();
  return status === "sent" || status === "partial";
}

async function scanCompanySms(env: Env, cid: number) {
  if (!cid) return;
  const company = await companyName(env, cid);
  const today = zaDate();

  const events = await all(
    env,
    "SELECT id,fleet_number AS fleet,severity,system_name AS system,component,description,downtime_hours AS downtime,status FROM events WHERE company_id=? AND lower(status)<>'closed' ORDER BY id DESC LIMIT 300",
    [cid],
  );
  for (const e of events) {
    const sev = lower(e.severity);
    if (!["critical", "high"].includes(sev)) continue;
    const kind: AlertKind = sev === "critical" ? "critical" : "breakdown";
    await deliverSms(
      env,
      cid,
      kind,
      `event:${cid}:${e.id}:${sev}`,
      `TMM Asset Health | ${company} | ${sev.toUpperCase()} | ${txt(e.fleet, 50)} | ${txt(e.system, 45)}/${txt(e.component, 45)} | ${txt(e.description, 180)} | Downtime ${num(e.downtime).toFixed(2)} h. ${ORIGIN}/contractor-login`,
    );
  }

  const machines = await all(
    env,
    "SELECT id,fleet_number AS fleet,category,site,status,operating_hours AS hours,next_service_hours AS nextService FROM machines WHERE company_id=? AND next_service_hours IS NOT NULL",
    [cid],
  );
  for (const m of machines) {
    const remaining = num(m.nextService) - num(m.hours);
    if (remaining > 30) continue;
    const state = remaining <= 0 ? "OVERDUE" : "DUE SOON";
    const bucket = remaining <= 0 ? `overdue:${today}` : "warning";
    await deliverSms(
      env,
      cid,
      "service_due",
      `service:${cid}:${m.id}:${bucket}`,
      `TMM Asset Health | ${company} | SERVICE ${state} | ${txt(m.fleet, 50)} | Hour meter ${num(m.hours).toFixed(1)} | Due ${num(m.nextService).toFixed(1)} | ${remaining.toFixed(1)} h remaining. ${ORIGIN}/contractor-login`,
    );
  }

  const pos = await all(
    env,
    "SELECT id,order_number AS orderNumber,supplier,description,expected_delivery AS expectedDelivery,actual_delivery AS actualDelivery,order_status AS orderStatus,fleet_number AS fleet FROM purchase_orders WHERE company_id=? AND reminder_email=1 AND expected_delivery IS NOT NULL AND trim(expected_delivery)<>''",
    [cid],
  );
  for (const p of pos) {
    if (txt(p.actualDelivery)) continue;
    if (["delivered", "received", "cancelled", "closed"].includes(lower(p.orderStatus)))
      continue;
    const d = dayDiff(txt(p.expectedDelivery, 40));
    if (d > 3) continue;
    const label =
      d < 0
        ? "OVERDUE"
        : d === 0
          ? "DUE TODAY"
          : `DUE IN ${d} DAY${d === 1 ? "" : "S"}`;
    const bucket =
      d < 0 ? `overdue:${today}` : d === 0 ? "due-today" : "three-day-window";
    await deliverSms(
      env,
      cid,
      "po",
      `po:${cid}:${p.id}:${bucket}`,
      `TMM Asset Health | ${company} | PO ${label} | ${txt(p.orderNumber, 50)} | ${txt(p.supplier, 70)} | ${txt(p.description, 160)} | Expected ${txt(p.expectedDelivery, 30)}. ${ORIGIN}/contractor-login`,
    );
  }

  if (zaNow().getUTCHours() >= 18) {
    const report = await first(
      env,
      "SELECT id FROM daily_reports_v3 WHERE company_id=? AND report_date=? LIMIT 1",
      [cid, today],
    );
    if (!report)
      await deliverSms(
        env,
        cid,
        "missing_report",
        `missing-report:${cid}:${today}`,
        `TMM Asset Health | ${company} | MISSING DAILY REPORT | ${today} | No report found by 18:00 SAST. Please submit or follow up. ${ORIGIN}/contractor-login`,
      );
  }

  const repeats = await all(
    env,
    "SELECT fleet_number AS fleet,system_name AS system,component,COUNT(*) AS failures FROM events WHERE company_id=? AND datetime(created_at)>=datetime('now','-30 days') GROUP BY fleet_number,system_name,component HAVING COUNT(*)>=3 ORDER BY failures DESC LIMIT 50",
    [cid],
  );
  for (const r of repeats)
    await deliverSms(
      env,
      cid,
      "repeat_failure",
      `repeat:${cid}:${txt(r.fleet, 80)}:${txt(r.system, 80)}:${txt(r.component, 80)}:${today}`,
      `TMM Asset Health | ${company} | REPEAT FAILURE | ${txt(r.fleet, 50)} | ${txt(r.system, 50)}/${txt(r.component, 50)} | ${num(r.failures)} failures in 30 days. Engineering RCA recommended. ${ORIGIN}/contractor-login`,
    );
}

async function scanAllSms(env: Env) {
  const companies = await all(
    env,
    "SELECT id FROM companies WHERE lower(licence_status) IN ('active','trial')",
  );
  for (const company of companies) await scanCompanySms(env, num(company.id));
}
function shouldInstantScan(path: string) {
  return (
    path === "/company-admin/daily/manual" ||
    path === "/company-admin/daily/import" ||
    path.startsWith("/company-admin/fleet/") ||
    path === "/role/action" ||
    path === "/api/orders" ||
    path.startsWith("/api/orders/")
  );
}

function trialRedirect(message: string, tone = "ok") {
  return new Response(null, {
    status: 303,
    headers: {
      location: `/trial-demo?msg=${encodeURIComponent(message)}&tone=${tone}`,
      "cache-control": "no-store",
    },
  });
}
async function runTrialSms(req: Request, env: Env) {
  await ensureSchema(env);
  const s = await trialSession(req, env);
  if (!s) return trialRedirect("Sign in again before sending the SMS demonstration.", "err");
  if (!["company_admin", "admin"].includes(s.role))
    return trialRedirect("Company Administrator authority is required.", "err");
  if (!["active", "trial"].includes(s.licenceStatus))
    return trialRedirect("Licence access is not active.", "err");

  const form = await req.formData();
  if (txt(form.get("csrf")) !== (await sha256(s.token + "|trial-demo")))
    return trialRedirect("Security check failed.", "err");
  const batch = num(form.get("batch"));
  const owned = await first(
    env,
    "SELECT id,period_start AS start,period_end AS end FROM demo_import_batches_v1 WHERE id=? AND company_id=? LIMIT 1",
    [batch, s.companyId],
  );
  if (!owned) return trialRedirect("Trial import not found.", "err");

  const allowedRows = await all(
    env,
    "SELECT phone FROM alert_contacts_v3 WHERE company_id=? AND active=1 AND phone IS NOT NULL AND trim(phone)<>''",
    [s.companyId],
  );
  const allowed = new Set(allowedRows.map((r) => normalizePhone(r.phone)).filter(Boolean));
  const selected = [
    ...new Set(
      form
        .getAll("smsRecipient")
        .map((x) => normalizePhone(String(x)))
        .filter((x) => allowed.has(x)),
    ),
  ].slice(0, 10);
  if (!selected.length)
    return trialRedirect(
      "Select at least one SMS recipient with a valid phone number under Alert Contacts.",
      "err",
    );

  const preview = await all(
    env,
    "SELECT severity,fleet_number AS fleet,title,details FROM demo_alerts_v1 WHERE batch_id=? ORDER BY CASE severity WHEN 'critical' THEN 1 WHEN 'high' THEN 2 ELSE 3 END,id LIMIT 4",
    [batch],
  );
  const fallback = preview.length
    ? preview
    : await all(
        env,
        `SELECT severity,fleet_number AS fleet,
          COALESCE(NULLIF(fault_reason,''),'Unplanned downtime') AS title,
          printf('%.1f h downtime',unplanned_downtime) AS details
         FROM demo_import_records_v1
         WHERE batch_id=? AND (lower(severity) IN ('critical','high') OR unplanned_downtime>0)
         ORDER BY CASE lower(severity) WHEN 'critical' THEN 1 WHEN 'high' THEN 2 ELSE 3 END,unplanned_downtime DESC LIMIT 4`,
        [batch],
      );
  const totals = await first(
    env,
    "SELECT SUM(operating_hours) AS operating,SUM(unplanned_downtime) AS downtime FROM demo_import_records_v1 WHERE batch_id=?",
    [batch],
  );
  const headline = fallback.length
    ? fallback
        .slice(0, 3)
        .map(
          (a) =>
            `${txt(a.fleet || "Company", 30)} ${txt(a.severity, 12).toUpperCase()}: ${txt(a.title, 75)} (${txt(a.details, 55)})`,
        )
        .join(" | ")
    : "No high/critical historical condition detected in this import.";
  const message = trimSms(
    `HISTORICAL TRIAL - TMM Asset Health | ${s.companyName} | ${txt(owned.start, 10)} to ${txt(owned.end, 10)} | ${headline} | Operating ${num(totals?.operating).toFixed(1)} h, unplanned DT ${num(totals?.downtime).toFixed(1)} h. DEMO ONLY - NOT A LIVE INCIDENT.`,
  );

  const results = await sendTwilioSmsMany(env, selected, message);
  const ok = results.filter((r) => r.status === "sent");
  const errors = results
    .filter((r) => r.status !== "sent")
    .map((r) => r.error)
    .filter(Boolean)
    .join(" | ");
  const status = ok.length === results.length ? "sent" : ok.length ? "partial" : "failed";
  await env.DB.prepare(
    "INSERT INTO demo_sms_deliveries_v1(batch_id,company_id,recipients,status,provider_ids,error,sent_by,sent_at) VALUES(?,?,?,?,?,?,?,?)",
  )
    .bind(
      batch,
      s.companyId,
      selected.join(","),
      status,
      ok.map((r) => r.providerId).filter(Boolean).join(","),
      errors || null,
      s.accountId,
      new Date().toISOString(),
    )
    .run();

  if (status === "sent")
    return trialRedirect(`Historical Trial SMS sent to ${ok.length} selected recipient(s).`);
  return trialRedirect(
    `SMS delivery ${status}: ${errors || "No SMS was accepted by Twilio."}`,
    "err",
  );
}

async function enhanceTrialPage(req: Request, env: Env, response: Response) {
  if (req.method !== "GET" || response.status !== 200) return response;
  const type = response.headers.get("content-type") || "";
  if (!type.includes("text/html")) return response;
  const s = await trialSession(req, env);
  if (!s || !["company_admin", "admin"].includes(s.role)) return response;

  const rows = await all(
    env,
    "SELECT name,phone FROM alert_contacts_v3 WHERE company_id=? AND active=1 AND phone IS NOT NULL AND trim(phone)<>'' ORDER BY name",
    [s.companyId],
  );
  const contacts = [
    ...new Map(
      rows
        .map((r) => ({ name: txt(r.name, 120), phone: normalizePhone(r.phone) }))
        .filter((r) => r.phone)
        .map((r) => [r.phone, r]),
    ).values(),
  ];
  const block = `<h2 style="margin-top:16px">SMS demonstration recipients</h2><p class="muted">Live critical/high events use both email and SMS. Trial SMS messages are labelled HISTORICAL TRIAL.</p><div>${
    contacts.length
      ? contacts
          .map(
            (r) =>
              `<label style="display:block;padding:6px"><input type="checkbox" name="smsRecipient" value="${esc(r.phone)}"> <b>${esc(r.name)}</b> — SMS · ${esc(r.phone)}</label>`,
          )
          .join("")
      : '<p class="muted">No SMS contacts yet. Add a phone number under Dashboard → Alerts → Configure alert contacts.</p>'
  }</div><div class="actions"><button class="btn amber" type="submit">Send Email Demonstration</button><button class="btn" type="submit" formaction="/trial-demo/run-sms" ${contacts.length ? "" : "disabled"}>Send SMS Demonstration</button></div><p class="muted">SMS gateway: ${smsConfigured(env) ? "Twilio configured" : "Twilio waiting for Cloudflare secrets"}.</p>`;

  let body = await response.text();
  const needle = '<button class="btn amber" type="submit">Send Alert Demonstration</button>';
  if (body.includes(needle)) body = body.replace(needle, block);
  return new Response(body, { status: response.status, headers: response.headers });
}

async function enhanceAlertsPage(req: Request, env: Env, response: Response) {
  if (req.method !== "GET" || response.status !== 200) return response;
  const url = new URL(req.url);
  if (url.pathname !== "/contractor" || url.searchParams.get("view") !== "alerts")
    return response;
  const type = response.headers.get("content-type") || "";
  if (!type.includes("text/html")) return response;
  let body = await response.text();
  const marker = '<div class="pagehead"><div><h1>Alerts</h1>';
  if (body.includes(marker)) {
    const notice = `<div class="notice" style="margin-bottom:12px"><b>Email + SMS live alerts:</b> Critical/high breakdowns are sent immediately after a successful live event save. Service, missing-report, repeat-failure and enabled PO alerts use both channels. Enter numbers as 0XXXXXXXXX or +27XXXXXXXXX. SMS provider: ${smsConfigured(env) ? "Twilio connected" : "Twilio code installed — add Cloudflare secrets to activate sending"}.</div>`;
    body = body.replace(marker, `${notice}${marker}`);
  }
  return new Response(body, { status: response.status, headers: response.headers });
}

export default {
  async fetch(req: Request, env: Env, ctx: ExecutionContext): Promise<Response> {
    const path = new URL(req.url).pathname;
    if (req.method === "POST" && path === "/trial-demo/run-sms")
      return runTrialSms(req, env);

    const cid =
      req.method === "POST" && shouldInstantScan(path)
        ? await companyFromRequest(req, env)
        : 0;
    let response = await currentAlerts.fetch(req, env as never, ctx as never);
    if (path === "/trial-demo") response = await enhanceTrialPage(req, env, response);
    response = await enhanceAlertsPage(req, env, response);

    if (cid && response.status < 400)
      ctx.waitUntil(
        scanCompanySms(env, cid).catch((error) =>
          console.error("instant SMS alert scan failed", error),
        ),
      );
    return response;
  },

  async scheduled(
    controller: ScheduledController,
    env: Env,
    ctx: ExecutionContext,
  ) {
    await currentAlerts.scheduled(controller as never, env as never, ctx as never);
    ctx.waitUntil(
      scanAllSms(env).catch((error) =>
        console.error("scheduled SMS alert scan failed", error),
      ),
    );
  },
};
