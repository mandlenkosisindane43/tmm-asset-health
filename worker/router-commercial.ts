import baseWorker from "./router-polish";
import { sindaneLogoDataUri } from "./sindane-logo-data";
import { ensureAccountRoles, roleLabel, rolesForAccount, validRoles } from "./account-roles";

interface ExecutionContext {
  waitUntil(promise: Promise<unknown>): void;
  passThroughOnException(): void;
}

interface CommercialEnv {
  DB: D1Database;
  ADMIN_PASSWORD?: string;
  [key: string]: unknown;
}

type SessionInfo = {
  companyId: number;
  accountId: number;
  email: string;
  fullName: string;
  role: string;
  accountStatus: string;
  companyName: string;
  licenceKey: string;
  licenceStatus: string;
  expiresAt: string;
  maxUsers: number;
};

const COOKIE = "sas_contractor_v2";
const enc = new TextEncoder();
const PBKDF2_ITERATIONS = 100000;

function esc(value: unknown) {
  return String(value ?? "").replace(/[&<>"']/g, c => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c] || c));
}
function text(value: unknown, max = 240) { return String(value ?? "").trim().slice(0, max); }
function email(value: unknown) { return text(value, 200).toLowerCase(); }
function bytesToHex(bytes: Uint8Array) { return Array.from(bytes, b => b.toString(16).padStart(2, "0")).join(""); }
function hexToBytes(value: string) { const out = new Uint8Array(value.length / 2); for (let i = 0; i < out.length; i++) out[i] = parseInt(value.slice(i * 2, i * 2 + 2), 16); return out; }
function b64url(bytes: Uint8Array) { let s = ""; bytes.forEach(b => s += String.fromCharCode(b)); return btoa(s).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/g, ""); }
function getCookie(request: Request, name: string) {
  const raw = request.headers.get("cookie") || "";
  for (const part of raw.split(";")) { const i = part.indexOf("="); if (i > -1 && part.slice(0, i).trim() === name) return part.slice(i + 1).trim(); }
  return "";
}
async function sha256(value: string) { return bytesToHex(new Uint8Array(await crypto.subtle.digest("SHA-256", enc.encode(value)))); }
async function secureEqual(a: string, b: string) {
  const [x, y] = await Promise.all([sha256(a), sha256(b)]);
  let diff = x.length ^ y.length;
  for (let i = 0; i < Math.min(x.length, y.length); i++) diff |= x.charCodeAt(i) ^ y.charCodeAt(i);
  return diff === 0;
}
async function passwordHash(password: string, saltHex: string) {
  const key = await crypto.subtle.importKey("raw", enc.encode(password), "PBKDF2", false, ["deriveBits"]);
  const bits = await crypto.subtle.deriveBits({ name: "PBKDF2", hash: "SHA-256", salt: hexToBytes(saltHex), iterations: PBKDF2_ITERATIONS }, key, 256);
  return bytesToHex(new Uint8Array(bits));
}
function json(data: unknown, status = 200, headers: Record<string,string> = {}) {
  return new Response(JSON.stringify(data), { status, headers: { "content-type": "application/json; charset=utf-8", "cache-control": "no-store", ...headers } });
}

async function ensureSessions(env: CommercialEnv) {
  await env.DB.prepare(`CREATE TABLE IF NOT EXISTS contractor_sessions (
    token_hash TEXT PRIMARY KEY,
    company_id INTEGER NOT NULL,
    account_id INTEGER NOT NULL,
    expires_at TEXT NOT NULL,
    created_at TEXT NOT NULL
  )`).run();
  await ensureAccountRoles(env);
}

async function currentSession(request: Request, env: CommercialEnv): Promise<SessionInfo | null> {
  const token = getCookie(request, COOKIE);
  if (!token) return null;
  try {
    const row = await env.DB.prepare(`SELECT s.company_id AS companyId,s.account_id AS accountId,s.expires_at AS sessionExpires,
      a.email,a.full_name AS fullName,COALESCE(NULLIF(s.active_role,''),a.role) AS role,a.status AS accountStatus,
      c.name AS companyName,c.licence_key AS licenceKey,c.licence_status AS licenceStatus,c.expires_at AS expiresAt,c.max_users AS maxUsers
      FROM contractor_sessions s
      JOIN contractor_accounts a ON a.id=s.account_id AND a.company_id=s.company_id
      JOIN companies c ON c.id=s.company_id
      WHERE s.token_hash=? LIMIT 1`).bind(await sha256(token)).first<Record<string, unknown>>();
    if (!row || String(row.accountStatus) !== "active") return null;
    if (new Date(String(row.sessionExpires)).getTime() < Date.now()) return null;
    return {
      companyId: Number(row.companyId), accountId: Number(row.accountId), email: String(row.email || ""),
      fullName: String(row.fullName || ""), role: String(row.role || ""), accountStatus: String(row.accountStatus || ""),
      companyName: String(row.companyName || ""), licenceKey: String(row.licenceKey || ""),
      licenceStatus: String(row.licenceStatus || ""), expiresAt: String(row.expiresAt || ""), maxUsers: Number(row.maxUsers || 0),
    };
  } catch { return null; }
}

function licenceActive(s: SessionInfo) {
  if (!["active", "trial"].includes(s.licenceStatus.toLowerCase())) return false;
  const expiry = new Date(s.expiresAt).getTime();
  return Number.isFinite(expiry) && Date.now() <= expiry;
}

async function commercialLogin(request: Request, env: CommercialEnv) {
  await ensureSessions(env);
  const body = await request.json().catch(() => ({})) as Record<string, unknown>;
  const userEmail = email(body.email);
  const password = String(body.password || "");
  if (!userEmail || !password) return json({ error: "Email and password are required." }, 400);

  const row = await env.DB.prepare(`SELECT a.id AS accountId,a.company_id AS companyId,a.full_name AS fullName,a.role,a.status AS accountStatus,
    a.password_hash AS passwordHash,a.password_salt AS passwordSalt,c.name AS companyName,c.licence_status AS licenceStatus,c.expires_at AS expiresAt,c.licence_key AS licenceKey,c.max_users AS maxUsers
    FROM contractor_accounts a JOIN companies c ON c.id=a.company_id WHERE lower(a.email)=? LIMIT 1`).bind(userEmail).first<Record<string, unknown>>();
  if (!row || String(row.accountStatus) !== "active") return json({ error: "Invalid email or password." }, 401);
  const calculated = await passwordHash(password, String(row.passwordSalt || ""));
  if (!(await secureEqual(calculated, String(row.passwordHash || "")))) return json({ error: "Invalid email or password." }, 401);

  const token = b64url(crypto.getRandomValues(new Uint8Array(32)));
  const now = new Date();
  const sessionExpiry = new Date(Date.now() + 12 * 3600000);
  await env.DB.prepare("DELETE FROM contractor_sessions WHERE expires_at<?").bind(now.toISOString()).run();
  const roles = await rolesForAccount(env, Number(row.accountId), Number(row.companyId));
  const initialRole = roles[0] || String(row.role || "mechanic");
  await env.DB.prepare("INSERT INTO contractor_sessions(token_hash,company_id,account_id,expires_at,created_at,active_role) VALUES(?,?,?,?,?,?)")
    .bind(await sha256(token), Number(row.companyId), Number(row.accountId), sessionExpiry.toISOString(), now.toISOString(), initialRole).run();

  const status = String(row.licenceStatus || "").toLowerCase();
  const expiry = new Date(String(row.expiresAt || "")).getTime();
  const locked = !["active", "trial"].includes(status) || !Number.isFinite(expiry) || Date.now() > expiry;
  return json({ ok: true, locked, redirect: locked ? "/subscription-locked" : roles.length > 1 ? "/select-role" : "/contractor" }, 200, {
    "set-cookie": `${COOKIE}=${token}; Path=/; HttpOnly; Secure; SameSite=Lax; Max-Age=43200`,
  });
}

async function selectRole(request: Request, env: CommercialEnv) {
  await ensureSessions(env);
  const s = await currentSession(request, env);
  if (!s) return Response.redirect(new URL("/contractor-login", request.url).toString(), 302);
  const roles = await rolesForAccount(env, s.accountId, s.companyId);
  if (request.method === "POST") {
    const form = await request.formData();
    const selected = validRoles([form.get("role")])[0];
    if (!selected || !roles.includes(selected)) return standalonePage("Choose role", `<div class="notice">That role is not assigned to your account.</div><a class="btn" href="/select-role">Try again</a>`, 403);
    const token = getCookie(request, COOKIE);
    await env.DB.prepare("UPDATE contractor_sessions SET active_role=? WHERE token_hash=? AND account_id=? AND company_id=?")
      .bind(selected, await sha256(token), s.accountId, s.companyId).run();
    return Response.redirect(new URL("/contractor", request.url).toString(), 303);
  }
  if (request.method !== "GET") return new Response("Method not allowed", { status: 405 });
  return standalonePage("Choose workspace role", `<section class="card"><h1>Choose your role</h1><p class="muted">${esc(s.fullName)}, this email has more than one role in <b>${esc(s.companyName)}</b>. Choose the workspace you want to use now.</p><form method="post" action="/select-role">${roles.map(role => `<label class="field" style="display:block;border:1px solid #dce5e8;border-radius:9px;padding:12px"><input type="radio" name="role" value="${esc(role)}" ${role===s.role?'checked':''} required> ${esc(roleLabel(role))}</label>`).join("")}<button class="btn" type="submit">Open selected workspace</button></form></section>`);
}

function standalonePage(title: string, body: string, status = 200) {
  return new Response(`<!doctype html><html><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>${esc(title)} · TMM Asset Health</title><style>
  *{box-sizing:border-box}body{margin:0;background:#f3f6f7;color:#10243b;font-family:Arial,Helvetica,sans-serif}.wrap{max-width:820px;margin:30px auto;padding:0 18px}.logo{text-align:center}.logo img{width:200px;height:150px;object-fit:contain}.card{background:#fff;border:1px solid #dce5e8;border-radius:16px;padding:24px;margin-top:16px}.btn{display:inline-block;border:0;border-radius:9px;background:#11975c;color:#fff;text-decoration:none;padding:11px 15px;font-weight:900;cursor:pointer;margin:6px 6px 0 0}.btn.navy{background:#0f3158}.field{display:grid;gap:6px;margin-top:12px;font-size:12px;font-weight:800}.field input,.field select{padding:12px;border:1px solid #c6d2d9;border-radius:8px;font-size:14px}.notice{background:#fff6e6;border:1px solid #efd18e;border-radius:10px;padding:14px;color:#6f4b08}.muted{color:#6c7a86;font-size:13px;line-height:1.5}
  </style></head><body><div class="wrap"><div class="logo"><img src="${sindaneLogoDataUri()}" alt="Sindane Asset Solutions"></div>${body}</div></body></html>`, {
    status, headers: { "content-type": "text/html; charset=utf-8", "cache-control": "private, no-store", "x-frame-options": "DENY", "referrer-policy": "same-origin", "content-security-policy": "default-src 'self'; style-src 'self' 'unsafe-inline'; img-src 'self' data:; frame-ancestors 'none'; base-uri 'self'" }
  });
}

function lockedPage(s: SessionInfo) {
  const expired = new Date(s.expiresAt).getTime() < Date.now();
  const heading = expired ? "Subscription expired" : "Company access suspended";
  return standalonePage(heading, `<section class="card" style="text-align:center"><h1>${heading}</h1><p class="muted">The TMM Asset Health workspace for <b>${esc(s.companyName)}</b> is securely locked.</p><div class="notice" style="margin:18px auto;max-width:650px">No machines, reports, documents, dashboards, printing or operational information are available until Sindane Asset Solutions activates the licence again.</div><p class="muted">Licence expiry: <b>${esc(s.expiresAt.slice(0,10))}</b><br>Contact: <b>admin@sindaneassetsolutions.co.za</b></p><form method="post" action="/api/contractor/logout"><button class="btn navy" type="submit">Sign out</button></form></section>`, 403);
}

async function ownerControlPage(message = "") {
  return standalonePage("Sindane Owner Licence Control", `<section class="card"><h1>Sindane Owner Licence Control</h1><p class="muted">Renew, activate or suspend a contractor licence. For a six-month licence use <b>180 days</b>. Renewal adds time from the current expiry if it has not expired yet; otherwise it starts from today.</p>${message}<form method="post" action="/owner/licence-control"><label class="field">Sindane owner password<input type="password" name="ownerPassword" required></label><label class="field">Company name or contractor administrator email<input name="companyRef" required placeholder="Example: MSV or admin@contractor.co.za"></label><label class="field">Action<select name="action"><option value="renew">Renew & Activate</option><option value="suspend">Suspend now</option></select></label><label class="field">Licence days<input type="number" name="licenceDays" min="1" max="3650" value="180"></label><button class="btn" type="submit">Apply licence action</button></form></section>`);
}

async function handleOwnerControl(request: Request, env: CommercialEnv) {
  if (request.method === "GET") return ownerControlPage();
  const form = await request.formData();
  const configured = String(env.ADMIN_PASSWORD || "");
  const supplied = String(form.get("ownerPassword") || "");
  if (!configured || !supplied || !(await secureEqual(supplied, configured))) return ownerControlPage(`<div class="notice">Owner password is incorrect.</div>`);
  const ref = text(form.get("companyRef"), 200);
  const action = text(form.get("action"), 20);
  const days = Math.max(1, Math.min(3650, Number(form.get("licenceDays") || 180)));
  const company = await env.DB.prepare(`SELECT c.id,c.name,c.expires_at AS expiresAt,c.licence_status AS status FROM companies c
    WHERE lower(c.name)=lower(?) OR EXISTS(SELECT 1 FROM contractor_accounts a WHERE a.company_id=c.id AND lower(a.email)=lower(?)) LIMIT 1`)
    .bind(ref, ref).first<Record<string, unknown>>();
  if (!company) return ownerControlPage(`<div class="notice">No contractor company was found for <b>${esc(ref)}</b>.</div>`);
  if (action === "suspend") {
    await env.DB.prepare("UPDATE companies SET licence_status='suspended' WHERE id=?").bind(Number(company.id)).run();
    return ownerControlPage(`<div class="notice"><b>${esc(company.name)}</b> is now suspended. Users can sign in, but no operational data is available until reactivation.</div>`);
  }
  const now = Date.now();
  const oldExpiry = new Date(String(company.expiresAt || "")).getTime();
  const base = Number.isFinite(oldExpiry) && oldExpiry > now ? oldExpiry : now;
  const newExpiry = new Date(base + days * 86400000).toISOString();
  await env.DB.prepare("UPDATE companies SET licence_status='active',expires_at=?,grace_days=0 WHERE id=?").bind(newExpiry, Number(company.id)).run();
  return ownerControlPage(`<div class="notice"><b>${esc(company.name)}</b> has been renewed and activated for ${days} days.<br>New expiry: <b>${esc(newExpiry.slice(0,10))}</b></div>`);
}

function protectedContractorPath(path: string) {
  return path === "/contractor" || path.startsWith("/contractor-") || path.startsWith("/company-admin/") || path.startsWith("/api/contractor/") || path === "/invite-delivery";
}

async function licenceBody(env: CommercialEnv, s: SessionInfo) {
  let quotation: Record<string, unknown> | null = null;
  try {
    quotation = await env.DB.prepare(`SELECT id,file_name AS fileName,created_at AS createdAt FROM contractor_documents
      WHERE company_id=? AND lower(category) IN ('quotation','licence-quotation','license-quotation','subscription-quotation') ORDER BY id DESC LIMIT 1`)
      .bind(s.companyId).first<Record<string, unknown>>();
  } catch { quotation = null; }
  const expiryMs = new Date(s.expiresAt).getTime();
  const daysRemaining = Number.isFinite(expiryMs) ? Math.max(0, Math.ceil((expiryMs - Date.now()) / 86400000)) : 0;
  const quote = quotation
    ? `<div class="sas-quote"><div><b>${esc(quotation.fileName)}</b><small>Latest licence/subscription quotation · ${esc(String(quotation.createdAt || "").slice(0,10))}</small></div><a class="sas-button no-print" href="/api/contractor/documents/${Number(quotation.id)}/download">Open quotation</a></div>`
    : `<div class="sas-notice">No licence/subscription quotation has been uploaded for this company yet.</div>`;
  return `<div class="sas-licence-head"><div><h1>Licence &amp; Subscription</h1><p>Commercial licence information for ${esc(s.companyName)}.</p></div><span class="sas-status">${esc(s.licenceStatus)}</span></div>
    <div class="sas-licence-grid">
      <div class="sas-licence-card"><small>Company</small><b>${esc(s.companyName)}</b></div>
      <div class="sas-licence-card"><small>Licence status</small><b>${esc(s.licenceStatus)}</b></div>
      <div class="sas-licence-card"><small>Days remaining</small><b>${daysRemaining}</b></div>
      <div class="sas-licence-card"><small>Expiry date</small><b>${esc(s.expiresAt.slice(0,10))}</b></div>
      <div class="sas-licence-card"><small>Maximum users</small><b>${s.maxUsers}</b></div>
      <div class="sas-licence-card"><small>Licence key</small><b>${esc(s.licenceKey)}</b></div>
      <div class="sas-licence-card"><small>Viewing as</small><b>${esc(s.fullName)}</b></div>
      <div class="sas-licence-card"><small>Role</small><b>${esc(roleLabel(s.role))}</b></div>
    </div>
    <section class="sas-licence-panel"><h2>Quotation / Subscription Document</h2>${quote}<div class="no-print" style="margin-top:14px"><button class="sas-button" type="button" onclick="window.print()">🖨 Print Licence Details</button></div></section>`;
}

function replaceAdminContent(body: string, newBody: string) {
  const marker = '<div class="content">';
  const start = body.indexOf(marker);
  const endMarker = '</div><footer class="foot">';
  const end = body.indexOf(endMarker, start + marker.length);
  if (start < 0 || end < 0) return body;
  return body.slice(0, start + marker.length) + newBody + body.slice(end);
}

function replaceRoleContent(body: string, newBody: string) {
  const start = body.indexOf('<div class="content"');
  if (start < 0) return body;
  const end = body.lastIndexOf('</div></main>');
  if (end < 0 || end <= start) return body;
  return body.slice(0, start) + `<div class="content" id="top">${newBody}</div>` + body.slice(end + '</div>'.length);
}

async function polishResponse(request: Request, response: Response, env: CommercialEnv, s: SessionInfo | null) {
  if (!s || request.method !== "GET") return response;
  const url = new URL(request.url);
  if (url.pathname !== "/contractor") return response;
  const contentType = response.headers.get("content-type") || "";
  if (!contentType.includes("text/html")) return response;
  let body = await response.text();
  const view = url.searchParams.get("view") || "dashboard";
  const canSeeLicence = ["manager", "company_admin", "admin"].includes(s.role);

  // Keep the existing sidebar and only adjust the requested menu item.
  if (!canSeeLicence) {
    body = body.replace(/<a href="\/contractor-licence">[\s\S]*?<\/a>/g, "");
    body = body.replace(/<a[^>]*href="\/contractor\?view=licence"[^>]*>[\s\S]*?<\/a>/g, "");
  } else if (s.role === "manager") {
    body = body.replaceAll('href="/contractor-licence"', 'href="/contractor?view=licence"');
    if (view === "licence") body = body.replace('<a href="/contractor?view=licence">', '<a class="active" href="/contractor?view=licence">');
  } else {
    // Company Admin: put Licence & Subscription immediately before the existing Settings item.
    body = body.replace(/<a href="\/contractor-licence">[\s\S]*?<\/a>/g, "");
    if (!body.includes('href="/contractor?view=licence"')) {
      const licenceClass = view === "licence" ? ' class="active"' : '';
      const licenceLink = `<a${licenceClass} href="/contractor?view=licence"><span>♢</span>Licence &amp; Subscription</a>`;
      body = body.replace(/(<a[^>]*href="\/contractor\?view=settings"[^>]*>[\s\S]*?<\/a>)/i, licenceLink + '$1');
    }
  }

  // Print button for Company Admin sits inside the approved top bar, not floating over the page.
  if (["company_admin", "admin"].includes(s.role) && !body.includes('class="sas-top-print"')) {
    body = body.replace('<form method="post" action="/api/contractor/logout">', '<button class="sas-top-print no-print" type="button" onclick="window.print()">🖨 Print</button><form method="post" action="/api/contractor/logout">');
  }

  // Licence opens as a normal dashboard view using the existing role/admin shell.
  if (view === "licence") {
    if (!canSeeLicence) {
      const denied = `<div class="sas-licence-head"><div><h1>Access restricted</h1><p>Licence &amp; Subscription is available only to the Company Administrator and Mine Manager.</p></div></div>`;
      body = s.role === "manager" ? replaceRoleContent(body, denied) : replaceAdminContent(body, denied);
    } else {
      const licence = await licenceBody(env, s);
      body = s.role === "manager" ? replaceRoleContent(body, licence) : replaceAdminContent(body, licence);
    }
  }

  body = body.replace("</style>", `.sas-top-print{border:1px solid #cbd5df;background:#11975c;color:#fff;border-radius:8px;padding:9px 12px;font-size:11px;font-weight:900;cursor:pointer}.sas-top-print:hover{background:#0d804e}.sas-licence-head{display:flex;justify-content:space-between;align-items:center;gap:12px;margin-bottom:14px}.sas-licence-head h1{margin:0;font-size:26px}.sas-licence-head p{margin:4px 0 0;color:#667085;font-size:12px}.sas-status{padding:7px 11px;border-radius:999px;background:#e7f6ee;color:#087849;font-size:11px;font-weight:900;text-transform:capitalize}.sas-licence-grid{display:grid;grid-template-columns:repeat(4,minmax(0,1fr));gap:11px}.sas-licence-card,.sas-licence-panel{background:#fff;border:1px solid #dfe5eb;border-radius:10px;padding:15px}.sas-licence-card small{display:block;color:#667085;font-size:10px;margin-bottom:7px}.sas-licence-card b{display:block;font-size:15px;overflow-wrap:anywhere}.sas-licence-panel{margin-top:13px}.sas-licence-panel h2{margin:0 0 12px;font-size:16px}.sas-quote{display:flex;justify-content:space-between;align-items:center;gap:12px;background:#f8fafb;border:1px solid #e4e9ed;border-radius:9px;padding:13px}.sas-quote small{display:block;color:#6b7280;margin-top:4px}.sas-button{display:inline-block;border:0;border-radius:8px;background:#11975c;color:#fff;text-decoration:none;padding:10px 13px;font-size:11px;font-weight:900;cursor:pointer}.sas-notice{padding:12px;border-radius:9px;background:#fff7e8;border:1px solid #efd79d;color:#76540b;font-size:12px}@media(max-width:900px){.sas-licence-grid{grid-template-columns:1fr 1fr}}@media(max-width:560px){.sas-licence-grid{grid-template-columns:1fr}.sas-licence-head{display:block}.sas-status{display:inline-block;margin-top:8px}}@media print{.sas-top-print,.no-print{display:none!important}}</style>`);

  const headers = new Headers(response.headers);
  headers.delete("content-length");
  headers.set("content-security-policy", "default-src 'self'; style-src 'self' 'unsafe-inline'; script-src 'self' 'unsafe-inline'; img-src 'self' data:; frame-ancestors 'none'; base-uri 'self'");
  return new Response(body, { status: response.status, statusText: response.statusText, headers });
}

export default {
  async fetch(request: Request, env: CommercialEnv, ctx: ExecutionContext): Promise<Response> {
    const url = new URL(request.url);
    const path = url.pathname;

    if (path === "/api/contractor/login" && request.method === "POST") return commercialLogin(request, env);
    if (path === "/select-role") return selectRole(request, env);
    if (path === "/owner/licence-control") return handleOwnerControl(request, env);
    if (path === "/contractor-licence") return Response.redirect(new URL("/contractor?view=licence", request.url).toString(), 302);

    await ensureSessions(env);
    const s = await currentSession(request, env);

    if (s && !licenceActive(s) && protectedContractorPath(path) && path !== "/api/contractor/logout" && path !== "/contractor-login") {
      return lockedPage(s);
    }
    if (path === "/subscription-locked" && s) {
      return licenceActive(s) ? Response.redirect(new URL("/contractor", request.url).toString(), 302) : lockedPage(s);
    }

    const response = await baseWorker.fetch(request, env as never, ctx);
    return polishResponse(request, response, env, s);
  },
};
