import * as XLSX from "xlsx";

interface Env {
  DB: D1Database;
  BUCKET?: R2Bucket;
  RESEND_API_KEY?: string;
  NOTIFICATION_FROM_EMAIL?: string;
}
type Row = Record<string, unknown>;
type Session = {
  companyId: number;
  accountId: number;
  email: string;
  fullName: string;
  role: string;
  companyName: string;
  licenceStatus: string;
  token: string;
};
type DemoRow = {
  date: string;
  site: string;
  fleet: string;
  shift: number;
  planned: number;
  unplanned: number;
  operating: number;
  productive: number;
  tonnes: number;
  fault: string;
  severity: string;
  hourMeter: number | null;
};
const COOKIE = "sas_contractor_v2",
  enc = new TextEncoder();
let schemaReady: Promise<void> | null = null;
function esc(v: unknown) {
  return String(v ?? "").replace(
    /[&<>"']/g,
    (c) =>
      ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[
        c
      ] || c,
  );
}
function txt(v: unknown, n = 300) {
  return String(v ?? "")
    .trim()
    .slice(0, n);
}
function lower(v: unknown) {
  return txt(v).toLowerCase();
}
function num(v: unknown, f = 0) {
  const n = Number(v);
  return Number.isFinite(n) ? n : f;
}
function clamp(v: number, min = 0, max = 1e9) {
  return Math.max(min, Math.min(max, v));
}
function cookie(r: Request) {
  for (const p of (r.headers.get("cookie") || "").split(";")) {
    const i = p.indexOf("=");
    if (i > 0 && p.slice(0, i).trim() === COOKIE) return p.slice(i + 1).trim();
  }
  return "";
}
async function hash(v: string) {
  return Array.from(
    new Uint8Array(await crypto.subtle.digest("SHA-256", enc.encode(v))),
    (b) => b.toString(16).padStart(2, "0"),
  ).join("");
}
async function first(env: Env, sql: string, b: unknown[] = []) {
  return env.DB.prepare(sql)
    .bind(...b)
    .first<Row>();
}
async function all(env: Env, sql: string, b: unknown[] = []) {
  return (
    (
      await env.DB.prepare(sql)
        .bind(...b)
        .all<Row>()
    ).results || []
  );
}
async function session(req: Request, env: Env): Promise<Session | null> {
  const token = cookie(req);
  if (!token) return null;
  const r = await first(
    env,
    `SELECT s.company_id companyId,s.account_id accountId,a.email,a.full_name fullName,COALESCE(NULLIF(s.active_role,''),a.role) role,c.name companyName,c.licence_status licenceStatus FROM contractor_sessions s JOIN contractor_accounts a ON a.id=s.account_id JOIN companies c ON c.id=s.company_id WHERE s.token_hash=? AND datetime(s.expires_at)>datetime('now') AND a.status='active' LIMIT 1`,
    [await hash(token)],
  );
  return r
    ? {
        companyId: num(r.companyId),
        accountId: num(r.accountId),
        email: txt(r.email),
        fullName: txt(r.fullName),
        role: lower(r.role),
        companyName: txt(r.companyName),
        licenceStatus: lower(r.licenceStatus),
        token,
      }
    : null;
}
async function ensure(env: Env) {
  if (schemaReady) return schemaReady;
  schemaReady = (async () => {
    for (const q of [
      `CREATE TABLE IF NOT EXISTS demo_import_batches_v1(id INTEGER PRIMARY KEY AUTOINCREMENT,company_id INTEGER NOT NULL,source_file TEXT NOT NULL,object_key TEXT,period_start TEXT NOT NULL,period_end TEXT NOT NULL,status TEXT NOT NULL DEFAULT 'complete',total_rows INTEGER NOT NULL,matched_rows INTEGER NOT NULL,unmatched_rows INTEGER NOT NULL,outside_rows INTEGER NOT NULL DEFAULT 0,imported_by INTEGER NOT NULL,imported_at TEXT NOT NULL)`,
      `CREATE TABLE IF NOT EXISTS demo_import_records_v1(id INTEGER PRIMARY KEY AUTOINCREMENT,batch_id INTEGER NOT NULL,company_id INTEGER NOT NULL,report_date TEXT NOT NULL,site TEXT NOT NULL,fleet_number TEXT NOT NULL,shift_hours REAL NOT NULL,planned_downtime REAL NOT NULL,unplanned_downtime REAL NOT NULL,operating_hours REAL NOT NULL,productive_hours REAL NOT NULL,tonnes REAL NOT NULL,fault_reason TEXT,severity TEXT NOT NULL,hour_meter REAL,created_at TEXT NOT NULL)`,
      `CREATE INDEX IF NOT EXISTS idx_demo_records_company_batch ON demo_import_records_v1(company_id,batch_id,report_date)`,
      `CREATE TABLE IF NOT EXISTS demo_alerts_v1(id INTEGER PRIMARY KEY AUTOINCREMENT,batch_id INTEGER NOT NULL,company_id INTEGER NOT NULL,alert_kind TEXT NOT NULL,severity TEXT NOT NULL,fleet_number TEXT,title TEXT NOT NULL,details TEXT NOT NULL,would_email INTEGER NOT NULL DEFAULT 1,created_at TEXT NOT NULL)`,
      `CREATE INDEX IF NOT EXISTS idx_demo_alerts_batch ON demo_alerts_v1(batch_id,severity)`,
      `CREATE TABLE IF NOT EXISTS demo_alert_deliveries_v1(id INTEGER PRIMARY KEY AUTOINCREMENT,batch_id INTEGER NOT NULL,company_id INTEGER NOT NULL,recipients TEXT NOT NULL,alert_count INTEGER NOT NULL,status TEXT NOT NULL,provider_id TEXT,error TEXT,sent_by INTEGER NOT NULL,sent_at TEXT NOT NULL)`,
    ])
      await env.DB.prepare(q).run();
  })();
  return schemaReady;
}
function previousMonth() {
  const d = new Date();
  d.setUTCDate(1);
  d.setUTCMonth(d.getUTCMonth() - 1);
  const start = d.toISOString().slice(0, 7) + "-01";
  d.setUTCMonth(d.getUTCMonth() + 1);
  d.setUTCDate(0);
  return {
    start,
    end: d.toISOString().slice(0, 10),
    label: d.toLocaleString("en-ZA", {
      month: "long",
      year: "numeric",
      timeZone: "UTC",
    }),
  };
}
function normal(row: Row) {
  const n: Row = {};
  for (const [k, v] of Object.entries(row))
    n[k.toLowerCase().replace(/[^a-z0-9]/g, "")] = v;
  return n;
}
function dateValue(v: unknown) {
  if (typeof v === "number" && v > 20000) {
    const d = XLSX.SSF.parse_date_code(v);
    return d
      ? `${d.y}-${String(d.m).padStart(2, "0")}-${String(d.d).padStart(2, "0")}`
      : "";
  }
  const s = txt(v, 30);
  const iso = s.match(/^(\d{4})[-\/]([01]?\d)[-\/]([0-3]?\d)/);
  if (iso)
    return `${iso[1]}-${iso[2].padStart(2, "0")}-${iso[3].padStart(2, "0")}`;
  const za = s.match(/^([0-3]?\d)[-\/]([01]?\d)[-\/](\d{4})/);
  return za
    ? `${za[3]}-${za[2].padStart(2, "0")}-${za[1].padStart(2, "0")}`
    : "";
}
function parseRow(raw: Row, defaultShift: number): DemoRow | null {
  const n = normal(raw),
    fleet = txt(
      n.fleetnumber || n.fleet || n.machineid || n.machine || n.equipment,
      120,
    ),
    date = dateValue(n.reportdate || n.date || n.day);
  if (!fleet || !date) return null;
  const shift = clamp(
      num(n.shifthours ?? n.plannedhours ?? n.scheduledhours, defaultShift),
      0,
      48,
    ),
    planned = clamp(num(n.planneddowntime ?? n.planneddowntimehours), 0, shift),
    unplanned = clamp(
      num(
        n.unplanneddowntime ??
          n.breakdownhours ??
          n.downtimehours ??
          n.downtime,
      ),
      0,
      shift - planned,
    );
  const operating = clamp(
    num(
      n.operatinghours ?? n.runtime ?? n.workinghours,
      Math.max(0, shift - planned - unplanned),
    ),
    0,
    shift,
  );
  const productive = clamp(
    num(n.productivehours ?? n.utilisedhours ?? n.utilizedhours, operating),
    0,
    operating,
  );
  const hm =
    n.hourmeter == null && n.currenthours == null
      ? null
      : num(n.hourmeter ?? n.currenthours);
  return {
    date,
    site: txt(n.site || "Main Site", 120),
    fleet,
    shift,
    planned,
    unplanned,
    operating,
    productive,
    tonnes: clamp(num(n.tonnes ?? n.tonnage ?? n.production)),
    fault: txt(
      n.faultreason || n.faultcause || n.downtimereason || n.fault || n.cause,
      500,
    ),
    severity: ["low", "medium", "high", "critical"].includes(lower(n.severity))
      ? lower(n.severity)
      : unplanned >= 8
        ? "critical"
        : unplanned >= 4
          ? "high"
          : "medium",
    hourMeter: hm,
  };
}
function csvLine(line: string) {
  const a: string[] = [];
  let q = false,
    c = "";
  for (let i = 0; i < line.length; i++) {
    const x = line[i];
    if (x === '"') {
      if (q && line[i + 1] === '"') {
        c += '"';
        i++;
      } else q = !q;
    } else if (x === "," && !q) {
      a.push(c.trim());
      c = "";
    } else c += x;
  }
  a.push(c.trim());
  return a;
}
async function workbook(file: File) {
  const bytes = new Uint8Array(await file.arrayBuffer());
  if (file.name.toLowerCase().endsWith(".csv")) {
    const lines = new TextDecoder()
      .decode(bytes)
      .split(/\r?\n/)
      .filter((x) => x.trim());
    if (!lines.length) return [];
    const h = csvLine(lines[0]);
    return lines.slice(1).map((l) => {
      const r: Row = {};
      csvLine(l).forEach((v, i) => (r[h[i]] = v));
      return r;
    });
  }
  const wb = XLSX.read(bytes, { type: "array", cellDates: false });
  return XLSX.utils.sheet_to_json<Row>(wb.Sheets[wb.SheetNames[0]], {
    defval: "",
  });
}
function response(body: string, status = 200) {
  return new Response(body, {
    status,
    headers: {
      "content-type": "text/html; charset=utf-8",
      "cache-control": "private, no-store",
      "x-frame-options": "DENY",
      "content-security-policy":
        "default-src 'self'; style-src 'self' 'unsafe-inline'; script-src 'self' 'unsafe-inline'; img-src 'self' data:; frame-ancestors 'none'",
    },
  });
}
function redirect(msg: string, tone = "ok") {
  return new Response(null, {
    status: 303,
    headers: {
      location: `/trial-demo?msg=${encodeURIComponent(msg)}&tone=${tone}`,
    },
  });
}
function pct(a: number, b: number) {
  return b > 0 ? (a / b) * 100 : 0;
}
function fmt(n: number, d = 1) {
  return Number(n || 0).toLocaleString("en-ZA", { maximumFractionDigits: d });
}
function severityClass(v: unknown) {
  const s = lower(v);
  return s === "critical" ? "red" : s === "high" ? "amber" : "blue";
}
async function sendDemoEmail(
  env: Env,
  s: Session,
  batch: number,
  recipients: string[],
  alerts: Row[],
) {
  const critical = alerts.filter(
      (a) => lower(a.severity) === "critical",
    ).length,
    high = alerts.filter((a) => lower(a.severity) === "high").length,
    missing = alerts.filter((a) => a.alert_kind === "missing_report").length;
  const items = alerts
    .slice(0, 20)
    .map(
      (a) =>
        `<tr><td style="padding:7px;border-bottom:1px solid #e5e7eb"><b>${esc(String(a.severity).toUpperCase())}</b></td><td style="padding:7px;border-bottom:1px solid #e5e7eb">${esc(a.fleet_number || "Company")}</td><td style="padding:7px;border-bottom:1px solid #e5e7eb">${esc(a.title)}<br><small>${esc(a.details)}</small></td></tr>`,
    )
    .join("");
  const html = `<!doctype html><html><body style="font-family:Arial,sans-serif;background:#f3f6f5;color:#102230;padding:24px"><div style="max-width:760px;margin:auto;background:#fff;border:1px solid #dce5e1;border-radius:12px;overflow:hidden"><div style="background:#061827;color:#fff;padding:22px"><h2 style="margin:0">HISTORICAL TRIAL ALERT DEMONSTRATION</h2><p style="color:#e4ad17">TMM Asset Health · ${esc(s.companyName)}</p></div><div style="padding:22px"><p><b>This is a demonstration using previous-month records. It is not a current live incident.</b></p><p>${alerts.length} alerts would have triggered: ${critical} critical, ${high} high and ${missing} missing-report alerts.</p><table style="width:100%;border-collapse:collapse;font-size:12px"><tr><th align="left">Severity</th><th align="left">Fleet</th><th align="left">Alert</th></tr>${items}</table>${alerts.length > 20 ? `<p>And ${alerts.length - 20} more alerts. Sign in to view the complete demonstration.</p>` : ""}<p><a href="https://tmm-asset-health.mandlenkosisindane43.workers.dev/trial-demo" style="display:inline-block;background:#10975b;color:#fff;text-decoration:none;padding:11px 16px;border-radius:7px;font-weight:bold">Open Trial Analysis</a></p></div></div></body></html>`;
  let status = "failed",
    provider = "",
    error = "";
  if (!env.RESEND_API_KEY) error = "Email service is not configured";
  else
    try {
      const res = await fetch("https://api.resend.com/emails", {
        method: "POST",
        headers: {
          authorization: `Bearer ${env.RESEND_API_KEY}`,
          "content-type": "application/json",
        },
        body: JSON.stringify({
          from: txt(
            env.NOTIFICATION_FROM_EMAIL ||
              "TMM Asset Health <notifications@sindaneassetsolutions.co.za>",
            250,
          ),
          to: recipients,
          subject: `HISTORICAL TRIAL · ${alerts.length} TMM alerts · ${s.companyName}`,
          html,
          reply_to: "admin@sindaneassetsolutions.co.za",
        }),
      });
      const data = (await res.json().catch(() => ({}))) as Row;
      if (res.ok) {
        status = "sent";
        provider = txt(data.id);
      } else
        error = txt(
          data.message || `Email service returned ${res.status}`,
          500,
        );
    } catch (e) {
      error = e instanceof Error ? e.message : String(e);
    }
  await env.DB.prepare(
    "INSERT INTO demo_alert_deliveries_v1(batch_id,company_id,recipients,alert_count,status,provider_id,error,sent_by,sent_at) VALUES(?,?,?,?,?,?,?,?,?)",
  )
    .bind(
      batch,
      s.companyId,
      recipients.join(","),
      alerts.length,
      status,
      provider || null,
      error || null,
      s.accountId,
      new Date().toISOString(),
    )
    .run();
  return { status, error };
}
function bars(rows: Row[], value: string, label: string) {
  const max = Math.max(1, ...rows.map((r) => num(r[value])));
  return (
    rows
      .slice(0, 12)
      .map(
        (r) =>
          `<div class="barrow"><span>${esc(r[label])}</span><div class="track"><i style="width:${Math.min(100, (num(r[value]) / max) * 100)}%"></i></div><b>${fmt(num(r[value]))}</b></div>`,
      )
      .join("") || `<p class="empty">No data yet.</p>`
  );
}
function trend(rows: Row[]) {
  if (!rows.length) return `<p class="empty">No trend data yet.</p>`;
  const vals = rows.map((r) => num(r.availability)),
    max = 100,
    w = 640,
    h = 170;
  const points = vals
    .map(
      (v, i) =>
        `${20 + (i * (w - 40)) / Math.max(1, vals.length - 1)},${h - 20 - (clamp(v, 0, max) * (h - 40)) / max}`,
    )
    .join(" ");
  return `<svg viewBox="0 0 ${w} ${h}" role="img" aria-label="Daily availability trend"><line x1="20" y1="20" x2="20" y2="150" stroke="#dce5e1"/><line x1="20" y1="150" x2="620" y2="150" stroke="#dce5e1"/><polyline fill="none" stroke="#10975b" stroke-width="4" points="${points}"/>${vals.map((v, i) => `<circle cx="${20 + (i * (w - 40)) / Math.max(1, vals.length - 1)}" cy="${h - 20 - (clamp(v, 0, max) * (h - 40)) / max}" r="4" fill="#e6a800"><title>${esc(rows[i].date)}: ${fmt(v)}%</title></circle>`).join("")}</svg>`;
}
function css() {
  return `<style>*{box-sizing:border-box}body{margin:0;background:#f3f6f5;color:#102230;font-family:Inter,Arial,sans-serif}.top{background:#061827;color:#fff;padding:14px 5%;display:flex;justify-content:space-between;align-items:center}.top img{height:56px}.top a{color:#fff;text-decoration:none;margin-left:18px}.wrap{max-width:1500px;margin:auto;padding:22px}.hero,.panel,.kpi{background:#fff;border:1px solid #dce5e1;border-radius:12px}.hero{padding:20px;margin-bottom:13px;display:flex;justify-content:space-between;gap:15px}.hero h1{margin:0 0 5px}.hero p{margin:0;color:#64736f}.notice{padding:12px;border-radius:8px;background:#e9f7ef;color:#14653e;margin-bottom:12px}.notice.err{background:#fff0f0;color:#9e1c1c}.safe{background:#fff8df;border-left:4px solid #e4a900;padding:12px;margin:12px 0;font-size:12px}.kpis{display:grid;grid-template-columns:repeat(6,1fr);gap:10px}.kpi{padding:13px}.kpi small{display:block;color:#687872;font-size:10px}.kpi b{display:block;font-size:24px;margin-top:5px}.grid{display:grid;grid-template-columns:1fr 1fr;gap:12px;margin-top:12px}.panel{padding:15px}.panel h2{font-size:15px;margin:0 0 12px}.upload{display:grid;grid-template-columns:1fr auto;gap:10px;align-items:end}.field{display:grid;gap:5px;font-size:11px;font-weight:700}.field input{padding:10px;border:1px solid #cad5d0;border-radius:7px}.btn{border:0;border-radius:7px;background:#10975b;color:#fff;padding:11px 14px;font-weight:800;cursor:pointer}.btn.amber{background:#d58d00}.table{width:100%;border-collapse:collapse;font-size:10px}.table th{text-align:left;background:#f3f6f5;padding:8px}.table td{padding:8px;border-bottom:1px solid #e8eeeb}.pill{padding:3px 6px;border-radius:20px;background:#e7f3ff;color:#1768d5;font-weight:800}.pill.red{background:#ffe8e8;color:#bd1e1e}.pill.amber{background:#fff2d7;color:#a96800}.barrow{display:grid;grid-template-columns:110px 1fr 50px;gap:8px;align-items:center;font-size:10px;margin:9px 0}.track{height:8px;background:#e7eeeb;border-radius:9px;overflow:hidden}.track i{display:block;height:100%;background:#10975b}.chart svg{width:100%;height:190px}.empty{color:#77857f;text-align:center;padding:15px}.actions{display:flex;gap:8px;align-items:center}.muted{color:#718079;font-size:10px}@media(max-width:950px){.kpis{grid-template-columns:repeat(3,1fr)}.grid{grid-template-columns:1fr}}@media(max-width:600px){.kpis{grid-template-columns:1fr 1fr}.hero,.upload{display:block}.btn{margin-top:8px;width:100%}}</style>`;
}
async function importDemo(req: Request, env: Env, s: Session) {
  if (!["company_admin", "admin"].includes(s.role))
    return redirect("Company Administrator authority is required.", "err");
  const f = await req.formData(),
    file = f.get("file");
  if (!(file instanceof File) || !/\.(csv|xlsx|xls)$/i.test(file.name))
    return redirect("Choose a CSV or Excel report file.", "err");
  const csrf = txt(f.get("csrf"));
  if (csrf !== (await hash(s.token + "|trial-demo")))
    return redirect("Security check failed. Sign in again.", "err");
  const period = previousMonth(),
    settings = await first(
      env,
      "SELECT operating_hours hours FROM company_settings_v3 WHERE company_id=?",
      [s.companyId],
    ),
    fleetRows = await all(
      env,
      "SELECT fleet_number fleet FROM machines WHERE company_id=?",
      [s.companyId],
    ),
    fleets = new Map(fleetRows.map((x) => [lower(x.fleet), txt(x.fleet)]));
  if (!fleets.size)
    return redirect(
      "Register or import the fleet before uploading historical reports.",
      "err",
    );
  let objectKey = "";
  if (env.BUCKET) {
    objectKey = `company/${s.companyId}/trial-demo/${crypto.randomUUID()}-${file.name.replace(/[^a-zA-Z0-9._-]/g, "-")}`;
    await env.BUCKET.put(objectKey, await file.arrayBuffer(), {
      httpMetadata: { contentType: file.type || "application/octet-stream" },
    });
  }
  const raw = await workbook(file),
    parsed: DemoRow[] = [],
    unmatched = new Set<string>();
  let outside = 0;
  for (const r of raw) {
    const x = parseRow(r, num(settings?.hours, 24));
    if (!x) continue;
    if (x.date < period.start || x.date > period.end) {
      outside++;
      continue;
    }
    const canonical = fleets.get(lower(x.fleet));
    if (!canonical) {
      unmatched.add(x.fleet);
      continue;
    }
    x.fleet = txt(canonical, 120);
    parsed.push(x);
  }
  if (!parsed.length)
    return redirect(
      `No matching ${period.label} rows were found. Check dates and fleet numbers.${unmatched.size ? ` Unmatched: ${[...unmatched].slice(0, 5).join(", ")}.` : ""}`,
      "err",
    );
  const now = new Date().toISOString(),
    ins = await env.DB.prepare(
      "INSERT INTO demo_import_batches_v1(company_id,source_file,object_key,period_start,period_end,total_rows,matched_rows,unmatched_rows,outside_rows,imported_by,imported_at) VALUES(?,?,?,?,?,?,?,?,?,?,?)",
    )
      .bind(
        s.companyId,
        file.name,
        objectKey,
        period.start,
        period.end,
        raw.length,
        parsed.length,
        unmatched.size,
        outside,
        s.accountId,
        now,
      )
      .run(),
    batch = num(ins.meta?.last_row_id);
  for (const x of parsed) {
    await env.DB.prepare(
      "INSERT INTO demo_import_records_v1(batch_id,company_id,report_date,site,fleet_number,shift_hours,planned_downtime,unplanned_downtime,operating_hours,productive_hours,tonnes,fault_reason,severity,hour_meter,created_at) VALUES(?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)",
    )
      .bind(
        batch,
        s.companyId,
        x.date,
        x.site,
        x.fleet,
        x.shift,
        x.planned,
        x.unplanned,
        x.operating,
        x.productive,
        x.tonnes,
        x.fault || null,
        x.severity,
        x.hourMeter,
        now,
      )
      .run();
    await env.DB.prepare(
      "INSERT INTO production_records(company_id,report_date,fleet_number,shift_hours,planned_downtime,unplanned_downtime,operating_hours,productive_hours,tonnes,source_file,created_at) VALUES(?,?,?,?,?,?,?,?,?,?,?)",
    )
      .bind(
        s.companyId,
        x.date,
        x.fleet,
        x.shift,
        x.planned,
        x.unplanned,
        x.operating,
        x.productive,
        x.tonnes,
        `trial:${batch}:${file.name}`,
        now,
      )
      .run();
    await env.DB.prepare(
      "INSERT INTO daily_reports_v3(company_id,report_date,site,fleet_number,activity,capture_basis,time_value,time_unit,duration_hours,tonnes,fault_reason,severity,source_kind,source_file,created_by,status,created_at) VALUES(?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)",
    )
      .bind(
        s.companyId,
        x.date,
        x.site,
        x.fleet,
        x.unplanned > 0 ? "downtime" : "operating",
        "time",
        x.operating + x.unplanned,
        "hours",
        x.operating + x.unplanned,
        x.tonnes,
        x.fault || null,
        x.severity,
        "historical_trial",
        `trial:${batch}:${file.name}`,
        s.accountId,
        "saved",
        now,
      )
      .run();
    if (x.fault || x.unplanned > 0)
      await env.DB.prepare(
        "INSERT INTO events(company_id,fleet_number,event_type,severity,system_name,component,description,opened_at,closed_at,downtime_hours,status,action,oil_litres_lost,created_at) VALUES(?,?,?,?,?,?,?,?,?,?,?,?,?,?)",
      )
        .bind(
          s.companyId,
          x.fleet,
          "historical_breakdown",
          x.severity,
          "Historical import",
          "Historical import",
          x.fault || "Reported historical downtime",
          x.date + "T00:00:00.000Z",
          x.date + "T23:59:59.000Z",
          x.unplanned,
          "closed",
          "Historical trial import — no live notification",
          0,
          now,
        )
        .run();
    if (x.hourMeter != null)
      await env.DB.prepare(
        "UPDATE machines SET operating_hours=CASE WHEN operating_hours<? THEN ? ELSE operating_hours END WHERE company_id=? AND lower(fleet_number)=?",
      )
        .bind(x.hourMeter, x.hourMeter, s.companyId, lower(x.fleet))
        .run();
  }
  return redirect(
    `${parsed.length} ${period.label} row(s) matched and imported. ${unmatched.size} fleet number(s) unmatched; ${outside} row(s) outside the previous month.`,
  );
}
async function generateAlerts(
  env: Env,
  s: Session,
  batch: number,
  recipients: string[],
) {
  if (!["company_admin", "admin"].includes(s.role))
    return redirect("Company Administrator authority is required.", "err");
  const owned = await first(
    env,
    "SELECT id,period_start start,period_end end FROM demo_import_batches_v1 WHERE id=? AND company_id=?",
    [batch, s.companyId],
  );
  if (!owned) return redirect("Trial import not found.", "err");
  await env.DB.prepare(
    "DELETE FROM demo_alerts_v1 WHERE batch_id=? AND company_id=?",
  )
    .bind(batch, s.companyId)
    .run();
  const now = new Date().toISOString(),
    add = async (
      kind: string,
      sev: string,
      fleet: string,
      title: string,
      details: string,
    ) =>
      env.DB.prepare(
        "INSERT INTO demo_alerts_v1(batch_id,company_id,alert_kind,severity,fleet_number,title,details,created_at) VALUES(?,?,?,?,?,?,?,?)",
      )
        .bind(batch, s.companyId, kind, sev, fleet || null, title, details, now)
        .run();
  const faults = await all(
    env,
    "SELECT fleet_number fleet,fault_reason fault,severity,unplanned_downtime downtime,report_date date FROM demo_import_records_v1 WHERE batch_id=? AND (fault_reason IS NOT NULL OR unplanned_downtime>0)",
    [batch],
  );
  for (const x of faults)
    if (["critical", "high"].includes(lower(x.severity)))
      await add(
        "critical_condition",
        lower(x.severity),
        txt(x.fleet),
        `${String(x.severity).toUpperCase()} condition · ${txt(x.fleet)}`,
        `${txt(x.date)} · ${txt(x.fault) || "Unplanned downtime"} · ${fmt(num(x.downtime))} h downtime`,
      );
  const repeats = await all(
    env,
    "SELECT fleet_number fleet,lower(trim(fault_reason)) fault,COUNT(*) count FROM demo_import_records_v1 WHERE batch_id=? AND trim(COALESCE(fault_reason,''))<>'' GROUP BY fleet_number,lower(trim(fault_reason)) HAVING COUNT(*)>=2",
    [batch],
  );
  for (const x of repeats)
    await add(
      "repeat_failure",
      "high",
      txt(x.fleet),
      `Repeated failure · ${txt(x.fleet)}`,
      `${txt(x.fault)} occurred ${num(x.count)} times in the imported month.`,
    );
  const machines = await all(
    env,
    "SELECT fleet_number fleet,operating_hours hours,next_service_hours service FROM machines WHERE company_id=? AND next_service_hours IS NOT NULL",
    [s.companyId],
  );
  for (const m of machines) {
    const left = num(m.service) - num(m.hours);
    if (left <= 30)
      await add(
        "service_due",
        left <= 0 ? "critical" : "high",
        txt(m.fleet),
        `${left <= 0 ? "Overdue" : "Due soon"} service · ${txt(m.fleet)}`,
        `${fmt(Math.abs(left))} operating hour(s) ${left <= 0 ? "overdue" : "remaining"}.`,
      );
  }
  const dates: string[] = [];
  for (
    let d = new Date(txt(owned.start) + "T00:00:00Z"),
      end = new Date(txt(owned.end) + "T00:00:00Z");
    d <= end;
    d.setUTCDate(d.getUTCDate() + 1)
  )
    dates.push(d.toISOString().slice(0, 10));
  const reported = new Set(
    (
      await all(
        env,
        "SELECT DISTINCT report_date date,fleet_number fleet FROM demo_import_records_v1 WHERE batch_id=?",
        [batch],
      )
    ).map((x) => `${x.date}|${lower(x.fleet)}`),
  );
  for (const m of machines)
    for (const d of dates)
      if (!reported.has(`${d}|${lower(m.fleet)}`))
        await add(
          "missing_report",
          "medium",
          txt(m.fleet),
          `Missing daily report · ${txt(m.fleet)}`,
          `No report matched for ${d}.`,
        );
  const preview = await all(
    env,
    "SELECT * FROM demo_alerts_v1 WHERE batch_id=? ORDER BY CASE severity WHEN 'critical' THEN 1 WHEN 'high' THEN 2 ELSE 3 END,id",
    [batch],
  );
  const allowed = new Set(
    (
      await all(
        env,
        "SELECT lower(email) email FROM contractor_accounts WHERE company_id=? AND status='active' UNION SELECT lower(email) email FROM alert_contacts_v3 WHERE company_id=? AND active=1",
        [s.companyId, s.companyId],
      )
    )
      .map((x) => lower(x.email))
      .filter((x) => x.includes("@")),
  );
  const selected = [...new Set(recipients.map(lower))]
    .filter((x) => allowed.has(x))
    .slice(0, 10);
  if (!selected.length)
    return redirect("Select at least one valid demonstration recipient.", "err");
  const sent = await sendDemoEmail(env, s, batch, selected, preview);
  return sent.status === "sent"
    ? redirect(
        `${preview.length} alert preview(s) emailed to ${selected.length} selected recipient(s).`,
      )
    : redirect(
        `${preview.length} previews were generated, but email failed: ${sent.error}`,
        "err",
      );
}
async function page(req: Request, env: Env, s: Session) {
  const url = new URL(req.url),
    batchRow = await first(
      env,
      "SELECT * FROM demo_import_batches_v1 WHERE company_id=? ORDER BY id DESC LIMIT 1",
      [s.companyId],
    ),
    batch = num(batchRow?.id),
    rows = batch
      ? await all(
          env,
          "SELECT * FROM demo_import_records_v1 WHERE batch_id=?",
          [batch],
        )
      : [],
    sum = (k: string) => rows.reduce((a, r) => a + num(r[k]), 0),
    shift = sum("shift_hours"),
    planned = sum("planned_downtime"),
    unplanned = sum("unplanned_downtime"),
    operating = sum("operating_hours"),
    productive = sum("productive_hours"),
    tonnes = sum("tonnes"),
    availability = pct(operating, Math.max(0, shift - planned)),
    utilisation = pct(productive, shift);
  const machines = batch
      ? await all(
          env,
          "SELECT fleet_number fleet,SUM(shift_hours) shift,SUM(planned_downtime) planned,SUM(unplanned_downtime) unplanned,SUM(operating_hours) operating,SUM(tonnes) tonnes,100.0*SUM(operating_hours)/NULLIF(SUM(shift_hours)-SUM(planned_downtime),0) availability FROM demo_import_records_v1 WHERE batch_id=? GROUP BY fleet_number ORDER BY availability",
          [batch],
        )
      : [],
    days = batch
      ? await all(
          env,
          "SELECT report_date date,100.0*SUM(operating_hours)/NULLIF(SUM(shift_hours)-SUM(planned_downtime),0) availability,SUM(tonnes) tonnes FROM demo_import_records_v1 WHERE batch_id=? GROUP BY report_date ORDER BY report_date",
          [batch],
        )
      : [],
    faults = batch
      ? await all(
          env,
          "SELECT COALESCE(NULLIF(trim(fault_reason),''),'Unspecified downtime') fault,COUNT(*) count,SUM(unplanned_downtime) hours FROM demo_import_records_v1 WHERE batch_id=? AND (unplanned_downtime>0 OR trim(COALESCE(fault_reason,''))<>'') GROUP BY COALESCE(NULLIF(trim(fault_reason),''),'Unspecified downtime') ORDER BY hours DESC",
          [batch],
        )
      : [],
    alerts = batch
      ? await all(
          env,
          "SELECT * FROM demo_alerts_v1 WHERE batch_id=? ORDER BY CASE severity WHEN 'critical' THEN 1 WHEN 'high' THEN 2 ELSE 3 END,id DESC LIMIT 200",
          [batch],
        )
      : [];
  const recipients = await all(
    env,
    "SELECT lower(email) email,full_name name,role FROM contractor_accounts WHERE company_id=? AND status='active' AND trim(email)<>'' UNION SELECT lower(email) email,name,'Alert contact' role FROM alert_contacts_v3 WHERE company_id=? AND active=1 AND trim(email)<>'' ORDER BY name",
    [s.companyId, s.companyId],
  ).catch(() => []);
  const work = await all(
      env,
      "SELECT fleet_number fleet,title,status,priority,assigned_to assignedTo,due_at dueAt FROM work_orders WHERE company_id=? ORDER BY id DESC LIMIT 80",
      [s.companyId],
    ).catch(() => []),
    missing = alerts.filter((a) => a.alert_kind === "missing_report").length,
    repeats = alerts.filter((a) => a.alert_kind === "repeat_failure");
  const roleTitle: { [k: string]: string } = {
    company_admin: "Company Admin",
    admin: "Company Admin",
    engineer: "Engineer",
    mechanic: "Mechanic",
    supervisor: "Supervisor",
    manager: "Mine Manager",
  };
  const csrf = await hash(s.token + "|trial-demo"),
    flash = txt(url.searchParams.get("msg"), 500),
    admin = ["company_admin", "admin"].includes(s.role);
  let rolePanel = "";
  if (s.role === "engineer")
    rolePanel = `<div class="panel"><h2>Engineering analysis</h2>${bars(faults, "hours", "fault")}<h2>Repeated failures</h2>${repeats.map((x) => `<p><span class="pill amber">HIGH</span> <b>${esc(x.fleet)}</b> — ${esc(x.details)}</p>`).join("") || '<p class="empty">No repeated failure pattern detected.</p>'}</div>`;
  else if (s.role === "mechanic")
    rolePanel = `<div class="panel"><h2>Mechanic work queue</h2><table class="table"><tr><th>Fleet</th><th>Job</th><th>Status</th><th>Due</th></tr>${
      work
        .filter(
          (x) =>
            !x.assignedTo ||
            lower(x.assignedTo) === lower(s.fullName) ||
            lower(x.assignedTo) === lower(s.email),
        )
        .map(
          (x) =>
            `<tr><td>${esc(x.fleet)}</td><td>${esc(x.title)}</td><td>${esc(x.status)}</td><td>${esc(x.dueAt || "—")}</td></tr>`,
        )
        .join("") ||
      '<tr><td colspan="4" class="empty">No assigned or unassigned jobs.</td></tr>'
    }</table></div>`;
  else if (s.role === "supervisor")
    rolePanel = `<div class="panel"><h2>Shift and job-card control</h2><p><b>${work.filter((x) => !["closed", "completed"].includes(lower(x.status))).length}</b> incomplete work orders · <b>${missing}</b> missing historical reports</p><table class="table"><tr><th>Fleet</th><th>Job</th><th>Status</th><th>Assigned</th></tr>${work
      .slice(0, 20)
      .map(
        (x) =>
          `<tr><td>${esc(x.fleet)}</td><td>${esc(x.title)}</td><td>${esc(x.status)}</td><td>${esc(x.assignedTo || "Unassigned")}</td></tr>`,
      )
      .join("")}</table></div>`;
  else if (s.role === "manager")
    rolePanel = `<div class="panel"><h2>Mine management risk view</h2>${machines
      .slice(0, 10)
      .map(
        (x) =>
          `<div class="barrow"><span>${esc(x.fleet)}</span><div class="track"><i style="width:${clamp(num(x.availability), 0, 100)}%"></i></div><b>${fmt(num(x.availability))}%</b></div>`,
      )
      .join(
        "",
      )}<p class="muted">Lowest-availability fleet appears first. Imported records contain operational KPIs only; costs appear when cost fields are captured in production workflows.</p></div>`;
  else
    rolePanel = `<div class="panel"><h2>Company control view</h2><p><b>${machines.length}</b> fleet units reported · <b>${missing}</b> missing machine-days · <b>${alerts.filter((x) => ["critical", "high"].includes(lower(x.severity))).length}</b> critical/high alert previews.</p>${bars(machines, "tonnes", "fleet")}</div>`;
  const pieTotal = Math.max(1, operating + planned + unplanned),
    p1 = (operating / pieTotal) * 100,
    p2 = p1 + (planned / pieTotal) * 100;
  return response(
    `<!doctype html><html><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>Previous Month Trial · TMM Asset Health</title>${css()}</head><body><header class="top"><img src="/sindane-logo.png" alt="Sindane Asset Solutions"><div><a href="/contractor">Dashboard</a><a href="/select-role">Switch Role</a></div></header><main class="wrap"><section class="hero"><div><h1>Previous Month Trial / Demo</h1><p>${esc(s.companyName)} · ${esc(roleTitle[s.role] || s.role)} view${batchRow ? ` · ${esc(batchRow.period_start)} to ${esc(batchRow.period_end)}` : ""}</p></div><span class="pill">${esc(s.licenceStatus.toUpperCase())} LICENCE</span></section>${flash ? `<div class="notice ${url.searchParams.get("tone") === "err" ? "err" : ""}">${esc(flash)}</div>` : ""}<div class="safe"><b>Controlled demonstration:</b> importing history is silent. Emails are sent only after the Company Admin selects recipients and presses Send Alert Demonstration. Every email is labelled HISTORICAL TRIAL.</div>${admin ? `<div class="panel"><h2>Import the previous calendar month</h2><form class="upload" method="post" action="/trial-demo/import" enctype="multipart/form-data"><input type="hidden" name="csrf" value="${csrf}"><label class="field">Excel or CSV daily report<input type="file" name="file" accept=".csv,.xlsx,.xls" required></label><button class="btn" type="submit">Match Fleet & Import</button></form><p class="muted">Required: Date and Fleet Number. Supported: Site, Shift Hours, Planned Downtime, Unplanned Downtime, Operating Hours, Productive Hours, Tonnes, Fault Cause, Severity and Hour Meter.</p>${batch ? `<form method="post" action="/trial-demo/run-alerts"><input type="hidden" name="batch" value="${batch}"><input type="hidden" name="csrf" value="${csrf}"><h2>Select demonstration recipients</h2><div>${recipients.map((r) => `<label style="display:block;padding:6px"><input type="checkbox" name="recipient" value="${esc(r.email)}"> <b>${esc(r.name)}</b> — ${esc(r.role)} · ${esc(r.email)}</label>`).join("") || '<p class="muted">Add active users or alert contacts before sending.</p>'}</div><button class="btn amber" type="submit">Send Alert Demonstration</button></form>` : ""}</div>` : ""}${
      batch
        ? `<div class="kpis"><div class="kpi"><small>Availability</small><b>${fmt(availability)}%</b></div><div class="kpi"><small>Utilisation</small><b>${fmt(utilisation)}%</b></div><div class="kpi"><small>Production</small><b>${fmt(tonnes)} t</b></div><div class="kpi"><small>Operating</small><b>${fmt(operating)} h</b></div><div class="kpi"><small>Unplanned DT</small><b>${fmt(unplanned)} h</b></div><div class="kpi"><small>Missing Reports</small><b>${missing}</b></div></div><div class="grid"><div class="panel chart"><h2>Daily availability trend</h2>${trend(days)}</div><div class="panel"><h2>Operating vs downtime</h2><div style="width:170px;height:170px;border-radius:50%;margin:auto;background:conic-gradient(#10975b 0 ${p1}%,#e4a900 ${p1}% ${p2}%,#d82b2b ${p2}% 100%);position:relative"><div style="position:absolute;inset:36px;border-radius:50%;background:#fff;display:grid;place-content:center;text-align:center"><b>${fmt(availability)}%</b><small>available</small></div></div><p style="text-align:center"><span style="color:#10975b">●</span> Operating ${fmt(operating)} h &nbsp; <span style="color:#e4a900">●</span> Planned ${fmt(planned)} h &nbsp; <span style="color:#d82b2b">●</span> Unplanned ${fmt(unplanned)} h</p></div>${rolePanel}<div class="panel"><h2>Machine comparison</h2>${bars(machines, "availability", "fleet")}</div><div class="panel"><h2>Fault causes and downtime</h2>${bars(faults, "hours", "fault")}</div><div class="panel"><h2>Alert demonstration preview</h2><table class="table"><tr><th>Severity</th><th>Fleet</th><th>Would trigger</th><th>Details</th></tr>${
            alerts
              .slice(0, 30)
              .map(
                (a) =>
                  `<tr><td><span class="pill ${severityClass(a.severity)}">${esc(a.severity)}</span></td><td>${esc(a.fleet_number || "Company")}</td><td>${esc(a.title)}</td><td>${esc(a.details)}</td></tr>`,
              )
              .join("") ||
            '<tr><td colspan="4" class="empty">Admin can run the alert demonstration to generate previews.</td></tr>'
          }</table></div></div>`
        : `<div class="panel empty"><h2>No historical trial imported yet</h2><p>The Company Admin should register the fleet, then upload the previous month's Excel or CSV daily reports here.</p></div>`
    }</main></body></html>`,
  );
}
export async function handleTrialDemo(
  req: Request,
  env: Env,
): Promise<Response | null> {
  const path = new URL(req.url).pathname;
  if (!path.startsWith("/trial-demo")) return null;
  await ensure(env);
  const s = await session(req, env);
  if (!s)
    return new Response(null, {
      status: 302,
      headers: { location: "/contractor-login?next=/trial-demo" },
    });
  if (!["active", "trial"].includes(s.licenceStatus))
    return response("Licence access is not active.", 403);
  if (req.method === "POST" && path === "/trial-demo/import")
    return importDemo(req, env, s);
  if (req.method === "POST" && path === "/trial-demo/run-alerts") {
    const f = await req.formData();
    if (txt(f.get("csrf")) !== (await hash(s.token + "|trial-demo")))
      return redirect("Security check failed.", "err");
    return generateAlerts(
      env,
      s,
      num(f.get("batch")),
      f.getAll("recipient").map(String),
    );
  }
  if (req.method !== "GET") return response("Method not allowed", 405);
  return page(req, env, s);
}
