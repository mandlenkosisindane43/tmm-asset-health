import commercialWorker from "./router-commercial";
import { sindaneLogoDataUri } from "./sindane-logo-data";
import { ensureAccountRoles } from "./account-roles";

interface ExecutionContext {
  waitUntil(promise: Promise<unknown>): void;
  passThroughOnException(): void;
}

interface Env {
  DB: D1Database;
  [key: string]: unknown;
}

type Session = {
  companyId: number;
  accountId: number;
  email: string;
  fullName: string;
  role: string;
  companyName: string;
  licenceStatus: string;
  expiresAt: string;
};

type Row = Record<string, unknown>;
const COOKIE = "sas_contractor_v2";
const enc = new TextEncoder();

function esc(v: unknown) {
  return String(v ?? "").replace(/[&<>"']/g, c => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c] || c));
}
function txt(v: unknown, max = 400) { return String(v ?? "").trim().slice(0, max); }
function num(v: unknown, fallback = 0) { const n = Number(v); return Number.isFinite(n) ? n : fallback; }
function lower(v: unknown) { return txt(v, 200).toLowerCase(); }
function isoNow() { return new Date().toISOString(); }
function isoDate() { return new Date().toISOString().slice(0, 10); }
function roleTitle(role: string) { return ({ engineer: "Engineer", supervisor: "Supervisor", mechanic: "Mechanic", manager: "Mine Manager" } as Record<string,string>)[role] || role; }
function getCookie(request: Request) {
  const raw = request.headers.get("cookie") || "";
  for (const part of raw.split(";")) {
    const i = part.indexOf("=");
    if (i > -1 && part.slice(0, i).trim() === COOKIE) return part.slice(i + 1).trim();
  }
  return "";
}
async function sha256(v: string) {
  const bytes = new Uint8Array(await crypto.subtle.digest("SHA-256", enc.encode(v)));
  return Array.from(bytes, b => b.toString(16).padStart(2, "0")).join("");
}
async function session(request: Request, env: Env): Promise<Session | null> {
  await ensureAccountRoles(env);
  const token = getCookie(request);
  if (!token) return null;
  try {
    const row = await env.DB.prepare(`SELECT s.company_id AS companyId,s.account_id AS accountId,s.expires_at AS sessionExpires,
      a.email,a.full_name AS fullName,COALESCE(NULLIF(s.active_role,''),a.role) AS role,a.status AS accountStatus,c.name AS companyName,
      c.licence_status AS licenceStatus,c.expires_at AS expiresAt
      FROM contractor_sessions s
      JOIN contractor_accounts a ON a.id=s.account_id AND a.company_id=s.company_id
      JOIN companies c ON c.id=s.company_id
      WHERE s.token_hash=? LIMIT 1`).bind(await sha256(token)).first<Row>();
    if (!row || String(row.accountStatus) !== "active") return null;
    if (new Date(String(row.sessionExpires)).getTime() < Date.now()) return null;
    return {
      companyId: num(row.companyId), accountId: num(row.accountId), email: String(row.email || ""),
      fullName: String(row.fullName || ""), role: String(row.role || ""), companyName: String(row.companyName || ""),
      licenceStatus: String(row.licenceStatus || ""), expiresAt: String(row.expiresAt || "")
    };
  } catch { return null; }
}
function licenceActive(s: Session) {
  const state = s.licenceStatus.toLowerCase();
  const expiry = new Date(s.expiresAt).getTime();
  return ["active","trial"].includes(state) && Number.isFinite(expiry) && Date.now() <= expiry;
}
async function all(env: Env, sql: string, binds: unknown[] = []) {
  try { return (await env.DB.prepare(sql).bind(...binds).all<Row>()).results || []; } catch { return []; }
}
async function first(env: Env, sql: string, binds: unknown[] = []) {
  try { return await env.DB.prepare(sql).bind(...binds).first<Row>(); } catch { return null; }
}

let schemaPromise: Promise<void> | null = null;
async function ensureSchema(env: Env) {
  if (schemaPromise) return schemaPromise;
  schemaPromise = (async () => {
    const stmts = [
      `CREATE TABLE IF NOT EXISTS work_orders (id INTEGER PRIMARY KEY AUTOINCREMENT,company_id INTEGER NOT NULL,fleet_number TEXT NOT NULL,title TEXT NOT NULL,priority TEXT NOT NULL DEFAULT 'medium',assigned_to TEXT,due_at TEXT,status TEXT NOT NULL DEFAULT 'open',created_at TEXT NOT NULL)`,
      `CREATE TABLE IF NOT EXISTS role_inspections_v4 (id INTEGER PRIMARY KEY AUTOINCREMENT,company_id INTEGER NOT NULL,machine TEXT NOT NULL,inspection_type TEXT NOT NULL,result TEXT NOT NULL,notes TEXT,inspected_by INTEGER NOT NULL,inspector_name TEXT NOT NULL,created_at TEXT NOT NULL)`,
      `CREATE TABLE IF NOT EXISTS role_checklists_v4 (id INTEGER PRIMARY KEY AUTOINCREMENT,company_id INTEGER NOT NULL,account_id INTEGER NOT NULL,machine TEXT NOT NULL,item TEXT NOT NULL,status TEXT NOT NULL DEFAULT 'pending',notes TEXT,updated_at TEXT NOT NULL)`,
      `CREATE TABLE IF NOT EXISTS role_work_notes_v4 (id INTEGER PRIMARY KEY AUTOINCREMENT,company_id INTEGER NOT NULL,work_order_id INTEGER NOT NULL,account_id INTEGER NOT NULL,note TEXT NOT NULL,created_at TEXT NOT NULL)`,
      `CREATE TABLE IF NOT EXISTS role_parts_requests_v4 (id INTEGER PRIMARY KEY AUTOINCREMENT,company_id INTEGER NOT NULL,machine TEXT NOT NULL,part_name TEXT NOT NULL,quantity REAL NOT NULL DEFAULT 1,status TEXT NOT NULL DEFAULT 'requested',requested_by INTEGER NOT NULL,requester_name TEXT NOT NULL,created_at TEXT NOT NULL)`,
      `CREATE TABLE IF NOT EXISTS role_shift_notes_v4 (id INTEGER PRIMARY KEY AUTOINCREMENT,company_id INTEGER NOT NULL,account_id INTEGER NOT NULL,shift_name TEXT NOT NULL,note TEXT NOT NULL,created_at TEXT NOT NULL)`,
      `CREATE TABLE IF NOT EXISTS role_permits_v4 (id INTEGER PRIMARY KEY AUTOINCREMENT,company_id INTEGER NOT NULL,permit_type TEXT NOT NULL,machine TEXT,reference TEXT,status TEXT NOT NULL DEFAULT 'open',created_by INTEGER NOT NULL,created_at TEXT NOT NULL)`
    ];
    for (const s of stmts) await env.DB.prepare(s).run();
  })().catch(e => { schemaPromise = null; throw e; });
  return schemaPromise;
}

const css = `<style>
*{box-sizing:border-box}html,body{margin:0;background:#f5f7f9;color:#122033;font-family:Inter,Arial,Helvetica,sans-serif}.layout{min-height:100vh;display:grid;grid-template-columns:258px minmax(0,1fr)}.sidebar{height:100vh;position:sticky;top:0;background:linear-gradient(180deg,#061827,#041321 72%,#061a2b);color:#fff;padding:14px 13px;display:flex;flex-direction:column;overflow:hidden}.brand{height:108px;display:grid;place-items:center;border-bottom:1px solid rgba(255,255,255,.09);margin-bottom:10px}.brand img{width:180px;height:96px;object-fit:contain}.nav{display:grid;gap:3px;overflow:auto;padding:2px 0 8px}.nav a{color:#f3f7fa;text-decoration:none;font-size:13px;padding:10px 11px;border-radius:8px;display:flex;gap:11px;align-items:center}.nav a span{width:20px;text-align:center;font-size:17px}.nav a.active,.nav a:hover{background:#11975c}.sitebox,.profile{border:1px solid rgba(255,255,255,.12);border-radius:9px;padding:10px 12px;margin-top:8px}.sitebox small,.profile small{display:block;color:#9db0bf;font-size:9px;margin-bottom:4px}.sitebox b,.profile b{font-size:12px}.profile{display:flex;gap:9px;align-items:center}.avatar{width:37px;height:37px;border-radius:50%;display:grid;place-items:center;background:#0b8853;color:#fff;font-weight:900}.signout{margin-top:8px;border-top:1px solid rgba(255,255,255,.1);padding-top:8px}.signout button{width:100%;background:transparent;border:0;color:#dce7ee;text-align:left;padding:8px;cursor:pointer}.main{min-width:0}.top{height:62px;background:#061827;color:#fff;display:flex;align-items:center;justify-content:space-between;padding:0 22px;position:sticky;top:0;z-index:10}.top-left,.top-right{display:flex;align-items:center;gap:10px}.top-left{gap:14px}.search{width:min(390px,34vw);height:37px;border:1px solid #314456;background:#0b2236;border-radius:7px;color:#b7c6d1;padding:0 14px;display:flex;align-items:center;font-size:11px}.top-pill{border:1px solid #314456;background:#0a2033;border-radius:7px;padding:9px 11px;white-space:nowrap;font-size:11px}.printbtn{border:1px solid #157a54;background:#11975c;color:#fff;border-radius:7px;padding:9px 12px;font-weight:800;cursor:pointer}.userdot{width:32px;height:32px;border-radius:50%;background:#24405a;display:grid;place-items:center;font-weight:800}.content{padding:18px;max-width:1680px;margin:auto}.headline{display:flex;justify-content:space-between;gap:12px;align-items:center;margin-bottom:13px}.headline h1{font-size:25px;margin:0}.headline p{font-size:11px;color:#637083;margin:3px 0 0}.tenant{font-size:10px;color:#08794b;background:#eaf7f0;border:1px solid #ccebd9;border-radius:999px;padding:7px 10px;font-weight:800}.grid{display:grid;gap:12px}.g2{grid-template-columns:1fr 1fr}.g3{grid-template-columns:repeat(3,1fr)}.panel{background:#fff;border:1px solid #dfe5ea;border-radius:9px;padding:14px;min-width:0}.panel h2{font-size:13px;margin:0 0 12px}.panel h3{font-size:11px;margin:0 0 8px}.table{width:100%;border-collapse:collapse;font-size:10px}.table th{text-align:left;background:#f6f8fa;color:#526071;padding:8px 7px;border-bottom:1px solid #dfe5ea}.table td{padding:8px 7px;border-bottom:1px solid #edf0f3;vertical-align:middle}.pill{display:inline-block;border-radius:999px;padding:4px 7px;font-size:8px;font-weight:800;background:#e7f7ed;color:#078645}.pill.red{background:#fff0f0;color:#d92727}.pill.amber{background:#fff6e6;color:#d98200}.pill.blue{background:#edf4ff;color:#1768d5}.cards{display:grid;grid-template-columns:repeat(4,1fr);gap:10px;margin-bottom:12px}.card{background:#fff;border:1px solid #dfe5ea;border-radius:9px;padding:13px}.card small{display:block;color:#6c7987;font-size:9px}.card b{font-size:22px;display:block;margin-top:5px}.field{display:grid;gap:5px;font-size:10px;font-weight:800;margin:8px 0}.field input,.field select,.field textarea{width:100%;padding:9px;border:1px solid #cfd8e1;border-radius:7px;background:#fff;font:inherit}.field textarea{min-height:72px}.twocol{display:grid;grid-template-columns:1fr 1fr;gap:8px}.btn{border:0;background:#11975c;color:#fff;padding:9px 12px;border-radius:7px;font-weight:800;cursor:pointer;text-decoration:none;display:inline-block;font-size:10px}.btn.blue{background:#1768d5}.btn.amber{background:#d98a00}.btn.red{background:#c92a2a}.btn.gray{background:#eef2f6;color:#24364b;border:1px solid #d6dee6}.notice{padding:10px 12px;border-radius:8px;background:#eaf7ef;color:#166534;font-size:10px;margin-bottom:12px}.notice.err{background:#fff0f0;color:#a11b1b}.bar{height:7px;border-radius:9px;background:#e7edf1;overflow:hidden}.bar span{display:block;height:100%;background:#11975c}.muted{color:#6f7d8b;font-size:10px}.empty{text-align:center;color:#7b8792;padding:25px}.actions{display:flex;gap:6px;flex-wrap:wrap}.section-gap{margin-top:12px}.footer-note{text-align:center;color:#778592;font-size:9px;margin-top:14px}.mini{display:flex;justify-content:space-between;gap:10px;padding:8px 0;border-bottom:1px solid #edf0f3;font-size:10px}.kpirow{display:grid;grid-template-columns:repeat(5,1fr);gap:10px;margin-bottom:12px}.kpi{background:#fff;border:1px solid #dfe5ea;border-radius:9px;padding:13px}.kpi b{font-size:23px;display:block;margin:5px 0}.kpi small{font-size:9px;color:#657384}.green{color:#11975c}.redtxt{color:#d92727}.ambertxt{color:#d98a00}.bluetxt{color:#1768d5}
@media(max-width:1100px){.layout{grid-template-columns:215px 1fr}.cards,.kpirow{grid-template-columns:repeat(2,1fr)}.g2,.g3{grid-template-columns:1fr}}@media(max-width:760px){.layout{display:block}.sidebar{position:relative;height:auto}.nav{grid-template-columns:repeat(3,1fr)}.nav a{font-size:0;justify-content:center}.nav a span{font-size:18px}.sitebox,.profile{display:none}.top{position:relative}.search{display:none}.content{padding:11px}.cards,.kpirow{grid-template-columns:1fr 1fr}}@media print{.sidebar,.top,.no-print{display:none!important}.layout{display:block}.content{padding:0}.panel,.card,.kpi{box-shadow:none;break-inside:avoid}}
</style>`;

function navFor(role: string) {
  if (role === "engineer") return [
    ["dashboard","⌂","Dashboard"],["fleet","▣","Fleet Overview"],["machines","▦","Machines"],["workorders","▤","Work Orders"],["inspections","◉","Inspections"],["maintenance","⌕","Maintenance"],["condition","⌁","Condition Monitoring"],["faults","△","Faults"],["parts","▰","Parts & Inventory"],["documents","▱","Documents"],["reports","▥","Reports"],["analytics","▥","Analytics"]
  ];
  if (role === "supervisor") return [
    ["dashboard","⌂","Dashboard"],["shift","◷","Shift Control"],["jobs","▤","Job Cards"],["work","♙","Work Management"],["assets","▣","Assets"],["inspections","◉","Inspections"],["maintenance","⌕","Maintenance"],["condition","⌁","Condition Monitoring"],["parts","▰","Parts & Inventory"],["permits","▤","Permits"],["reports","▥","Reports"],["alerts","♧","Alerts"],["documents","▱","Documents"]
  ];
  if (role === "mechanic") return [
    ["dashboard","⌂","Dashboard"],["jobs","▤","My Jobs"],["faults","△","Faults"],["checklists","✓","Checklists"],["parts","▰","Parts & Inventory"],["maintenance","⌕","Maintenance"],["inspections","◉","Inspections"],["documents","▱","Documents"],["reports","▥","Reports"]
  ];
  return [
    ["dashboard","⌂","Dashboard"],["sites","▦","Multi-Site Overview"],["assets","▣","Assets"],["health","◉","Health Monitor"],["maintenance","⌕","Maintenance"],["workorders","▤","Work Orders"],["compliance","✓","Compliance"],["inventory","▰","Inventory"],["reports","▥","Reports"],["analytics","▥","Analytics"],["documents","▱","Documents"],["alerts","♧","Alerts"],["licence","♢","Licence & Subscription"]
  ];
}
function hrefFor(view: string) {
  if (view === "dashboard") return "/contractor";
  if (view === "licence") return "/contractor-licence";
  return `/role?view=${encodeURIComponent(view)}`;
}
function shell(s: Session, active: string, title: string, body: string) {
  const nav = navFor(s.role);
  return `<!doctype html><html><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>${esc(title)} · TMM Asset Health</title>${css}</head><body><div class="layout"><aside class="sidebar"><div class="brand"><img src="${sindaneLogoDataUri()}" alt="Sindane Asset Solutions"></div><nav class="nav">${nav.map(x=>`<a class="${active===x[0]?'active':''}" href="${hrefFor(x[0])}"><span>${x[1]}</span>${esc(x[2])}</a>`).join('')}<a href="/select-role"><span>⇄</span>Switch Role</a></nav><div class="sitebox"><small>Current Company</small><b>${esc(s.companyName)}</b></div><div class="profile"><div class="avatar">${esc((s.fullName||'U')[0].toUpperCase())}</div><div><b>${esc(s.fullName)}</b><small>${esc(roleTitle(s.role))}</small></div></div><form class="signout" method="post" action="/api/contractor/logout"><button type="submit">↪ &nbsp; Sign out</button></form></aside><main class="main"><header class="top"><div class="top-left"><span style="font-size:21px">☰</span><div class="search">⌕ &nbsp; ${esc(title)}</div></div><div class="top-right"><button class="printbtn no-print" type="button" onclick="window.print()">🖨 Print</button><span class="top-pill">${esc(s.companyName)}</span><span class="userdot">${esc((s.fullName||'U')[0].toUpperCase())}</span><span style="font-size:10px"><b>${esc(s.fullName)}</b><br>${esc(roleTitle(s.role))}</span></div></header><div class="content">${body}</div></main></div></body></html>`;
}
function html(body: string, status = 200) {
  return new Response(body, { status, headers: {
    "content-type":"text/html; charset=utf-8","cache-control":"private, no-store","x-frame-options":"DENY","referrer-policy":"same-origin",
    "content-security-policy":"default-src 'self'; style-src 'self' 'unsafe-inline'; script-src 'self' 'unsafe-inline'; img-src 'self' data:; frame-ancestors 'none'; base-uri 'self'"
  }});
}
function redirect(view: string, msg = "", tone = "ok") {
  const q = new URLSearchParams({ view }); if (msg) { q.set("msg",msg); q.set("tone",tone); }
  return new Response(null,{status:303,headers:{location:`/role?${q.toString()}`,"cache-control":"no-store"}});
}
function flash(url: URL) {
  const msg = url.searchParams.get("msg"); if (!msg) return "";
  return `<div class="notice ${url.searchParams.get('tone')==='err'?'err':''}">${esc(msg)}</div>`;
}
function heading(s: Session, title: string, sub: string) {
  return `<div class="headline"><div><h1>${esc(title)}</h1><p>${esc(sub)}</p></div><span class="tenant">✓ ${esc(s.companyName)} only</span></div>`;
}

async function common(env: Env, s: Session) {
  const cid = s.companyId;
  const machines = await all(env,"SELECT id,fleet_number AS fleet,category,site,status,operating_hours AS hours,next_service_hours AS nextService FROM machines WHERE company_id=? ORDER BY fleet_number",[cid]);
  const events = await all(env,"SELECT id,fleet_number AS fleet,severity,system_name AS system,component,description,opened_at AS openedAt,closed_at AS closedAt,downtime_hours AS downtime,status,spares_status AS spares FROM events WHERE company_id=? ORDER BY id DESC LIMIT 500",[cid]);
  const work = await all(env,"SELECT id,fleet_number AS fleet,title,priority,assigned_to AS assignedTo,due_at AS dueAt,status,created_at AS createdAt FROM work_orders WHERE company_id=? ORDER BY id DESC LIMIT 400",[cid]);
  const production = await all(env,"SELECT report_date AS date,fleet_number AS fleet,shift_hours AS shiftHours,planned_downtime AS planned,unplanned_downtime AS unplanned,operating_hours AS operating,productive_hours AS productive,tonnes FROM production_records WHERE company_id=? ORDER BY report_date DESC LIMIT 600",[cid]);
  return { machines, events, work, production };
}

function machineTable(rows: Row[], editable = false) {
  if (!rows.length) return `<div class="empty">No machines registered for this company.</div>`;
  return `<table class="table"><thead><tr><th>Machine</th><th>Type</th><th>Site</th><th>Status</th><th>Hour Meter</th><th>Next Service</th>${editable?'<th>Update</th>':''}</tr></thead><tbody>${rows.map(m=>`<tr><td><b class="bluetxt">${esc(m.fleet)}</b></td><td>${esc(m.category)}</td><td>${esc(m.site)}</td><td><span class="pill ${String(m.status).toLowerCase()==='down'?'red':String(m.status).toLowerCase()==='maintenance'?'amber':''}">${esc(m.status)}</span></td><td>${num(m.hours).toFixed(1)}</td><td>${m.nextService==null?'—':num(m.nextService).toFixed(1)}</td>${editable?`<td><form method="post" action="/role/action" class="actions"><input type="hidden" name="action" value="machine-update"><input type="hidden" name="id" value="${num(m.id)}"><select name="status"><option>${esc(m.status)}</option><option>operating</option><option>attention</option><option>maintenance</option><option>down</option><option>standby</option></select><input name="nextService" type="number" step="0.1" value="${m.nextService==null?'':num(m.nextService)}" style="width:90px"><button class="btn" type="submit">Save</button></form></td>`:''}</tr>`).join('')}</tbody></table>`;
}
function workTable(rows: Row[], s: Session, editable = false) {
  if (!rows.length) return `<div class="empty">No work orders found.</div>`;
  return `<table class="table"><thead><tr><th>WO</th><th>Machine</th><th>Job</th><th>Priority</th><th>Assigned</th><th>Due</th><th>Status</th>${editable?'<th>Update</th>':''}</tr></thead><tbody>${rows.map(w=>`<tr><td>WO-${num(w.id)}</td><td><b>${esc(w.fleet)}</b></td><td>${esc(w.title)}</td><td><span class="pill ${lower(w.priority)==='high'||lower(w.priority)==='critical'?'red':lower(w.priority)==='medium'?'amber':''}">${esc(w.priority)}</span></td><td>${esc(w.assignedTo||'Unassigned')}</td><td>${esc(String(w.dueAt||'').slice(0,16).replace('T',' '))}</td><td>${esc(w.status)}</td>${editable?`<td><form method="post" action="/role/action" class="actions"><input type="hidden" name="action" value="work-update"><input type="hidden" name="id" value="${num(w.id)}"><select name="status"><option>${esc(w.status)}</option><option>open</option><option>assigned</option><option>in progress</option><option>on hold</option><option>completed</option><option>closed</option></select>${s.role!=='mechanic'?`<input name="assignedTo" value="${esc(w.assignedTo||'')}" placeholder="Assign to" style="width:105px">`:''}<button class="btn" type="submit">Save</button></form></td>`:''}</tr>`).join('')}</tbody></table>`;
}
function eventTable(rows: Row[], editable = false) {
  if (!rows.length) return `<div class="empty">No faults or condition events found.</div>`;
  return `<table class="table"><thead><tr><th>Machine</th><th>Severity</th><th>System</th><th>Description</th><th>Opened</th><th>Downtime h</th><th>Status</th>${editable?'<th>Action</th>':''}</tr></thead><tbody>${rows.map(e=>`<tr><td><b>${esc(e.fleet)}</b></td><td><span class="pill ${['critical','high'].includes(lower(e.severity))?'red':lower(e.severity)==='medium'?'amber':''}">${esc(e.severity)}</span></td><td>${esc(e.system)}</td><td>${esc(e.description)}</td><td>${esc(String(e.openedAt||'').slice(0,16).replace('T',' '))}</td><td>${num(e.downtime).toFixed(1)}</td><td>${esc(e.status)}</td>${editable?`<td><form method="post" action="/role/action"><input type="hidden" name="action" value="event-status"><input type="hidden" name="id" value="${num(e.id)}"><select name="status"><option>${esc(e.status)}</option><option>open</option><option>monitoring</option><option>closed</option></select><button class="btn" type="submit">Save</button></form></td>`:''}</tr>`).join('')}</tbody></table>`;
}

async function renderRolePage(request: Request, env: Env, s: Session) {
  await ensureSchema(env);
  const url = new URL(request.url);
  const view = lower(url.searchParams.get("view") || "dashboard");
  const allowed = new Set(navFor(s.role).map(x=>x[0]));
  if (!allowed.has(view)) return html(shell(s,"dashboard","Access restricted",`${heading(s,"Access restricted","This page is not assigned to your role.")}<div class="panel">Return to your dashboard.</div>`),403);
  if (view === "dashboard") return new Response(null,{status:302,headers:{location:"/contractor"}});
  if (view === "licence") return new Response(null,{status:302,headers:{location:"/contractor-licence"}});
  const c = await common(env,s);
  const note = flash(url);

  if (["fleet","machines","assets","sites","health","compliance"].includes(view)) {
    const available = c.machines.filter(m=>!["down","maintenance","inactive"].includes(lower(m.status))).length;
    const down = c.machines.filter(m=>lower(m.status)==='down').length;
    const maint = c.machines.filter(m=>lower(m.status)==='maintenance').length;
    const sites = [...new Set(c.machines.map(m=>String(m.site||'Main Site')))];
    let main = `${heading(s,view==='sites'?'Multi-Site Overview':view==='health'?'Health Monitor':view==='compliance'?'Compliance':view==='fleet'?'Fleet Overview':'Assets & Machines',`${c.machines.length} machines across ${sites.length} site(s)`)}${note}<div class="cards"><div class="card"><small>Total machines</small><b>${c.machines.length}</b></div><div class="card"><small>Available</small><b class="green">${available}</b></div><div class="card"><small>Down</small><b class="redtxt">${down}</b></div><div class="card"><small>Maintenance</small><b class="ambertxt">${maint}</b></div></div>`;
    if (view === "sites") main += `<div class="grid g3">${sites.map(site=>{const ms=c.machines.filter(m=>String(m.site||'Main Site')===site);const av=ms.filter(m=>!["down","maintenance"].includes(lower(m.status))).length;return `<div class="panel"><h2>${esc(site)}</h2><div class="mini"><span>Machines</span><b>${ms.length}</b></div><div class="mini"><span>Ready</span><b class="green">${av}</b></div><div class="mini"><span>Readiness</span><b>${ms.length?(av/ms.length*100).toFixed(1):'0.0'}%</b></div></div>`}).join('')}</div>`;
    else main += `<div class="panel">${machineTable(c.machines,s.role==='engineer'&&(view==='machines'||view==='fleet'))}</div>`;
    if (view === "health" || view === "compliance") main += `<div class="panel section-gap"><h2>Current faults affecting asset health</h2>${eventTable(c.events.slice(0,50),false)}</div>`;
    return html(shell(s,view,view==='fleet'?'Fleet Overview':roleTitle(s.role)+" Workspace",main));
  }

  if (["workorders","jobs","work","maintenance"].includes(view)) {
    let rows = c.work;
    if (s.role === "mechanic") {
      const me = s.fullName.toLowerCase(), mail=s.email.toLowerCase();
      rows = rows.filter(w=>{const a=String(w.assignedTo||'').toLowerCase();return !a || a===me || a===mail;});
    }
    const editable = ["engineer","supervisor","mechanic"].includes(s.role);
    const open = rows.filter(w=>!["closed","completed","cancelled"].includes(lower(w.status))).length;
    let main = `${heading(s,view==='jobs'&&s.role==='mechanic'?'My Jobs':view==='maintenance'?'Maintenance':'Work Orders',s.role==='mechanic'?'Only jobs assigned to you or currently unassigned are actionable.':'Create, assign and update operational work within your company.')}${note}<div class="cards"><div class="card"><small>Total shown</small><b>${rows.length}</b></div><div class="card"><small>Open</small><b class="ambertxt">${open}</b></div><div class="card"><small>In progress</small><b class="bluetxt">${rows.filter(w=>lower(w.status).includes('progress')).length}</b></div><div class="card"><small>Completed</small><b class="green">${rows.filter(w=>['completed','closed'].includes(lower(w.status))).length}</b></div></div>`;
    if (["engineer","supervisor"].includes(s.role)) main += `<div class="panel no-print"><h2>Create work order</h2><form method="post" action="/role/action"><input type="hidden" name="action" value="work-create"><div class="twocol"><label class="field">Machine<select name="fleet" required><option value="">Choose machine</option>${c.machines.map(m=>`<option>${esc(m.fleet)}</option>`).join('')}</select></label><label class="field">Priority<select name="priority"><option>medium</option><option>low</option><option>high</option><option>critical</option></select></label></div><label class="field">Job / task<input name="title" required placeholder="Describe the work required"></label><div class="twocol"><label class="field">Assign to<input name="assignedTo" placeholder="Name or email"></label><label class="field">Due<input type="datetime-local" name="dueAt"></label></div><button class="btn" type="submit">Create work order</button></form></div>`;
    main += `<div class="panel section-gap">${workTable(rows,s,editable)}</div>`;
    return html(shell(s,view,view==='jobs'?'My Jobs':'Work Orders',main));
  }

  if (["faults","condition","alerts"].includes(view)) {
    const open = c.events.filter(e=>lower(e.status)!=='closed');
    const critical = open.filter(e=>['critical','high'].includes(lower(e.severity))).length;
    const editable = ["engineer","supervisor"].includes(s.role);
    const main = `${heading(s,view==='condition'?'Condition Monitoring':view==='alerts'?'Alerts':'Faults',`${open.length} open events · ${critical} critical/high`)}${note}<div class="cards"><div class="card"><small>Open</small><b>${open.length}</b></div><div class="card"><small>Critical / high</small><b class="redtxt">${critical}</b></div><div class="card"><small>Closed</small><b class="green">${c.events.filter(e=>lower(e.status)==='closed').length}</b></div><div class="card"><small>Total downtime</small><b>${c.events.reduce((x,e)=>x+num(e.downtime),0).toFixed(1)} h</b></div></div><div class="panel">${eventTable(c.events,editable)}</div>`;
    return html(shell(s,view,view==='condition'?'Condition Monitoring':'Faults & Alerts',main));
  }

  if (view === "inspections") {
    const inspections = await all(env,"SELECT id,machine,inspection_type AS type,result,notes,inspector_name AS inspector,created_at AS createdAt FROM role_inspections_v4 WHERE company_id=? ORDER BY id DESC LIMIT 200",[s.companyId]);
    const canAdd = ["engineer","supervisor","mechanic"].includes(s.role);
    const main = `${heading(s,"Inspections","Capture and review company-specific inspection results.")}${note}${canAdd?`<div class="panel no-print"><h2>Record inspection</h2><form method="post" action="/role/action"><input type="hidden" name="action" value="inspection-add"><div class="twocol"><label class="field">Machine<select name="machine" required><option value="">Choose machine</option>${c.machines.map(m=>`<option>${esc(m.fleet)}</option>`).join('')}</select></label><label class="field">Inspection type<input name="type" required placeholder="Pre-start / weekly / maintenance"></label></div><label class="field">Result<select name="result"><option>pass</option><option>attention</option><option>fail</option></select></label><label class="field">Notes<textarea name="notes"></textarea></label><button class="btn" type="submit">Save inspection</button></form></div>`:''}<div class="panel section-gap"><table class="table"><thead><tr><th>Machine</th><th>Type</th><th>Result</th><th>Inspector</th><th>Date</th><th>Notes</th></tr></thead><tbody>${inspections.map(i=>`<tr><td><b>${esc(i.machine)}</b></td><td>${esc(i.type)}</td><td><span class="pill ${lower(i.result)==='fail'?'red':lower(i.result)==='attention'?'amber':''}">${esc(i.result)}</span></td><td>${esc(i.inspector)}</td><td>${esc(String(i.createdAt).slice(0,16).replace('T',' '))}</td><td>${esc(i.notes)}</td></tr>`).join('')||'<tr><td colspan="6" class="empty">No inspections captured yet.</td></tr>'}</tbody></table></div>`;
    return html(shell(s,view,"Inspections",main));
  }

  if (view === "checklists") {
    if (s.role !== "mechanic") return html(shell(s,"dashboard","Access restricted",heading(s,"Access restricted","Checklists are a Mechanic workspace.")),403);
    const rows = await all(env,"SELECT id,machine,item,status,notes,updated_at AS updatedAt FROM role_checklists_v4 WHERE company_id=? AND account_id=? ORDER BY id DESC LIMIT 200",[s.companyId,s.accountId]);
    const main = `${heading(s,"Checklists","Your maintenance and inspection checklist items.")}${note}<div class="panel no-print"><h2>Add checklist item</h2><form method="post" action="/role/action"><input type="hidden" name="action" value="checklist-add"><div class="twocol"><label class="field">Machine<select name="machine" required><option value="">Choose machine</option>${c.machines.map(m=>`<option>${esc(m.fleet)}</option>`).join('')}</select></label><label class="field">Checklist item<input name="item" required></label></div><label class="field">Notes<input name="notes"></label><button class="btn" type="submit">Add item</button></form></div><div class="panel section-gap"><table class="table"><thead><tr><th>Machine</th><th>Item</th><th>Status</th><th>Notes</th><th>Update</th></tr></thead><tbody>${rows.map(r=>`<tr><td>${esc(r.machine)}</td><td>${esc(r.item)}</td><td>${esc(r.status)}</td><td>${esc(r.notes)}</td><td><form method="post" action="/role/action"><input type="hidden" name="action" value="checklist-update"><input type="hidden" name="id" value="${num(r.id)}"><select name="status"><option>${esc(r.status)}</option><option>pending</option><option>completed</option><option>not applicable</option></select><button class="btn" type="submit">Save</button></form></td></tr>`).join('')||'<tr><td colspan="5" class="empty">No checklist items yet.</td></tr>'}</tbody></table></div>`;
    return html(shell(s,view,"Checklists",main));
  }

  if (view === "parts" || view === "inventory") {
    const rows = await all(env,"SELECT id,machine,part_name AS part,quantity,status,requester_name AS requester,created_at AS createdAt FROM role_parts_requests_v4 WHERE company_id=? ORDER BY id DESC LIMIT 250",[s.companyId]);
    const canAdd = ["engineer","supervisor","mechanic"].includes(s.role);
    const main = `${heading(s,view==='inventory'?'Inventory / Parts Requests':'Parts & Inventory',"Track parts required against machines and maintenance work.")}${note}${canAdd?`<div class="panel no-print"><h2>Request a part</h2><form method="post" action="/role/action"><input type="hidden" name="action" value="part-add"><div class="twocol"><label class="field">Machine<select name="machine" required><option value="">Choose machine</option>${c.machines.map(m=>`<option>${esc(m.fleet)}</option>`).join('')}</select></label><label class="field">Part<input name="part" required></label></div><label class="field">Quantity<input type="number" min="0.01" step="0.01" name="quantity" value="1"></label><button class="btn" type="submit">Request part</button></form></div>`:''}<div class="panel section-gap"><table class="table"><thead><tr><th>Machine</th><th>Part</th><th>Qty</th><th>Status</th><th>Requested by</th><th>Date</th></tr></thead><tbody>${rows.map(r=>`<tr><td>${esc(r.machine)}</td><td><b>${esc(r.part)}</b></td><td>${num(r.quantity)}</td><td><span class="pill amber">${esc(r.status)}</span></td><td>${esc(r.requester)}</td><td>${esc(String(r.createdAt).slice(0,10))}</td></tr>`).join('')||'<tr><td colspan="6" class="empty">No parts requests yet.</td></tr>'}</tbody></table></div>`;
    return html(shell(s,view,"Parts & Inventory",main));
  }

  if (view === "shift") {
    const notes = await all(env,"SELECT shift_name AS shift,note,created_at AS createdAt FROM role_shift_notes_v4 WHERE company_id=? ORDER BY id DESC LIMIT 100",[s.companyId]);
    const main = `${heading(s,"Shift Control","Supervisor shift notes, handover and current operational status.")}${note}<div class="panel no-print"><h2>Add shift / handover note</h2><form method="post" action="/role/action"><input type="hidden" name="action" value="shift-note"><div class="twocol"><label class="field">Shift<select name="shift"><option>Day Shift</option><option>Night Shift</option></select></label><label class="field">Date<input type="date" value="${isoDate()}" disabled></label></div><label class="field">Note<textarea name="note" required></textarea></label><button class="btn" type="submit">Save shift note</button></form></div><div class="panel section-gap"><h2>Recent shift notes</h2>${notes.map(n=>`<div class="mini"><span><b>${esc(n.shift)}</b> · ${esc(n.note)}</span><span>${esc(String(n.createdAt).slice(0,16).replace('T',' '))}</span></div>`).join('')||'<div class="empty">No shift notes recorded.</div>'}</div>`;
    return html(shell(s,view,"Shift Control",main));
  }

  if (view === "permits") {
    const permits = await all(env,"SELECT id,permit_type AS type,machine,reference,status,created_at AS createdAt FROM role_permits_v4 WHERE company_id=? ORDER BY id DESC LIMIT 200",[s.companyId]);
    const main = `${heading(s,"Permits","Supervisor permit register for maintenance and operational work.")}${note}<div class="panel no-print"><h2>Add permit</h2><form method="post" action="/role/action"><input type="hidden" name="action" value="permit-add"><div class="twocol"><label class="field">Permit type<input name="type" required placeholder="Isolation / hot work / lifting"></label><label class="field">Machine<input name="machine"></label></div><label class="field">Reference<input name="reference"></label><button class="btn" type="submit">Add permit</button></form></div><div class="panel section-gap"><table class="table"><thead><tr><th>Type</th><th>Machine</th><th>Reference</th><th>Status</th><th>Date</th></tr></thead><tbody>${permits.map(p=>`<tr><td>${esc(p.type)}</td><td>${esc(p.machine)}</td><td>${esc(p.reference)}</td><td>${esc(p.status)}</td><td>${esc(String(p.createdAt).slice(0,10))}</td></tr>`).join('')||'<tr><td colspan="5" class="empty">No permits recorded.</td></tr>'}</tbody></table></div>`;
    return html(shell(s,view,"Permits",main));
  }

  if (view === "documents") {
    const docs = await all(env,"SELECT id,file_name AS fileName,category,content_type AS contentType,size_bytes AS sizeBytes,created_at AS createdAt FROM contractor_documents WHERE company_id=? ORDER BY id DESC LIMIT 250",[s.companyId]);
    const main = `${heading(s,"Documents","Company-specific document archive. Other contractors' files are not included.")}${note}<div class="panel"><table class="table"><thead><tr><th>File</th><th>Category</th><th>Type</th><th>Size</th><th>Date</th><th>Open</th></tr></thead><tbody>${docs.map(d=>`<tr><td><b>${esc(d.fileName)}</b></td><td>${esc(d.category)}</td><td>${esc(d.contentType)}</td><td>${(num(d.sizeBytes)/1024).toFixed(1)} KB</td><td>${esc(String(d.createdAt).slice(0,10))}</td><td><a class="btn blue" href="/api/contractor/documents/${num(d.id)}/download">Open</a></td></tr>`).join('')||'<tr><td colspan="6" class="empty">No documents stored.</td></tr>'}</tbody></table></div>`;
    return html(shell(s,view,"Documents",main));
  }

  if (view === "reports") {
    const hist = await all(env,"SELECT report_type AS type,period_key AS period,title,status,published_at AS publishedAt FROM report_history_v3 WHERE company_id=? ORDER BY published_at DESC LIMIT 100",[s.companyId]);
    const main = `${heading(s,"Reports","Open the Reports Centre or review company-specific report history.")}${note}<div class="panel"><div class="actions no-print"><a class="btn blue" href="/contractor-reports">Open Reports Centre</a><button class="btn" type="button" onclick="window.print()">Print this page</button></div></div><div class="panel section-gap"><h2>Report history</h2><table class="table"><thead><tr><th>Type</th><th>Period</th><th>Title</th><th>Status</th><th>Published</th></tr></thead><tbody>${hist.map(h=>`<tr><td>${esc(h.type)}</td><td>${esc(h.period)}</td><td>${esc(h.title)}</td><td>${esc(h.status)}</td><td>${esc(String(h.publishedAt).slice(0,16).replace('T',' '))}</td></tr>`).join('')||'<tr><td colspan="5" class="empty">No published report history yet.</td></tr>'}</tbody></table></div>`;
    return html(shell(s,view,"Reports",main));
  }

  if (view === "analytics") {
    const operating = c.production.reduce((x,r)=>x+num(r.operating),0), downtime=c.production.reduce((x,r)=>x+num(r.unplanned)+num(r.planned),0), tonnes=c.production.reduce((x,r)=>x+num(r.tonnes),0);
    const bySystem = new Map<string,number>(); c.events.forEach(e=>bySystem.set(String(e.system||'Other'),(bySystem.get(String(e.system||'Other'))||0)+1));
    const main = `${heading(s,"Analytics","Company-scoped reliability and production summary.")}${note}<div class="kpirow"><div class="kpi"><small>Operating hours</small><b class="green">${operating.toFixed(1)}</b></div><div class="kpi"><small>Downtime hours</small><b class="redtxt">${downtime.toFixed(1)}</b></div><div class="kpi"><small>Tonnes recorded</small><b class="bluetxt">${tonnes.toLocaleString()}</b></div><div class="kpi"><small>Fault events</small><b>${c.events.length}</b></div><div class="kpi"><small>Work orders</small><b>${c.work.length}</b></div></div><div class="panel"><h2>Faults by system</h2>${[...bySystem.entries()].sort((a,b)=>b[1]-a[1]).map(([k,v])=>`<div class="mini"><span>${esc(k)}</span><b>${v}</b></div>`).join('')||'<div class="empty">No fault data.</div>'}</div>`;
    return html(shell(s,view,"Analytics",main));
  }

  return html(shell(s,"dashboard","Workspace",heading(s,"Workspace","This module is being prepared.")));
}

function sameOrigin(request: Request) {
  const origin = request.headers.get("origin");
  return !origin || origin === new URL(request.url).origin;
}
async function handleAction(request: Request, env: Env, s: Session) {
  if (!sameOrigin(request)) return new Response("Forbidden",{status:403});
  await ensureSchema(env);
  const f = await request.formData();
  const action = lower(f.get("action"));
  const cid = s.companyId;

  if (action === "machine-update") {
    if (s.role !== "engineer") return redirect("machines","Engineer permission is required.","err");
    const id=num(f.get("id")),status=lower(f.get("status")),next=String(f.get("nextService")||'').trim();
    await env.DB.prepare("UPDATE machines SET status=?,next_service_hours=? WHERE id=? AND company_id=?").bind(status,next===''?null:num(next),id,cid).run();
    return redirect("machines","Machine updated successfully.");
  }
  if (action === "work-create") {
    if (!["engineer","supervisor"].includes(s.role)) return redirect("jobs","You do not have permission to create work orders.","err");
    const fleet=txt(f.get("fleet"),120),title=txt(f.get("title"),300),priority=lower(f.get("priority"))||'medium',assigned=txt(f.get("assignedTo"),160),due=txt(f.get("dueAt"),40);
    if (!fleet || !title) return redirect(s.role==='supervisor'?"jobs":"workorders","Machine and job are required.","err");
    await env.DB.prepare("INSERT INTO work_orders(company_id,fleet_number,title,priority,assigned_to,due_at,status,created_at) VALUES(?,?,?,?,?,?,?,?)").bind(cid,fleet,title,priority,assigned||null,due||null,'open',isoNow()).run();
    return redirect(s.role==='supervisor'?"jobs":"workorders","Work order created.");
  }
  if (action === "work-update") {
    const id=num(f.get("id")),status=lower(f.get("status")),assigned=txt(f.get("assignedTo"),160);
    const row=await first(env,"SELECT id,assigned_to AS assignedTo FROM work_orders WHERE id=? AND company_id=?",[id,cid]);
    if (!row) return redirect(s.role==='mechanic'?"jobs":"workorders","Work order not found.","err");
    if (s.role === "mechanic") {
      const a=String(row.assignedTo||'').toLowerCase(),me=s.fullName.toLowerCase(),mail=s.email.toLowerCase();
      if (a && a!==me && a!==mail) return redirect("jobs","This work order is assigned to another person.","err");
      await env.DB.prepare("UPDATE work_orders SET status=?,assigned_to=COALESCE(NULLIF(assigned_to,''),?) WHERE id=? AND company_id=?").bind(status,s.fullName,id,cid).run();
      return redirect("jobs","Job progress updated.");
    }
    if (!["engineer","supervisor"].includes(s.role)) return redirect("workorders","You do not have permission to edit work orders.","err");
    await env.DB.prepare("UPDATE work_orders SET status=?,assigned_to=? WHERE id=? AND company_id=?").bind(status,assigned||null,id,cid).run();
    return redirect(s.role==='supervisor'?"jobs":"workorders","Work order updated.");
  }
  if (action === "event-status") {
    if (!["engineer","supervisor"].includes(s.role)) return redirect("faults","You do not have permission to close faults.","err");
    const id=num(f.get("id")),status=lower(f.get("status"));
    const closed=status==='closed'?isoNow():null;
    await env.DB.prepare("UPDATE events SET status=?,closed_at=? WHERE id=? AND company_id=?").bind(status,closed,id,cid).run();
    return redirect(s.role==='supervisor'?"alerts":"faults","Fault status updated.");
  }
  if (action === "inspection-add") {
    if (!["engineer","supervisor","mechanic"].includes(s.role)) return redirect("inspections","Not permitted.","err");
    const machine=txt(f.get("machine"),120),type=txt(f.get("type"),160),result=lower(f.get("result"))||'pass',notes=txt(f.get("notes"),800);
    if (!machine||!type) return redirect("inspections","Machine and inspection type are required.","err");
    await env.DB.prepare("INSERT INTO role_inspections_v4(company_id,machine,inspection_type,result,notes,inspected_by,inspector_name,created_at) VALUES(?,?,?,?,?,?,?,?)").bind(cid,machine,type,result,notes||null,s.accountId,s.fullName,isoNow()).run();
    return redirect("inspections","Inspection saved.");
  }
  if (action === "checklist-add") {
    if (s.role !== "mechanic") return redirect("checklists","Mechanic permission is required.","err");
    const machine=txt(f.get("machine"),120),item=txt(f.get("item"),300),notes=txt(f.get("notes"),600);
    if (!machine||!item) return redirect("checklists","Machine and checklist item are required.","err");
    await env.DB.prepare("INSERT INTO role_checklists_v4(company_id,account_id,machine,item,status,notes,updated_at) VALUES(?,?,?,?,?,?,?)").bind(cid,s.accountId,machine,item,'pending',notes||null,isoNow()).run();
    return redirect("checklists","Checklist item added.");
  }
  if (action === "checklist-update") {
    if (s.role !== "mechanic") return redirect("checklists","Mechanic permission is required.","err");
    await env.DB.prepare("UPDATE role_checklists_v4 SET status=?,updated_at=? WHERE id=? AND company_id=? AND account_id=?").bind(lower(f.get("status")),isoNow(),num(f.get("id")),cid,s.accountId).run();
    return redirect("checklists","Checklist updated.");
  }
  if (action === "part-add") {
    if (!["engineer","supervisor","mechanic"].includes(s.role)) return redirect("parts","Not permitted.","err");
    const machine=txt(f.get("machine"),120),part=txt(f.get("part"),240),quantity=Math.max(.01,num(f.get("quantity"),1));
    if (!machine||!part) return redirect("parts","Machine and part are required.","err");
    await env.DB.prepare("INSERT INTO role_parts_requests_v4(company_id,machine,part_name,quantity,status,requested_by,requester_name,created_at) VALUES(?,?,?,?,?,?,?,?)").bind(cid,machine,part,quantity,'requested',s.accountId,s.fullName,isoNow()).run();
    return redirect("parts","Part request saved.");
  }
  if (action === "shift-note") {
    if (s.role !== "supervisor") return redirect("shift","Supervisor permission is required.","err");
    const shift=txt(f.get("shift"),80),note=txt(f.get("note"),1200); if(!note)return redirect("shift","Enter a shift note.","err");
    await env.DB.prepare("INSERT INTO role_shift_notes_v4(company_id,account_id,shift_name,note,created_at) VALUES(?,?,?,?,?)").bind(cid,s.accountId,shift||'Shift',note,isoNow()).run();
    return redirect("shift","Shift note saved.");
  }
  if (action === "permit-add") {
    if (s.role !== "supervisor") return redirect("permits","Supervisor permission is required.","err");
    const type=txt(f.get("type"),160),machine=txt(f.get("machine"),120),ref=txt(f.get("reference"),160); if(!type)return redirect("permits","Permit type is required.","err");
    await env.DB.prepare("INSERT INTO role_permits_v4(company_id,permit_type,machine,reference,status,created_by,created_at) VALUES(?,?,?,?,?,?,?)").bind(cid,type,machine||null,ref||null,'open',s.accountId,isoNow()).run();
    return redirect("permits","Permit added.");
  }
  return redirect("dashboard","Unknown action.","err");
}

function rewriteDashboardNav(body: string, role: string) {
  const mappings: Record<string,Array<[string,string]>> = {
    engineer: [["Fleet Overview","fleet"],["Machines","machines"],["Work Orders","workorders"],["Inspections","inspections"],["Maintenance","maintenance"],["Condition Monitoring","condition"],["Faults","faults"],["Parts & Inventory","parts"],["Documents","documents"],["Reports","reports"],["Analytics","analytics"]],
    supervisor: [["Shift Control","shift"],["Job Cards","jobs"],["Work Management","work"],["Assets","assets"],["Inspections","inspections"],["Maintenance","maintenance"],["Condition Monitoring","condition"],["Parts & Inventory","parts"],["Permits","permits"],["Reports","reports"],["Alerts","alerts"],["Documents","documents"]],
    mechanic: [["My Jobs","jobs"],["Faults","faults"],["Checklists","checklists"],["Parts & Inventory","parts"],["Maintenance","maintenance"],["Inspections","inspections"],["Documents","documents"],["Reports","reports"]],
    manager: [["Multi-Site Overview","sites"],["Assets","assets"],["Health Monitor","health"],["Maintenance","maintenance"],["Work Orders","workorders"],["Compliance","compliance"],["Inventory","inventory"],["Reports","reports"],["Analytics","analytics"],["Documents","documents"],["Alerts","alerts"]]
  };
  for (const [label,view] of mappings[role]||[]) {
    const rx = new RegExp(`href="[^"]*"([^>]*)><span>([^<]*)<\\/span>${label.replace(/[.*+?^${}()|[\]\\]/g,'\\$&')}<\\/a>`,'g');
    body = body.replace(rx,`href="/role?view=${view}"$1><span>$2</span>${label}</a>`);
  }
  return body;
}

export default {
  async fetch(request: Request, env: Env, ctx: ExecutionContext): Promise<Response> {
    const url = new URL(request.url);
    const path = url.pathname;

    if (path === "/role" || path === "/role/action") {
      const s = await session(request,env);
      if (!s) return Response.redirect(new URL("/contractor-login",request.url).toString(),302);
      if (!licenceActive(s)) return Response.redirect(new URL("/subscription-locked",request.url).toString(),302);
      if (!["engineer","supervisor","mechanic","manager"].includes(s.role)) return Response.redirect(new URL("/contractor",request.url).toString(),302);
      if (path === "/role/action") {
        if (request.method !== "POST") return new Response("Method not allowed",{status:405});
        return handleAction(request,env,s);
      }
      if (request.method !== "GET") return new Response("Method not allowed",{status:405});
      return renderRolePage(request,env,s);
    }

    const response = await commercialWorker.fetch(request,env as never,ctx);
    if (request.method === "GET" && path === "/contractor" && response.headers.get("content-type")?.includes("text/html")) {
      const s = await session(request,env);
      if (s && ["engineer","supervisor","mechanic","manager"].includes(s.role) && licenceActive(s)) {
        let body = await response.text();
        body = rewriteDashboardNav(body,s.role);
        const headers = new Headers(response.headers); headers.delete("content-length");
        return new Response(body,{status:response.status,statusText:response.statusText,headers});
      }
    }
    return response;
  }
};
