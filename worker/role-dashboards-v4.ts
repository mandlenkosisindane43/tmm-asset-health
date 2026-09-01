export interface RoleDashboardEnv {
  DB: D1Database;
}

type RoleSession = {
  companyId: number;
  accountId: number;
  email: string;
  fullName: string;
  role: string;
  companyName: string;
};

type Row = Record<string, unknown>;
const COOKIE = "sas_contractor_v2";
const enc = new TextEncoder();

function esc(v: unknown) {
  return String(v ?? "").replace(
    /[&<>"']/g,
    (c) =>
      ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[
        c
      ] || c,
  );
}
function n(v: unknown, fallback = 0) {
  const x = Number(v);
  return Number.isFinite(x) ? x : fallback;
}
function clamp(v: number, min = 0, max = 100) {
  return Math.max(min, Math.min(max, v));
}
function pct(v: number) {
  return `${clamp(v).toFixed(1)}%`;
}
function isoDate(d = new Date()) {
  return d.toISOString().slice(0, 10);
}
function daysAgo(days: number) {
  const d = new Date();
  d.setUTCDate(d.getUTCDate() - days);
  return isoDate(d);
}
function shortDate(v: unknown) {
  const s = String(v || "");
  return s.length >= 10 ? s.slice(5, 10).replace("-", "/") : s;
}
function roleTitle(role: string) {
  return (
    (
      {
        engineer: "Engineer",
        supervisor: "Supervisor",
        mechanic: "Mechanic",
        manager: "Mine Manager",
      } as Record<string, string>
    )[role] || role
  );
}
function getCookie(request: Request) {
  const raw = request.headers.get("cookie") || "";
  for (const part of raw.split(";")) {
    const i = part.indexOf("=");
    if (i > -1 && part.slice(0, i).trim() === COOKIE)
      return part.slice(i + 1).trim();
  }
  return "";
}
async function sha256(value: string) {
  const bytes = new Uint8Array(
    await crypto.subtle.digest("SHA-256", enc.encode(value)),
  );
  return Array.from(bytes, (b) => b.toString(16).padStart(2, "0")).join("");
}
async function getSession(
  request: Request,
  env: RoleDashboardEnv,
): Promise<RoleSession | null> {
  const token = getCookie(request);
  if (!token) return null;
  try {
    const row = await env.DB.prepare(
      `SELECT s.company_id AS companyId,s.account_id AS accountId,s.expires_at AS sessionExpires,a.email,a.full_name AS fullName,a.role,a.status AS accountStatus,c.name AS companyName,c.licence_status AS licenceStatus,c.expires_at AS licenceExpires,c.grace_days AS graceDays FROM contractor_sessions s JOIN contractor_accounts a ON a.id=s.account_id AND a.company_id=s.company_id JOIN companies c ON c.id=s.company_id WHERE s.token_hash=? LIMIT 1`,
    )
      .bind(await sha256(token))
      .first<Row>();
    if (
      !row ||
      String(row.accountStatus) !== "active" ||
      new Date(String(row.sessionExpires)).getTime() < Date.now()
    )
      return null;
    const status = String(row.licenceStatus || "").toLowerCase();
    const end =
      new Date(String(row.licenceExpires)).getTime() +
      n(row.graceDays) * 86400000;
    if (!["active", "trial"].includes(status) || Date.now() > end) return null;
    return {
      companyId: n(row.companyId),
      accountId: n(row.accountId),
      email: String(row.email || ""),
      fullName: String(row.fullName || ""),
      role: String(row.role || ""),
      companyName: String(row.companyName || ""),
    };
  } catch {
    return null;
  }
}
async function all(env: RoleDashboardEnv, sql: string, binds: unknown[] = []) {
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
async function first(
  env: RoleDashboardEnv,
  sql: string,
  binds: unknown[] = [],
) {
  try {
    return await env.DB.prepare(sql)
      .bind(...binds)
      .first<Row>();
  } catch {
    return null;
  }
}

const css = `<style>
*{box-sizing:border-box}html,body{margin:0;background:#f5f7f9;color:#122033;font-family:Inter,Arial,Helvetica,sans-serif}.layout{min-height:100vh;display:grid;grid-template-columns:258px minmax(0,1fr)}.sidebar{height:100vh;position:sticky;top:0;background:linear-gradient(180deg,#061827 0%,#041321 70%,#061a2b 100%);color:#fff;padding:14px 13px;display:flex;flex-direction:column;overflow:hidden}.brand{height:108px;display:grid;place-items:center;border-bottom:1px solid rgba(255,255,255,.09);margin-bottom:10px}.brand img{width:180px;height:96px;object-fit:contain}.nav{display:grid;gap:3px;overflow:auto;padding:2px 0 8px}.nav a{color:#f3f7fa;text-decoration:none;font-size:13px;padding:10px 11px;border-radius:8px;display:flex;gap:11px;align-items:center}.nav a span{width:20px;text-align:center;font-size:17px}.nav a.active,.nav a:hover{background:#11975c}.sitebox,.profile{border:1px solid rgba(255,255,255,.12);border-radius:9px;padding:10px 12px;margin-top:8px}.sitebox small,.profile small{display:block;color:#9db0bf;font-size:9px;margin-bottom:4px}.sitebox b,.profile b{font-size:12px}.profile{display:flex;gap:9px;align-items:center}.avatar{width:37px;height:37px;border-radius:50%;display:grid;place-items:center;background:#0b8853;color:#fff;font-weight:900}.signout{margin-top:8px;border-top:1px solid rgba(255,255,255,.1);padding-top:8px}.signout button{width:100%;background:transparent;border:0;color:#dce7ee;text-align:left;padding:8px;cursor:pointer}.main{min-width:0}.top{height:62px;background:#061827;color:#fff;display:flex;align-items:center;justify-content:space-between;padding:0 22px;position:sticky;top:0;z-index:10}.top-left{display:flex;align-items:center;gap:14px;min-width:0}.hamb{font-size:22px}.search{width:min(390px,34vw);height:37px;border:1px solid #314456;background:#0b2236;border-radius:7px;color:#b7c6d1;padding:0 14px;display:flex;align-items:center;font-size:11px}.top-right{display:flex;align-items:center;gap:10px;font-size:11px}.top-pill{border:1px solid #314456;background:#0a2033;border-radius:7px;padding:9px 11px;white-space:nowrap}.userdot{width:32px;height:32px;border-radius:50%;background:#24405a;display:grid;place-items:center;font-weight:800}.content{padding:18px;max-width:1680px;margin:auto}.headline{display:flex;justify-content:space-between;gap:12px;align-items:center;margin-bottom:13px}.headline h1{font-size:25px;margin:0}.headline p{font-size:11px;color:#637083;margin:3px 0 0}.tenant{font-size:10px;color:#08794b;background:#eaf7f0;border:1px solid #ccebd9;border-radius:999px;padding:7px 10px;font-weight:800}.kpis{display:grid;grid-template-columns:repeat(5,minmax(0,1fr));gap:11px;margin-bottom:11px}.kpi{background:#fff;border:1px solid #dfe5ea;border-radius:9px;padding:13px;min-height:112px;position:relative;overflow:hidden}.kpi .label{font-size:9px;font-weight:900;letter-spacing:.02em;color:#3d4958}.kpi .value{font-size:27px;font-weight:900;margin:6px 0 2px}.kpi .sub{font-size:10px;color:#667386}.green{color:#0b9a50}.amber{color:#e79a00}.red{color:#e22626}.blue{color:#1768d5}.purple{color:#7a3fe0}.spark{position:absolute;left:10px;right:10px;bottom:8px;height:28px}.grid{display:grid;gap:11px}.g3{grid-template-columns:1fr 1.1fr 1.15fr}.g2{grid-template-columns:1.4fr .8fr}.g4{grid-template-columns:repeat(4,1fr)}.panel{background:#fff;border:1px solid #dfe5ea;border-radius:9px;padding:13px;min-width:0}.panel h2{font-size:11px;margin:0 0 11px;letter-spacing:.02em}.panel h3{font-size:10px;margin:0 0 8px;color:#445165}.panel-footer{border-top:1px solid #edf0f3;margin-top:9px;padding-top:8px;color:#0d66d0;font-size:10px;font-weight:800}.table{width:100%;border-collapse:collapse;font-size:9px}.table th{text-align:left;background:#f6f8fa;color:#526071;padding:7px 6px;border-bottom:1px solid #dfe5ea;white-space:nowrap}.table td{padding:7px 6px;border-bottom:1px solid #edf0f3;vertical-align:middle}.pill{display:inline-block;border-radius:5px;padding:3px 6px;font-size:8px;font-weight:800;background:#e7f7ed;color:#078645}.pill.red{background:#fff0f0;color:#d92727}.pill.amber{background:#fff6e6;color:#d98200}.pill.blue{background:#edf4ff;color:#1768d5}.barrow{display:grid;grid-template-columns:115px 1fr 38px;gap:8px;align-items:center;margin:9px 0;font-size:9px}.track{height:5px;background:#e8edf1;border-radius:5px;overflow:hidden}.fill{height:100%;background:#11a253;border-radius:5px}.fill.amberbg{background:#efab13}.fill.redbg{background:#ea3b3b}.minirow{display:flex;justify-content:space-between;gap:8px;font-size:9px;padding:6px 0;border-bottom:1px solid #edf0f3}.donut{width:112px;height:112px;border-radius:50%;position:relative;margin:auto}.donut:after{content:'';position:absolute;inset:23px;background:#fff;border-radius:50%}.donutlabel{position:absolute;inset:0;z-index:2;display:grid;place-content:center;text-align:center;font-size:10px;font-weight:900}.donutlabel strong{font-size:20px}.donutwrap{display:grid;grid-template-columns:128px 1fr;gap:10px;align-items:center}.legend{display:grid;gap:7px;font-size:9px}.dot{width:8px;height:8px;border-radius:50%;display:inline-block;margin-right:5px}.empty{color:#7a8794;text-align:center;padding:26px 8px;font-size:10px}.smallcards{display:grid;grid-template-columns:repeat(6,1fr);gap:9px}.smallcard{background:#fff;border:1px solid #dfe5ea;border-radius:8px;padding:11px;text-align:center;min-height:88px}.smallcard b{display:block;font-size:20px;margin:6px 0}.smallcard small{font-size:8px;color:#667386}.chartbox{height:175px;display:flex;align-items:center;justify-content:center}.chartbox svg{width:100%;height:100%}.note{font-size:9px;line-height:1.55;padding:7px 0;border-bottom:1px solid #edf0f3}.metricline{display:grid;grid-template-columns:repeat(4,1fr);gap:8px}.metricline>div{text-align:center;border-right:1px solid #edf0f3}.metricline>div:last-child{border-right:0}.metricline b{display:block;font-size:20px}.metricline small{font-size:8px;color:#687586}.section-gap{margin-top:11px}.progress{height:7px;background:#e6ebef;border-radius:8px;overflow:hidden}.progress span{display:block;height:100%;background:#11975c}.subtle{font-size:8px;color:#748292}.security{margin-top:12px;text-align:center;font-size:9px;color:#748292}.roleaccent{color:#e6a800;font-weight:900}.sitecards{display:grid;grid-template-columns:repeat(2,1fr);gap:7px}.sitecard{border:1px solid #e4e9ed;border-radius:7px;padding:9px}.sitecard b{font-size:11px}.sitecard small{display:block;font-size:8px;color:#6c7987;margin-top:3px}
@media(max-width:1250px){.layout{grid-template-columns:210px 1fr}.kpis{grid-template-columns:repeat(3,1fr)}.g3,.g2{grid-template-columns:1fr}.smallcards{grid-template-columns:repeat(3,1fr)}}@media(max-width:800px){.layout{display:block}.sidebar{position:relative;height:auto}.brand{height:90px}.nav{grid-template-columns:repeat(3,1fr)}.nav a{font-size:0;justify-content:center}.nav a span{font-size:19px}.sitebox,.profile{display:none}.top{position:relative}.search{display:none}.content{padding:11px}.kpis{grid-template-columns:1fr 1fr}.g3,.g2,.g4{grid-template-columns:1fr}.smallcards{grid-template-columns:1fr 1fr}.headline h1{font-size:20px}}
</style>`;

function spark(values: number[], color = "#11975c") {
  if (!values.length) values = [0, 0, 0, 0, 0, 0, 0];
  const max = Math.max(...values, 1),
    min = Math.min(...values, 0),
    range = Math.max(1, max - min);
  const pts = values
    .map(
      (v, i) =>
        `${(i / Math.max(1, values.length - 1)) * 100},${27 - ((v - min) / range) * 23}`,
    )
    .join(" ");
  return `<svg class="spark" viewBox="0 0 100 30" preserveAspectRatio="none"><polyline fill="none" stroke="${color}" stroke-width="1.7" points="${pts}"/></svg>`;
}
function lineChart(
  labels: string[],
  a: number[],
  b: number[] = [],
  colors = ["#11975c", "#1768d5"],
) {
  const vals = [...a, ...b];
  const max = Math.max(...vals, 1);
  const mk = (arr: number[]) =>
    arr
      .map(
        (v, i) =>
          `${35 + (i / Math.max(1, arr.length - 1)) * 560},${145 - (v / max) * 115}`,
      )
      .join(" ");
  const x = labels
    .map(
      (l, i) =>
        `<text x="${35 + (i / Math.max(1, labels.length - 1)) * 560}" y="168" text-anchor="middle" font-size="8" fill="#6b7785">${esc(l)}</text>`,
    )
    .join("");
  return `<svg viewBox="0 0 620 180" preserveAspectRatio="none"><line x1="35" y1="145" x2="600" y2="145" stroke="#dce3e8"/><line x1="35" y1="30" x2="35" y2="145" stroke="#dce3e8"/><polyline fill="none" stroke="${colors[0]}" stroke-width="2.4" points="${mk(a)}"/>${b.length ? `<polyline fill="none" stroke="${colors[1]}" stroke-width="2.4" points="${mk(b)}"/>` : ""}${x}</svg>`;
}
function bars(labels: string[], values: number[], color = "#1768d5") {
  const max = Math.max(...values, 1);
  const w = 520 / Math.max(1, values.length);
  return `<svg viewBox="0 0 620 180" preserveAspectRatio="none"><line x1="35" y1="145" x2="600" y2="145" stroke="#dce3e8"/>${values
    .map((v, i) => {
      const h = (v / max) * 105;
      const x = 48 + i * w;
      return `<rect x="${x}" y="${145 - h}" width="${Math.max(10, w * 0.48)}" height="${h}" fill="${color}" rx="2"/><text x="${x + Math.max(10, w * 0.48) / 2}" y="165" text-anchor="middle" font-size="7" fill="#687586">${esc(labels[i] || "")}</text>`;
    })
    .join("")}</svg>`;
}
function donut(
  value: number,
  label: string,
  colors = ["#11975c", "#e9a500", "#e53232"],
) {
  const v = clamp(value);
  return `<div class="donut" style="background:conic-gradient(${colors[0]} 0 ${v}%,${colors[1]} ${v}% ${Math.min(100, v + (100 - v) * 0.6)}%,${colors[2]} ${Math.min(100, v + (100 - v) * 0.6)}% 100%)"><div class="donutlabel"><strong>${v.toFixed(1)}%</strong>${esc(label)}</div></div>`;
}
function kpi(
  label: string,
  value: string,
  sub: string,
  tone: string,
  values: number[],
) {
  const color =
    tone === "red"
      ? "#e22626"
      : tone === "amber"
        ? "#e79a00"
        : tone === "blue"
          ? "#1768d5"
          : tone === "purple"
            ? "#7a3fe0"
            : "#11975c";
  return `<div class="kpi"><div class="label">${esc(label)}</div><div class="value ${tone}">${esc(value)}</div><div class="sub">${esc(sub)}</div>${spark(values, color)}</div>`;
}

function navFor(role: string) {
  if (role === "engineer")
    return [
      ["⌂", "Dashboard", "#top"],
      ["▣", "Fleet Overview", "#machines"],
      ["▦", "Machines", "#machines"],
      ["▤", "Work Orders", "#workorders"],
      ["◉", "Inspections", "#inspections"],
      ["⌕", "Maintenance", "#service"],
      ["⌁", "Condition Monitoring", "#health"],
      ["△", "Faults", "#faults"],
      ["▰", "Parts & Inventory", "#workorders"],
      ["▱", "Documents", "/contractor?view=documents"],
      ["▥", "Reports", "/contractor-reports"],
      ["▥", "Analytics", "#faults"],
    ];
  if (role === "supervisor")
    return [
      ["⌂", "Dashboard", "#top"],
      ["◷", "Shift Control", "#shift"],
      ["▤", "Job Cards", "#jobs"],
      ["♙", "Work Management", "#jobs"],
      ["▣", "Assets", "#machines"],
      ["◉", "Inspections", "#inspections"],
      ["⌕", "Maintenance", "#jobs"],
      ["⌁", "Condition Monitoring", "#faults"],
      ["▰", "Parts & Inventory", "#parts"],
      ["▤", "Permits", "#shift"],
      ["▥", "Reports", "/contractor-reports"],
      ["♧", "Alerts", "#faults"],
      ["▱", "Documents", "/contractor?view=documents"],
    ];
  if (role === "mechanic")
    return [
      ["⌂", "Dashboard", "#top"],
      ["▤", "My Jobs", "#jobs"],
      ["△", "Faults", "#faults"],
      ["✓", "Checklists", "#checks"],
      ["▰", "Parts & Inventory", "#parts"],
      ["⌕", "Maintenance", "#maintenance"],
      ["◉", "Inspections", "#checks"],
      ["▱", "Documents", "/contractor?view=documents"],
      ["▥", "Reports", "/contractor-reports"],
    ];
  return [
    ["⌂", "Dashboard", "#top"],
    ["▦", "Multi-Site Overview", "#sites"],
    ["▣", "Assets", "#assets"],
    ["◉", "Health Monitor", "#assets"],
    ["⌕", "Maintenance", "#work"],
    ["▤", "Work Orders", "#work"],
    ["✓", "Compliance", "#compliance"],
    ["▰", "Inventory", "#work"],
    ["▥", "Reports", "/contractor-reports"],
    ["▥", "Analytics", "#trends"],
    ["▱", "Documents", "/contractor?view=documents"],
    ["♧", "Alerts", "#alerts"],
  ];
}
function shell(s: RoleSession, body: string, site: string) {
  const nav = [...navFor(s.role), ["◈", "Trial Analysis", "/trial-demo"]];
  return `<!doctype html><html><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>${esc(roleTitle(s.role))} Dashboard · TMM Asset Health</title>${css}</head><body><div class="layout"><aside class="sidebar"><div class="brand"><img src="/sindane-logo-sidebar.svg" alt="Sindane Asset Solutions"></div><nav class="nav">${nav.map((x, i) => `<a class="${i === 0 ? "active" : ""}" href="${x[2]}"><span>${x[0]}</span>${esc(x[1])}</a>`).join("")}</nav><div class="sitebox"><small>Current Site / Company</small><b>${esc(site || s.companyName)}</b></div><div class="profile"><div class="avatar">${esc((s.fullName || "U").slice(0, 1).toUpperCase())}</div><div><b>${esc(s.fullName)}</b><small>${esc(roleTitle(s.role))}</small></div></div><form class="signout" method="post" action="/api/contractor/logout"><button type="submit">↪ &nbsp; Sign out</button></form></aside><main class="main"><header class="top"><div class="top-left"><span class="hamb">☰</span><div class="search">⌕ &nbsp; Search machines, faults, work orders, inspections…</div></div><div class="top-right"><span class="top-pill">⌖ ${esc(site || s.companyName)}</span><span class="top-pill">▤ Last 30 days</span><span>↻</span><span>♧</span><span>?</span><span class="userdot">${esc((s.fullName || "U").slice(0, 1).toUpperCase())}</span><span><b>${esc(s.fullName)}</b><br><small>${esc(roleTitle(s.role))}</small></span></div></header>${body}</main></div></body></html>`;
}
function html(body: string, status = 200) {
  return new Response(body, {
    status,
    headers: {
      "content-type": "text/html; charset=utf-8",
      "cache-control": "private, no-store",
      "x-frame-options": "DENY",
      "referrer-policy": "same-origin",
      "content-security-policy":
        "default-src 'self'; style-src 'self' 'unsafe-inline'; img-src 'self' data:; frame-ancestors 'none'; base-uri 'self'",
    },
  });
}

async function loadCommon(env: RoleDashboardEnv, s: RoleSession) {
  const cid = s.companyId;
  const machines = await all(
    env,
    "SELECT id,fleet_number AS fleet,category,site,status,operating_hours AS hours,next_service_hours AS nextService FROM machines WHERE company_id=? ORDER BY fleet_number LIMIT 500",
    [cid],
  );
  const events = await all(
    env,
    "SELECT id,fleet_number AS fleet,severity,system_name AS system,component,description,opened_at AS openedAt,closed_at AS closedAt,downtime_hours AS downtime,status,spares_status AS spares FROM events WHERE company_id=? AND opened_at>=? ORDER BY opened_at DESC LIMIT 500",
    [cid, daysAgo(90)],
  );
  const production = await all(
    env,
    "SELECT report_date AS date,fleet_number AS fleet,shift_hours AS shiftHours,planned_downtime AS planned,unplanned_downtime AS unplanned,operating_hours AS operating,productive_hours AS productive,tonnes FROM production_records WHERE company_id=? AND report_date>=? ORDER BY report_date",
    [cid, daysAgo(45)],
  );
  const work = await all(
    env,
    "SELECT id,fleet_number AS fleet,title,priority,assigned_to AS assignedTo,due_at AS dueAt,status,created_at AS createdAt FROM work_orders WHERE company_id=? ORDER BY id DESC LIMIT 300",
    [cid],
  );
  const reports = await all(
    env,
    "SELECT report_date AS date,site,fleet_number AS fleet,activity,capture_basis AS basis,duration_hours AS duration,tonnes,fault_reason AS fault,severity,created_by AS createdBy,created_at AS createdAt FROM daily_reports_v3 WHERE company_id=? ORDER BY id DESC LIMIT 300",
    [cid],
  );
  const settings = await first(
    env,
    "SELECT operating_hours AS operatingHours,daily_production_target AS target,availability_target AS availabilityTarget,default_site AS defaultSite FROM company_settings_v3 WHERE company_id=? LIMIT 1",
    [cid],
  );
  const sites = await all(
    env,
    "SELECT name,code FROM company_sites WHERE company_id=? AND active=1 ORDER BY name",
    [cid],
  );
  const orders = await all(
    env,
    "SELECT order_number AS orderNo,fleet_number AS fleet,description,order_status AS status,expected_delivery AS expected,responsible_person AS responsible FROM purchase_orders WHERE company_id=? ORDER BY id DESC LIMIT 100",
    [cid],
  );
  return {
    machines,
    events,
    production,
    work,
    reports,
    settings,
    sites,
    orders,
  };
}
function aggregate(common: Awaited<ReturnType<typeof loadCommon>>) {
  const { machines, events, production } = common;
  const available = machines.filter(
    (m) =>
      !["down", "maintenance", "inactive", "retired"].includes(
        String(m.status || "").toLowerCase(),
      ),
  ).length;
  const total = machines.length;
  const readiness = total ? (available / total) * 100 : 0;
  const operating = production.reduce((a, r) => a + n(r.operating), 0),
    productive = production.reduce((a, r) => a + n(r.productive), 0),
    planned = production.reduce((a, r) => a + n(r.planned), 0),
    unplanned = production.reduce((a, r) => a + n(r.unplanned), 0),
    tonnes = production.reduce((a, r) => a + n(r.tonnes), 0),
    shift = production.reduce((a, r) => a + n(r.shiftHours), 0);
  const availability =
    operating + planned + unplanned > 0
      ? (operating / (operating + planned + unplanned)) * 100
      : readiness;
  const utilization =
    shift > 0 ? (productive / shift) * 100 : operating > 0 ? 100 : 0;
  const openEvents = events.filter(
    (e) => String(e.status || "").toLowerCase() !== "closed",
  );
  const critical = openEvents.filter((e) =>
    ["critical", "high"].includes(String(e.severity || "").toLowerCase()),
  ).length;
  const openWork = common.work.filter(
    (w) =>
      !["completed", "closed", "cancelled"].includes(
        String(w.status || "").toLowerCase(),
      ),
  );
  return {
    available,
    total,
    readiness,
    operating,
    productive,
    planned,
    unplanned,
    tonnes,
    shift,
    availability,
    utilization,
    openEvents,
    critical,
    openWork,
  };
}
function dailySeries(production: Row[], key: string, days = 7) {
  const dates = Array.from({ length: days }, (_, i) => daysAgo(days - 1 - i));
  const values = dates.map((d) =>
    production
      .filter((r) => String(r.date) === d)
      .reduce((a, r) => a + n(r[key]), 0),
  );
  return { dates: dates.map((d) => d.slice(5)), values };
}
function healthScore(machine: Row, events: Row[]) {
  let score = 100;
  const status = String(machine.status || "").toLowerCase();
  if (status === "down") score -= 45;
  else if (status === "maintenance") score -= 20;
  else if (status === "attention") score -= 15;
  const ev = events.filter(
    (e) =>
      String(e.fleet) === String(machine.fleet) &&
      String(e.status || "").toLowerCase() !== "closed",
  );
  for (const e of ev)
    score -=
      String(e.severity).toLowerCase() === "critical"
        ? 25
        : String(e.severity).toLowerCase() === "high"
          ? 15
          : 6;
  return clamp(score);
}
function compliance(machine: Row) {
  const hours = n(machine.hours),
    due = machine.nextService == null ? null : n(machine.nextService);
  if (due == null) return 100;
  const remaining = due - hours;
  if (remaining < 0) return clamp(60 + remaining / 20);
  if (remaining <= 50) return 75;
  if (remaining <= 250) return 85;
  return 96;
}

async function engineer(
  env: RoleDashboardEnv,
  s: RoleSession,
  c: Awaited<ReturnType<typeof loadCommon>>,
) {
  const a = aggregate(c),
    series = dailySeries(c.production, "unplanned"),
    planned = dailySeries(c.production, "planned");
  const scores = c.machines.map((m) => healthScore(m, c.events));
  const avg = scores.length
    ? scores.reduce((x, y) => x + y, 0) / scores.length
    : 0;
  const maintenanceDue = c.machines.filter(
    (m) => m.nextService != null && n(m.nextService) - n(m.hours) <= 250,
  ).length;
  const systems = new Map<string, number>();
  c.events.forEach((e) =>
    systems.set(
      String(e.system || "Other"),
      (systems.get(String(e.system || "Other")) || 0) + 1,
    ),
  );
  const pareto = [...systems.entries()].sort((x, y) => y[1] - x[1]).slice(0, 8);
  const mtbf = (fleet: string) => {
    const ops = c.production
      .filter((r) => String(r.fleet) === fleet)
      .reduce((x, r) => x + n(r.operating), 0);
    const fails = c.events.filter((e) => String(e.fleet) === fleet).length;
    return fails ? ops / fails : ops;
  };
  const body = `<div class="content" id="top"><div class="headline"><div><h1>Engineer Dashboard</h1><p>${esc(s.companyName)} · Engineering reliability and asset health</p></div><span class="tenant">✓ Tenant-isolated company data</span></div><div class="kpis">${kpi("FLEET READINESS", pct(a.readiness), `${a.available} of ${a.total} available`, "green", series.values)}${kpi("AVERAGE HEALTH SCORE", `${avg.toFixed(0)} /100`, avg >= 80 ? "Good" : avg >= 55 ? "Moderate" : "Needs attention", "amber", scores.slice(-7))}${kpi("ACTIVE BREAKDOWNS", String(a.openEvents.length), `Across ${new Set(a.openEvents.map((e) => e.fleet)).size} machines`, "red", series.values)}${kpi(
    "PLANNED MAINTENANCE",
    String(maintenanceDue),
    "Due within 250 hours",
    "amber",
    c.machines
      .slice(-7)
      .map((m) => Math.max(0, 250 - (n(m.nextService) - n(m.hours)))),
  )}${kpi("CONDITION ALERTS", String(a.critical), "Critical / high severity", "red", series.values)}</div>
  <div class="grid g3"><section class="panel" id="service"><h2>SERVICE COMPLIANCE (BY MACHINE)</h2>${
    c.machines
      .slice(0, 6)
      .map((m) => {
        const v = compliance(m);
        return `<div class="barrow"><span><b>${esc(m.fleet)}</b><br><small>${esc(m.category)}</small></span><div class="track"><div class="fill ${v < 70 ? "redbg" : v < 85 ? "amberbg" : ""}" style="width:${v}%"></div></div><b>${v.toFixed(0)}%</b></div>`;
      })
      .join("") ||
    '<div class="empty">Register machines to populate compliance.</div>'
  }<div class="panel-footer">View all compliance →</div></section><section class="panel"><h2>DOWNTIME TREND (HOURS)</h2><div class="chartbox">${lineChart(series.dates, series.values, planned.values, ["#e53232", "#8995a1"])}</div><div class="panel-footer">Red: unplanned · Grey: planned</div></section><section class="panel" id="faults"><h2>FAULT CAUSES (PARETO)</h2><div class="chartbox">${bars(
    pareto.map((x) => x[0].slice(0, 10)),
    pareto.map((x) => x[1]),
  )}</div><div class="panel-footer">Fault analytics by system →</div></section></div>
  <div class="grid g3 section-gap"><section class="panel" id="workorders"><h2>OPEN WORK ORDERS (${a.openWork.length})</h2>${
    a.openWork.length
      ? `<table class="table"><thead><tr><th>WO #</th><th>Machine</th><th>Description</th><th>Priority</th><th>Status</th></tr></thead><tbody>${a.openWork
          .slice(0, 6)
          .map(
            (w) =>
              `<tr><td>WO-${w.id}</td><td><b>${esc(w.fleet)}</b></td><td>${esc(w.title)}</td><td><span class="pill ${String(w.priority).toLowerCase() === "high" ? "red" : String(w.priority).toLowerCase() === "medium" ? "amber" : ""}">${esc(w.priority)}</span></td><td>${esc(w.status)}</td></tr>`,
          )
          .join("")}</tbody></table>`
      : '<div class="empty">No open work orders.</div>'
  }<div class="panel-footer">View work orders →</div></section><section class="panel" id="inspections"><h2>RECENT INSPECTIONS / DAILY CHECKS</h2>${
    c.reports.length
      ? `<table class="table"><thead><tr><th>Machine</th><th>Date</th><th>Activity</th><th>Status</th></tr></thead><tbody>${c.reports
          .slice(0, 6)
          .map(
            (r) =>
              `<tr><td><b>${esc(r.fleet)}</b></td><td>${esc(r.date)}</td><td>${esc(r.activity)}</td><td><span class="pill ${r.fault ? "red" : ""}">${r.fault ? "Attention" : "Pass"}</span></td></tr>`,
          )
          .join("")}</tbody></table>`
      : '<div class="empty">No daily checks recorded.</div>'
  }<div class="panel-footer">View inspections →</div></section><section class="panel" id="health"><h2>HEALTH SCORE DISTRIBUTION</h2><div class="donutwrap">${donut(scores.length ? (scores.filter((x) => x >= 80).length / scores.length) * 100 : 0, "Good")}<div class="legend"><span><i class="dot" style="background:#11975c"></i>Good (80–100): ${scores.filter((x) => x >= 80).length}</span><span><i class="dot" style="background:#e9a500"></i>Moderate (50–79): ${scores.filter((x) => x >= 50 && x < 80).length}</span><span><i class="dot" style="background:#e53232"></i>Poor (0–49): ${scores.filter((x) => x < 50).length}</span></div></div><div class="panel-footer">Health details →</div></section></div>
  <section class="panel section-gap" id="machines"><h2>MACHINE SUMMARY</h2>${
    c.machines.length
      ? `<table class="table"><thead><tr><th>Machine ID</th><th>Type</th><th>Site</th><th>Status</th><th>Health</th><th>MTBF h</th><th>Service Compliance</th><th>Next Service</th><th>Critical Faults</th><th>Availability</th></tr></thead><tbody>${c.machines
          .slice(0, 12)
          .map((m, i) => {
            const score = scores[i] || 0,
              crit = c.events.filter(
                (e) =>
                  String(e.fleet) === String(m.fleet) &&
                  ["critical", "high"].includes(
                    String(e.severity).toLowerCase(),
                  ) &&
                  String(e.status) !== "closed",
              ).length;
            return `<tr><td><b class="blue">${esc(m.fleet)}</b></td><td>${esc(m.category)}</td><td>${esc(m.site)}</td><td>${esc(m.status)}</td><td><span class="pill ${score < 50 ? "red" : score < 80 ? "amber" : ""}">${score.toFixed(0)}</span></td><td>${mtbf(String(m.fleet)).toFixed(1)}</td><td>${compliance(m).toFixed(0)}%</td><td>${m.nextService == null ? "—" : n(m.nextService).toFixed(0)}</td><td>${crit}</td><td>${pct(a.availability)}</td></tr>`;
          })
          .join("")}</tbody></table>`
      : '<div class="empty">No machines registered.</div>'
  }</section><div class="security">◈ All figures are filtered by company ID ${s.companyId} from the secure login session.</div></div>`;
  return html(
    shell(
      s,
      body,
      String(c.settings?.defaultSite || c.machines[0]?.site || s.companyName),
    ),
  );
}

async function supervisor(
  env: RoleDashboardEnv,
  s: RoleSession,
  c: Awaited<ReturnType<typeof loadCommon>>,
) {
  const a = aggregate(c),
    today = isoDate(),
    todayProd = c.production.filter((r) => String(r.date) === today),
    todayReports = c.reports.filter((r) => String(r.date) === today),
    todayEvents = c.events.filter(
      (r) => String(r.openedAt).slice(0, 10) === today,
    );
  const op = todayProd.reduce((x, r) => x + n(r.operating), 0),
    tons = todayProd.reduce((x, r) => x + n(r.tonnes), 0);
  const open = a.openWork,
    inprog = open.filter((w) =>
      String(w.status).toLowerCase().includes("progress"),
    ).length,
    onhold = open.filter((w) =>
      String(w.status).toLowerCase().includes("hold"),
    ).length,
    completed = c.work.filter(
      (w) => String(w.status).toLowerCase() === "completed",
    ).length;
  const series = dailySeries(c.production, "productive");
  const down = dailySeries(c.production, "unplanned");
  const body = `<div class="content" id="top"><div class="headline"><div><h1>Supervisor Dashboard</h1><p>${esc(s.companyName)} · Shift control, people, jobs and performance</p></div><span class="tenant">✓ Tenant-isolated company data</span></div><div class="grid g3" id="shift"><section class="panel"><h2>SHIFT CONTROL</h2><h3>Current Day Shift</h3><div class="progress"><span style="width:${Math.min(100, (new Date().getUTCHours() / 24) * 100)}%"></span></div><div class="minirow"><span>Registered machines</span><b>${a.total}</b></div><div class="minirow"><span>Available now</span><b>${a.available}</b></div><div class="panel-footer">Shift overview →</div></section><section class="panel"><h2>DAY / SHIFT SUMMARY</h2><div class="metricline"><div><b>${a.available}</b><small>Machines Available</small></div><div><b class="green">${pct(a.availability)}</b><small>Availability</small></div><div><b class="blue">${op.toFixed(1)} h</b><small>Operating Hours</small></div><div><b class="blue">${tons.toLocaleString()} t</b><small>Tonnes</small></div></div><div class="panel-footer">Live daily production data</div></section><section class="panel"><h2>JOB CARD ASSIGNMENT</h2><div class="metricline"><div><b>${open.length}</b><small>Open</small></div><div><b class="blue">${inprog}</b><small>In Progress</small></div><div><b class="amber">${onhold}</b><small>On Hold</small></div><div><b>${completed}</b><small>Completed</small></div></div><div class="panel-footer">Job board →</div></section></div>
  <div class="grid g3 section-gap"><section class="panel"><h2>CREW WORKLOAD</h2><div class="donutwrap">${donut(open.length ? Math.min(100, (open.length / Math.max(1, a.total)) * 100) : 0, "Workload")}<div class="legend"><span><i class="dot" style="background:#e53232"></i>High: ${open.filter((w) => String(w.priority).toLowerCase() === "high").length}</span><span><i class="dot" style="background:#e9a500"></i>Medium: ${open.filter((w) => String(w.priority).toLowerCase() === "medium").length}</span><span><i class="dot" style="background:#11975c"></i>Low: ${open.filter((w) => String(w.priority).toLowerCase() === "low").length}</span></div></div></section><section class="panel" id="faults"><h2>OPEN FAULTS</h2><div class="metricline"><div><b class="red">${a.openEvents.filter((e) => String(e.severity).toLowerCase() === "critical").length}</b><small>Critical</small></div><div><b class="amber">${a.openEvents.filter((e) => String(e.severity).toLowerCase() === "high").length}</b><small>High</small></div><div><b>${a.openEvents.filter((e) => String(e.severity).toLowerCase() === "medium").length}</b><small>Medium</small></div><div><b>${a.openEvents.length}</b><small>Total</small></div></div><div class="panel-footer">Fault register →</div></section><section class="panel"><h2>MACHINE AVAILABILITY (TODAY)</h2><div class="donutwrap">${donut(a.availability, "Availability")}<div class="legend"><span>Available: <b>${a.available}</b></span><span>Down: <b class="red">${c.machines.filter((m) => String(m.status).toLowerCase() === "down").length}</b></span><span>Maintenance: <b>${c.machines.filter((m) => String(m.status).toLowerCase() === "maintenance").length}</b></span></div></div></section></div>
  <div class="smallcards section-gap"><div class="smallcard"><small>SAFETY OBSERVATIONS</small><b>0</b><small>Ready for capture module</small></div><div class="smallcard" id="inspections"><small>REPORTS / INSPECTIONS TODAY</small><b>${todayReports.length}</b><small>${todayReports.filter((r) => !r.fault).length} clear</small></div><div class="smallcard"><small>SHIFT PRODUCTIVITY</small><b>${pct(a.utilization)}</b><small>From production records</small></div><div class="smallcard"><small>EQUIPMENT UTILISATION</small><b>${pct(a.utilization)}</b><small>Current period</small></div><div class="smallcard" id="parts"><small>PARTS / PO ITEMS</small><b>${c.orders.length}</b><small>${c.orders.filter((o) => !["delivered", "closed"].includes(String(o.status).toLowerCase())).length} open</small></div><div class="smallcard"><small>SERVICE DUE</small><b>${c.machines.filter((m) => m.nextService != null && n(m.nextService) - n(m.hours) <= 250).length}</b><small>Within 250 h</small></div></div>
  <div class="grid g2 section-gap"><section class="panel" id="jobs"><h2>OPEN JOBS OVERVIEW</h2>${
    open.length
      ? `<table class="table"><thead><tr><th>Job Card</th><th>Asset</th><th>Description</th><th>Priority</th><th>Assigned To</th><th>Status</th><th>Due</th></tr></thead><tbody>${open
          .slice(0, 10)
          .map(
            (w) =>
              `<tr><td>JC-${w.id}</td><td><b>${esc(w.fleet)}</b></td><td>${esc(w.title)}</td><td><span class="pill ${String(w.priority).toLowerCase() === "high" ? "red" : String(w.priority).toLowerCase() === "medium" ? "amber" : ""}">${esc(w.priority)}</span></td><td>${esc(w.assignedTo || "Unassigned")}</td><td>${esc(w.status)}</td><td>${esc(
                String(w.dueAt || "—")
                  .slice(0, 16)
                  .replace("T", " "),
              )}</td></tr>`,
          )
          .join("")}</tbody></table>`
      : '<div class="empty">No open jobs.</div>'
  }</section><section class="panel"><h2>SHIFT NOTES / LIVE EVENTS</h2>${
    todayEvents
      .slice(0, 7)
      .map(
        (e) =>
          `<div class="note"><b>${esc(e.fleet)}</b> — ${esc(e.description)}<br><span class="subtle">${esc(e.severity)} · ${esc(String(e.openedAt).slice(11, 16))}</span></div>`,
      )
      .join("") || '<div class="empty">No new events today.</div>'
  }</section></div>
  <div class="grid g3 section-gap" id="machines"><section class="panel"><h2>MACHINE STATUS BY AREA</h2><table class="table"><thead><tr><th>Site</th><th>Operational</th><th>Down</th><th>Maintenance</th><th>Total</th></tr></thead><tbody>${[
    ...new Set(c.machines.map((m) => String(m.site || "Main Site"))),
  ]
    .map((site) => {
      const ms = c.machines.filter(
        (m) => String(m.site || "Main Site") === site,
      );
      return `<tr><td>${esc(site)}</td><td class="green">${ms.filter((m) => !["down", "maintenance"].includes(String(m.status).toLowerCase())).length}</td><td class="red">${ms.filter((m) => String(m.status).toLowerCase() === "down").length}</td><td class="amber">${ms.filter((m) => String(m.status).toLowerCase() === "maintenance").length}</td><td>${ms.length}</td></tr>`;
    })
    .join(
      "",
    )}</tbody></table></section><section class="panel"><h2>SHIFT PERFORMANCE</h2><div class="chartbox">${bars(series.dates, series.values)}</div><div class="panel-footer">Productive hours by day</div></section><section class="panel"><h2>DOWNTIME BY CAUSE</h2><div class="donutwrap">${donut(Math.min(100, (down.values.reduce((x, y) => x + y, 0) / Math.max(1, op + down.values.reduce((x, y) => x + y, 0))) * 100), "Downtime", ["#e53232", "#e9a500", "#1768d5"])}<div class="legend">${[
    ...new Map(c.events.map((e) => [String(e.system || "Other"), 0])).keys(),
  ]
    .slice(0, 4)
    .map(
      (sys) =>
        `<span>${esc(sys)}: ${c.events
          .filter((e) => String(e.system || "Other") === sys)
          .reduce((x, e) => x + n(e.downtime), 0)
          .toFixed(1)} h</span>`,
    )
    .join(
      "",
    )}</div></div></section></div><div class="security">◈ All shift information is restricted to company ID ${s.companyId}.</div></div>`;
  return html(
    shell(
      s,
      body,
      String(c.settings?.defaultSite || c.machines[0]?.site || s.companyName),
    ),
  );
}

async function mechanic(
  env: RoleDashboardEnv,
  s: RoleSession,
  c: Awaited<ReturnType<typeof loadCommon>>,
) {
  const a = aggregate(c),
    mine = c.work.filter((w) => {
      const who = String(w.assignedTo || "").toLowerCase();
      return (
        !who ||
        who.includes(s.fullName.toLowerCase()) ||
        who.includes(s.email.toLowerCase())
      );
    });
  const open = mine.filter(
    (w) =>
      !["completed", "closed", "cancelled"].includes(
        String(w.status).toLowerCase(),
      ),
  );
  const inprog = open.filter((w) =>
      String(w.status).toLowerCase().includes("progress"),
    ),
    hold = open.filter((w) => String(w.status).toLowerCase().includes("hold")),
    completed = mine.filter(
      (w) => String(w.status).toLowerCase() === "completed",
    );
  const faults = a.openEvents.filter(
    (e) =>
      mine.length === 0 ||
      mine.some((w) => String(w.fleet) === String(e.fleet)),
  );
  const topJob = inprog[0] || open[0];
  const repairPct = topJob
    ? String(topJob.status).toLowerCase().includes("progress")
      ? 60
      : String(topJob.status).toLowerCase().includes("hold")
        ? 30
        : 10
    : 0;
  const dueReports = c.reports.filter(
    (r) => String(r.date) === isoDate(),
  ).length;
  const body = `<div class="content" id="top"><div class="headline"><div><h1>Mechanic Dashboard</h1><p>${esc(s.companyName)} · Execute work, fix right first time, keep assets moving</p></div><span class="tenant">✓ Tenant-isolated company data</span></div><div class="grid g3"><section class="panel"><h2>MY ASSIGNED JOBS</h2><div class="metricline"><div><b>${open.length}</b><small>Assigned</small></div><div><b class="blue">${inprog.length}</b><small>In Progress</small></div><div><b class="amber">${hold.length}</b><small>On Hold</small></div><div><b>${completed.length}</b><small>Completed</small></div></div><div class="panel-footer">View my jobs →</div></section><section class="panel"><h2>MACHINE FAULTS</h2><div class="metricline"><div><b class="red">${faults.filter((e) => ["critical", "high"].includes(String(e.severity).toLowerCase())).length}</b><small>High</small></div><div><b class="amber">${faults.filter((e) => String(e.severity).toLowerCase() === "medium").length}</b><small>Medium</small></div><div><b>${faults.filter((e) => String(e.severity).toLowerCase() === "low").length}</b><small>Low</small></div><div><b>${faults.length}</b><small>Total</small></div></div><div class="panel-footer">View faults →</div></section><section class="panel" id="checks"><h2>CHECKLIST / DAILY REPORT COMPLETION</h2><div class="donutwrap">${donut(a.total ? Math.min(100, (dueReports / a.total) * 100) : 0, "Completed")}<div class="legend"><span>${dueReports} report/check records today</span><span>${Math.max(0, a.total - dueReports)} machines remaining</span></div></div></section></div>
  <div class="grid g3 section-gap"><section class="panel" id="parts"><h2>PARTS NEEDED</h2>${
    c.orders
      .slice(0, 6)
      .map(
        (o) =>
          `<div class="minirow"><span>${esc(o.description)}</span><span class="${["delivered", "closed"].includes(String(o.status).toLowerCase()) ? "green" : "amber"}">${esc(o.status)}</span></div>`,
      )
      .join("") || '<div class="empty">No parts orders recorded.</div>'
  }<div class="panel-footer">Parts list →</div></section><section class="panel"><h2>REPAIR PROGRESS</h2>${topJob ? `<h3>${esc(topJob.fleet)} · ${esc(topJob.title)}</h3><div class="progress"><span style="width:${repairPct}%"></span></div><p><b>${repairPct}%</b> · ${esc(topJob.status)}</p><div class="minirow"><span>✓ Diagnose / isolate</span><span>Complete</span></div><div class="minirow"><span>${repairPct >= 50 ? "✓" : "○"} Repair / replace</span><span>${repairPct >= 50 ? "In progress" : "Pending"}</span></div><div class="minirow"><span>${repairPct >= 90 ? "✓" : "○"} Reassemble / test</span><span>${repairPct >= 90 ? "Complete" : "Pending"}</span></div>` : '<div class="empty">No active assigned repair.</div>'}<div class="panel-footer">Job steps →</div></section><section class="panel"><h2>COMPLETED TASKS (TODAY)</h2>${
    completed
      .slice(0, 6)
      .map(
        (w) =>
          `<div class="minirow"><span>✓ ${esc(w.fleet)}</span><span>${esc(w.title)}</span></div>`,
      )
      .join("") || '<div class="empty">No completed tasks recorded today.</div>'
  }</section></div>
  <div class="grid g2 section-gap" id="jobs"><section class="panel"><h2>MY JOBS</h2>${
    mine.length
      ? `<table class="table"><thead><tr><th>Job Card</th><th>Asset</th><th>Description</th><th>Priority</th><th>Status</th><th>Due</th><th>Progress</th></tr></thead><tbody>${mine
          .slice(0, 10)
          .map((w) => {
            const p =
              String(w.status).toLowerCase() === "completed"
                ? 100
                : String(w.status).toLowerCase().includes("progress")
                  ? 60
                  : String(w.status).toLowerCase().includes("hold")
                    ? 25
                    : 0;
            return `<tr><td>JC-${w.id}</td><td><b>${esc(w.fleet)}</b></td><td>${esc(w.title)}</td><td><span class="pill ${String(w.priority).toLowerCase() === "high" ? "red" : String(w.priority).toLowerCase() === "medium" ? "amber" : ""}">${esc(w.priority)}</span></td><td>${esc(w.status)}</td><td>${esc(
              String(w.dueAt || "—")
                .slice(0, 16)
                .replace("T", " "),
            )}</td><td><div class="progress"><span style="width:${p}%"></span></div></td></tr>`;
          })
          .join("")}</tbody></table>`
      : '<div class="empty">No jobs assigned yet.</div>'
  }</section><section class="panel"><h2>NOTES / RECENT FAULT INFORMATION</h2>${
    faults
      .slice(0, 7)
      .map(
        (e) =>
          `<div class="note"><b>${esc(e.fleet)}</b> — ${esc(e.description)}<br><span class="subtle">${esc(e.severity)} · ${esc(String(e.openedAt).replace("T", " ").slice(0, 16))}</span></div>`,
      )
      .join("") || '<div class="empty">No recent notes or fault events.</div>'
  }</section></div>
  <h2 class="section-gap" style="font-size:12px">QUICK VIEWS</h2><div class="smallcards"><div class="smallcard" id="faults"><small>ACTIVE FAULTS</small><b class="red">${faults.length}</b><small>Assigned machine scope</small></div><div class="smallcard"><small>TODAY'S CHECKS</small><b>${dueReports}</b><small>Daily report/check records</small></div><div class="smallcard" id="maintenance"><small>MAINTENANCE TASKS</small><b>${open.length}</b><small>Open assigned work</small></div><div class="smallcard"><small>PARTS INVENTORY / ORDERS</small><b>${c.orders.length}</b><small>Company parts records</small></div><div class="smallcard"><small>ASSET AVAILABILITY</small><b class="green">${pct(a.availability)}</b><small>${a.available} available</small></div></div><div class="security">◈ Job and fleet records are queried only for company ID ${s.companyId}; assigned-job filtering is applied on top.</div></div>`;
  return html(
    shell(
      s,
      body,
      String(c.settings?.defaultSite || c.machines[0]?.site || s.companyName),
    ),
  );
}

async function manager(
  env: RoleDashboardEnv,
  s: RoleSession,
  c: Awaited<ReturnType<typeof loadCommon>>,
) {
  const a = aggregate(c),
    down = dailySeries(c.production, "unplanned", 10),
    planned = dailySeries(c.production, "planned", 10),
    prod = dailySeries(c.production, "tonnes", 10);
  const target = n(c.settings?.target);
  const prodEff =
    target > 0 && c.production.length
      ? clamp(
          (c.production.reduce((x, r) => x + n(r.tonnes), 0) /
            (target *
              Math.max(1, new Set(c.production.map((r) => r.date)).size))) *
            100,
        )
      : 0;
  const sites = [
    ...new Set([
      ...c.sites.map((x) => String(x.name)),
      ...c.machines.map((m) => String(m.site || "Main Site")),
    ]),
  ];
  const siteData = sites.map((site) => {
    const ms = c.machines.filter((m) => String(m.site || "Main Site") === site),
      ps = c.production.filter((r) =>
        ms.some((m) => String(m.fleet) === String(r.fleet)),
      ),
      es = c.events.filter((e) =>
        ms.some((m) => String(m.fleet) === String(e.fleet)),
      );
    const av = ms.length
        ? (ms.filter(
            (m) =>
              !["down", "maintenance"].includes(String(m.status).toLowerCase()),
          ).length /
            ms.length) *
          100
        : 0,
      op = ps.reduce((x, r) => x + n(r.operating), 0),
      sh = ps.reduce((x, r) => x + n(r.shiftHours), 0),
      dt = es.reduce((x, e) => x + n(e.downtime), 0);
    return {
      site,
      machines: ms.length,
      readiness: av,
      util: sh ? (op / sh) * 100 : 0,
      downtime: dt,
    };
  });
  const under = c.machines
    .map((m) => ({ m, score: healthScore(m, c.events) }))
    .sort((x, y) => x.score - y.score)
    .slice(0, 5);
  const approvals = await all(
    env,
    "SELECT id,title,approval_type AS type,submitted_by AS submittedBy,created_at AS createdAt FROM approvals_v3 WHERE company_id=? AND status='pending' ORDER BY id DESC LIMIT 10",
    [s.companyId],
  );
  const workOpen = a.openWork;
  const body = `<div class="content" id="top"><div class="headline"><div><h1>Mine Manager Dashboard</h1><p>${esc(s.companyName)} · Executive overview across company operations</p></div><span class="tenant">✓ Tenant-isolated company data</span></div><div class="kpis" style="grid-template-columns:repeat(6,minmax(0,1fr))">${kpi("FLEET READINESS", pct(a.readiness), `${a.available} of ${a.total} available`, "green", down.values)}${kpi("UTILIZATION RATE", pct(a.utilization), "Operating performance", "blue", planned.values)}${kpi("PRODUCTION EFFICIENCY", pct(prodEff), target > 0 ? `Target ${target.toLocaleString()} t/day` : "Set target in Company Setup", "purple", prod.values)}${kpi("TOTAL DOWNTIME", `${(a.planned + a.unplanned).toFixed(1)} h`, "Planned + unplanned", "amber", down.values)}${kpi(
    "MAINTENANCE BACKLOG",
    String(workOpen.length),
    "Open work orders",
    "amber",
    workOpen.slice(0, 7).map((_, i) => i + 1),
  )}${kpi("SITE COMPLIANCE", pct(a.availability), "Availability-based compliance", "green", planned.values)}</div>
  <div class="grid g3" id="sites"><section class="panel"><h2>MULTI-SITE OVERVIEW</h2><div class="sitecards">${siteData.map((x, i) => `<div class="sitecard"><b><span class="dot" style="background:${["#11975c", "#1768d5", "#e9a500", "#e53232"][i % 4]}"></span>${esc(x.site)}</b><small>${x.machines} machines · Readiness ${pct(x.readiness)} · Util ${pct(x.util)} · Downtime ${x.downtime.toFixed(1)} h</small></div>`).join("") || '<div class="empty">Add sites and machines to populate overview.</div>'}</div><div class="panel-footer">All sites belong to ${esc(s.companyName)}</div></section><section class="panel" id="trends"><h2>DOWNTIME TREND (ALL SITES)</h2><div class="chartbox">${lineChart(down.dates, down.values, planned.values, ["#1768d5", "#11975c"])}</div><div class="panel-footer">Blue: unplanned · Green: planned</div></section><section class="panel" id="alerts"><h2>ACTION CENTRE</h2><div class="minirow"><span>Pending approvals</span><b class="blue">${approvals.length}</b></div><div class="minirow"><span>Critical alerts</span><b class="red">${a.critical}</b></div>${
    a.openEvents
      .slice(0, 5)
      .map(
        (e) =>
          `<div class="note"><b class="red">${esc(e.description)}</b><br>${esc(e.fleet)} · ${esc(e.severity)}</div>`,
      )
      .join("") || '<div class="empty">No critical alerts.</div>'
  }</section></div>
  <div class="grid g3 section-gap" id="assets"><section class="panel"><h2>TOP 5 UNDERPERFORMING MACHINES</h2>${under.length ? `<table class="table"><thead><tr><th>Asset</th><th>Site</th><th>Type</th><th>Status</th><th>Health</th></tr></thead><tbody>${under.map((x) => `<tr><td><b class="blue">${esc(x.m.fleet)}</b></td><td>${esc(x.m.site)}</td><td>${esc(x.m.category)}</td><td>${esc(x.m.status)}</td><td><span class="pill ${x.score < 50 ? "red" : x.score < 80 ? "amber" : ""}">${x.score.toFixed(0)}</span></td></tr>`).join("")}</tbody></table>` : '<div class="empty">No machine records.</div>'}</section><section class="panel"><h2>ALERTS BY SITE</h2><div class="donutwrap">${donut(a.total ? (siteData.reduce((x, y) => x + (y.downtime > 0 ? 1 : 0), 0) / Math.max(1, siteData.length)) * 100 : 0, "Sites")}<div class="legend">${siteData
    .slice(0, 5)
    .map(
      (x) =>
        `<span>${esc(x.site)}: ${c.events.filter((e) => c.machines.filter((m) => String(m.site) === x.site).some((m) => String(m.fleet) === String(e.fleet))).length} alerts</span>`,
    )
    .join(
      "",
    )}</div></div></section><section class="panel" id="work"><h2>PLANNED VS COMPLETED WORK</h2><div class="chartbox">${bars(
    siteData.map((x) => x.site.slice(0, 8)),
    siteData.map(
      (x) =>
        c.work.filter((w) =>
          c.machines
            .filter((m) => String(m.site) === x.site)
            .some((m) => String(m.fleet) === String(w.fleet)),
        ).length,
    ),
    "#1768d5",
  )}</div><div class="panel-footer">${c.work.filter((w) => String(w.status).toLowerCase() === "completed").length} completed of ${c.work.length} total work orders</div></section></div>
  <div class="grid g3 section-gap"><section class="panel"><h2>SITE PERFORMANCE SUMMARY</h2><table class="table"><thead><tr><th>Site</th><th>Fleet</th><th>Readiness</th><th>Utilisation</th><th>Downtime</th></tr></thead><tbody>${siteData.map((x) => `<tr><td>${esc(x.site)}</td><td>${x.machines}</td><td>${pct(x.readiness)}</td><td>${pct(x.util)}</td><td>${x.downtime.toFixed(1)} h</td></tr>`).join("")}</tbody></table></section><section class="panel" id="compliance"><h2>COMPLIANCE OVERVIEW</h2><div class="donutwrap">${donut(a.availability, "Overall")}<div class="legend"><span><i class="dot" style="background:#11975c"></i>Available / compliant: ${a.available}</span><span><i class="dot" style="background:#e9a500"></i>Attention / maintenance: ${c.machines.filter((m) => String(m.status).toLowerCase() === "maintenance").length}</span><span><i class="dot" style="background:#e53232"></i>Down: ${c.machines.filter((m) => String(m.status).toLowerCase() === "down").length}</span></div></div></section><section class="panel"><h2>RECENT WORK ORDER ACTIVITY</h2>${
    c.work
      .slice(0, 7)
      .map(
        (w) =>
          `<div class="minirow"><span><b>WO-${w.id}</b> ${esc(w.fleet)} · ${esc(w.title)}</span><span class="pill ${String(w.priority).toLowerCase() === "high" ? "red" : ""}">${esc(w.status)}</span></div>`,
      )
      .join("") || '<div class="empty">No work orders recorded.</div>'
  }</section></div><div class="security">◈ Executive totals include only records where company_id = ${s.companyId}. No cross-company aggregation is performed.</div></div>`;
  return html(shell(s, body, String(c.settings?.defaultSite || s.companyName)));
}

export async function handleRoleDashboardsV4(
  request: Request,
  env: RoleDashboardEnv,
): Promise<Response | null> {
  const url = new URL(request.url);
  if (request.method !== "GET" || url.pathname !== "/contractor") return null;
  const s = await getSession(request, env);
  if (!s) return null;
  if (!["engineer", "supervisor", "mechanic", "manager"].includes(s.role))
    return null;
  const c = await loadCommon(env, s);
  if (s.role === "engineer") return engineer(env, s, c);
  if (s.role === "supervisor") return supervisor(env, s, c);
  if (s.role === "mechanic") return mechanic(env, s, c);
  return manager(env, s, c);
}
