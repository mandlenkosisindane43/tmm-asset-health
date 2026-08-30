import baseWorker from "./router-polish";
import { sindaneLogoDataUri } from "./sindane-logo-data";

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
function roleLabel(role: string) { return ({ company_admin: "Company Administrator", manager: "Mine Manager", engineer: "Engineer", supervisor: "Supervisor", mechanic: "Mechanic" } as Record<string,string>)[role] || role; }
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
}

async function currentSession(request: Request, env: CommercialEnv): Promise<SessionInfo | null> {
  const token = getCookie(request, COOKIE);
  if (!token) return null;
  try {
    const row = await env.DB.prepare(`SELECT s.company_id AS companyId,s.account_id AS accountId,s.expires_at AS sessionExpires,
      a.email,a.full_name AS fullName,a.role,a.status AS accountStatus,
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
  await env.DB.prepare("INSERT INTO contractor_sessions(token_hash,company_id,account_id,expires_at,created_at) VALUES(?,?,?,?,?)")
    .bind(await sha256(token), Number(row.companyId), Number(row.accountId), sessionExpiry.toISOString(), now.toISOString()).run();

  const status = String(row.licenceStatus || "").toLowerCase();
  const expiry = new Date(String(row.expiresAt || "")).getTime();
  const locked = !["active", "trial"].includes(status) || !Number.isFinite(expiry) || Date.now() > expiry;
  return json({ ok: true, locked, redirect: locked ? "/subscription-locked" : "/contractor" }, 200, {
    "set-cookie": `${COOKIE}=${token}; Path=/; HttpOnly; Secure; SameSite=Lax; Max-Age=43200`,
  });
}

function page(title: string, body: string, status = 200) {
  return new Response(`<!doctype html><html><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>${esc(title)} · TMM Asset Health</title><style>
  *{box-sizing:border-box}body{margin:0;background:#f3f6f7;color:#10243b;font-family:Arial,Helvetica,sans-serif}.wrap{max-width:940px;margin:30px auto;padding:0 18px}.logo{text-align:center}.logo img{width:210px;height:160px;object-fit:contain}.card{background:#fff;border:1px solid #dce5e8;border-radius:16px;padding:24px;margin-top:16px}.grid{display:grid;grid-template-columns:repeat(3,1fr);gap:12px}.item{background:#f8fafb;border:1px solid #e4eaed;border-radius:10px;padding:14px}.item small{display:block;font-size:11px;color:#71808d;margin-bottom:5px}.item b{font-size:16px}.btn{display:inline-block;border:0;border-radius:9px;background:#11975c;color:#fff;text-decoration:none;padding:11px 15px;font-weight:900;cursor:pointer;margin:6px 6px 0 0}.btn.navy{background:#0f3158}.btn.red{background:#a92323}.field{display:grid;gap:6px;margin-top:12px;font-size:12px;font-weight:800}.field input,.field select{padding:12px;border:1px solid #c6d2d9;border-radius:8px;font-size:14px}.notice{background:#fff6e6;border:1px solid #efd18e;border-radius:10px;padding:14px;color:#6f4b08}.muted{color:#6c7a86;font-size:13px;line-height:1.5}.status{display:inline-block;border-radius:999px;padding:6px 10px;background:#e6f7ed;color:#087948;font-weight:900;text-transform:capitalize}.quote{display:flex;justify-content:space-between;gap:12px;align-items:center;border:1px solid #e1e8eb;border-radius:10px;padding:14px}@media(max-width:700px){.grid{grid-template-columns:1fr}.quote{display:block}}@media print{.no-print{display:none!important}.wrap{max-width:none;margin:0}.card{border:0}}
  </style></head><body><div class="wrap"><div class="logo"><img src="${sindaneLogoDataUri()}" alt="Sindane Asset Solutions"></div>${body}</div></body></html>`, {
    status, headers: { "content-type": "text/html; charset=utf-8", "cache-control": "private, no-store", "x-frame-options": "DENY", "referrer-policy": "same-origin", "content-security-policy": "default-src 'self'; style-src 'self' 'unsafe-inline'; script-src 'self' 'unsafe-inline'; img-src 'self' data:; frame-ancestors 'none'; base-uri 'self'" }
  });
}

function lockedPage(s: SessionInfo) {
  const expired = new Date(s.expiresAt).getTime() < Date.now();
  const heading = expired ? "Subscription expired" : "Company access suspended";
  return page(heading, `<section class="card" style="text-align:center"><h1>${heading}</h1><p class="muted">The TMM Asset Health workspace for <b>${esc(s.companyName)}</b> is securely locked.</p><div class="notice" style="margin:18px auto;max-width:650px">No machines, reports, documents, dashboards, printing or operational information are available until Sindane Asset Solutions activates the licence again.</div><p class="muted">Licence expiry: <b>${esc(s.expiresAt.slice(0,10))}</b><br>Contact: <b>admin@sindaneassetsolutions.co.za</b></p><form class="no-print" method="post" action="/api/contractor/logout"><button class="btn navy" type="submit">Sign out</button></form></section>`, 403);
}

async function licencePage(request: Request, env: CommercialEnv, s: SessionInfo) {
  if (!["company_admin", "manager"].includes(s.role)) return page("Access restricted", `<section class="card"><h1>Access restricted</h1><p>Licence & Subscription is available only to the Company Administrator and Mine Manager.</p><a class="btn navy" href="/contractor">Back to dashboard</a></section>`, 403);
  let quotation: Record<string, unknown> | null = null;
  try {
    quotation = await env.DB.prepare(`SELECT id,file_name AS fileName,created_at AS createdAt,category FROM contractor_documents
      WHERE company_id=? AND lower(category) IN ('quotation','licence-quotation','license-quotation','subscription-quotation') ORDER BY id DESC LIMIT 1`)
      .bind(s.companyId).first<Record<string, unknown>>();
  } catch { quotation = null; }
  const expiryMs = new Date(s.expiresAt).getTime();
  const daysRemaining = Number.isFinite(expiryMs) ? Math.max(0, Math.ceil((expiryMs - Date.now()) / 86400000)) : 0;
  const quote = quotation
    ? `<div class="quote"><div><b>${esc(quotation.fileName)}</b><div class="muted">Latest licence/subscription quotation · ${esc(String(quotation.createdAt || "").slice(0,10))}</div></div><a class="btn navy no-print" href="/api/contractor/documents/${Number(quotation.id)}/download">Open quotation</a></div>`
    : `<div class="notice">No licence/subscription quotation has been uploaded for this company yet.</div>`;
  return page("Licence & Subscription", `<section class="card"><div class="no-print"><a class="btn navy" href="/contractor">← Dashboard</a></div><h1>Licence & Subscription</h1><p class="muted">Only the Company Administrator and Mine Manager can see this commercial information.</p><div class="grid"><div class="item"><small>Company</small><b>${esc(s.companyName)}</b></div><div class="item"><small>Status</small><span class="status">${esc(s.licenceStatus)}</span></div><div class="item"><small>Days remaining</small><b>${daysRemaining}</b></div><div class="item"><small>Licence start / renewal term</small><b>Controlled by Sindane Asset Solutions</b></div><div class="item"><small>Expiry date</small><b>${esc(s.expiresAt.slice(0,10))}</b></div><div class="item"><small>Maximum users</small><b>${s.maxUsers}</b></div><div class="item"><small>Licence key</small><b>${esc(s.licenceKey)}</b></div><div class="item"><small>Viewing as</small><b>${esc(s.fullName)}</b></div><div class="item"><small>Role</small><b>${esc(roleLabel(s.role))}</b></div></div></section><section class="card"><h2>Quotation / Subscription Document</h2>${quote}<div class="no-print" style="margin-top:14px"><button class="btn" type="button" onclick="window.print()">🖨 Print Licence Details</button></div></section>`);
}

async function ownerControlPage(message = "") {
  return page("Sindane Owner Licence Control", `<section class="card"><h1>Sindane Owner Licence Control</h1><p class="muted">Renew, activate or suspend a contractor licence. For a six-month licence use <b>180 days</b>. Renewal adds time from the current expiry if the licence has not expired yet, otherwise from today.</p>${message}<form method="post" action="/owner/licence-control"><label class="field">Sindane owner password<input type="password" name="ownerPassword" required></label><label class="field">Company name or contractor administrator email<input name="companyRef" required placeholder="Example: MSV or admin@contractor.co.za"></label><label class="field">Action<select name="action"><option value="renew">Renew & Activate</option><option value="suspend">Suspend now</option></select></label><label class="field">Licence days<input type="number" name="licenceDays" min="1" max="3650" value="180"></label><button class="btn" type="submit">Apply licence action</button></form></section>`);
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
    return ownerControlPage(`<div class="notice"><b>${esc(company.name)}</b> is now suspended. Users may authenticate, but the operational workspace is locked.</div>`);
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

async function polishResponse(request: Request, response: Response, s: SessionInfo | null) {
  if (!s || request.method !== "GET") return response;
  const path = new URL(request.url).pathname;
  if (path !== "/contractor") return response;
  const contentType = response.headers.get("content-type") || "";
  if (!contentType.includes("text/html")) return response;
  let body = await response.text();

  // Inner role dashboards currently add Licence to all roles; commercial policy restricts it to Mine Manager.
  if (!["manager", "company_admin"].includes(s.role)) {
    body = body.replace(/<a href="\/contractor-licence">[\s\S]*?<\/a>/g, "");
  }

  if (s.role === "company_admin") {
    if (!body.includes('/contractor-licence')) {
      const licenceLink = `<a href="/contractor-licence"><span>♢</span> Licence &amp; Subscription</a>`;
      const settingsLink = /(<a[^>]*>[\s\S]*?Settings[\s\S]*?<\/a>)/i;
      body = settingsLink.test(body) ? body.replace(settingsLink, licenceLink + "$1") : body.replace("</nav>", licenceLink + "</nav>");
    }
    body = body.replace("</style>", `.sas-admin-print{position:fixed;top:12px;right:18px;z-index:9999;border:0;border-radius:8px;background:#11975c;color:#fff;padding:10px 13px;font-weight:900;cursor:pointer;box-shadow:0 4px 14px rgba(0,0,0,.15)}.sas-admin-print:hover{background:#0d804e}@media print{.side,.sas-admin-print{display:none!important}.app{display:block!important}body{background:#fff!important}}</style>`);
    body = body.replace("</body>", `<button class="sas-admin-print" type="button" onclick="window.print()">🖨 Print</button></body>`);
  }

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
    if (path === "/owner/licence-control") return handleOwnerControl(request, env);

    const s = await currentSession(request, env);

    if (s && !licenceActive(s) && protectedContractorPath(path) && path !== "/api/contractor/logout" && path !== "/contractor-login") {
      return lockedPage(s);
    }

    if (path === "/subscription-locked" && s) {
      return licenceActive(s) ? Response.redirect(new URL("/contractor", request.url).toString(), 302) : lockedPage(s);
    }

    if (path === "/contractor-licence" && request.method === "GET") {
      if (!s) return Response.redirect(new URL("/contractor-login", request.url).toString(), 302);
      if (!licenceActive(s)) return lockedPage(s);
      return licencePage(request, env, s);
    }

    const response = await baseWorker.fetch(request, env as never, ctx);
    return polishResponse(request, response, s);
  },
};
