export interface ContractorAuthFixEnv {
  DB: D1Database;
  ADMIN_PASSWORD?: string;
}

const encoder = new TextEncoder();
const COOKIE = "sas_contractor_v2";
const PBKDF2_ITERATIONS = 100000;

function text(value: unknown, max = 240) {
  return String(value ?? "").trim().slice(0, max);
}

function email(value: unknown) {
  return text(value, 200).toLowerCase();
}

function bytesToHex(bytes: Uint8Array) {
  return Array.from(bytes, (b) => b.toString(16).padStart(2, "0")).join("");
}

function hexToBytes(value: string) {
  const out = new Uint8Array(value.length / 2);
  for (let i = 0; i < out.length; i++) out[i] = parseInt(value.slice(i * 2, i * 2 + 2), 16);
  return out;
}

function b64url(bytes: Uint8Array) {
  let s = "";
  bytes.forEach((b) => (s += String.fromCharCode(b)));
  return btoa(s).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/g, "");
}

function escapeHtml(value: unknown) {
  return String(value ?? "").replace(/[&<>"']/g, (c) => ({
    "&": "&amp;",
    "<": "&lt;",
    ">": "&gt;",
    '"': "&quot;",
    "'": "&#39;",
  }[c] || c));
}

async function sha256(value: string) {
  return bytesToHex(new Uint8Array(await crypto.subtle.digest("SHA-256", encoder.encode(value))));
}

async function secureEqual(a: string, b: string) {
  const [x, y] = await Promise.all([sha256(a), sha256(b)]);
  let diff = x.length ^ y.length;
  for (let i = 0; i < Math.min(x.length, y.length); i++) diff |= x.charCodeAt(i) ^ y.charCodeAt(i);
  return diff === 0;
}

async function passwordHash(password: string, saltHex: string) {
  const key = await crypto.subtle.importKey("raw", encoder.encode(password), "PBKDF2", false, ["deriveBits"]);
  const bits = await crypto.subtle.deriveBits(
    {
      name: "PBKDF2",
      hash: "SHA-256",
      salt: hexToBytes(saltHex),
      iterations: PBKDF2_ITERATIONS,
    },
    key,
    256,
  );
  return bytesToHex(new Uint8Array(bits));
}

function json(data: unknown, status = 200, headers: Record<string, string> = {}) {
  return new Response(JSON.stringify(data), {
    status,
    headers: {
      "content-type": "application/json; charset=utf-8",
      "cache-control": "no-store",
      ...headers,
    },
  });
}

function page(title: string, body: string, status = 200) {
  return new Response(
    `<!doctype html><html><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>${escapeHtml(title)}</title><style>
    *{box-sizing:border-box}body{margin:0;background:#f4f7fb;font-family:Arial,sans-serif;color:#14213d;padding:28px}.card{max-width:760px;margin:auto;background:#fff;border:1px solid #dce5ef;border-radius:16px;padding:25px}.btn{display:inline-block;border:0;background:#1267b3;color:#fff;padding:13px 18px;border-radius:9px;font-weight:900;margin:18px 8px 0 0;text-decoration:none}.result{margin-top:18px;padding:15px;border-radius:10px;white-space:pre-wrap;line-height:1.55}.ok{background:#e8f7ee;color:#17633a;border:1px solid #b8e2c8}.err{background:#fff0f0;color:#a11b1b;border:1px solid #efc5c5}.details{display:grid;gap:8px;margin-top:14px}.details div{background:#f8fafc;padding:10px;border-radius:8px}.details b{display:block;font-size:11px;color:#64748b;margin-bottom:3px}</style></head><body><div class="card">${body}</div></body></html>`,
    {
      status,
      headers: {
        "content-type": "text/html; charset=utf-8",
        "cache-control": "no-store",
        "x-frame-options": "DENY",
        "referrer-policy": "same-origin",
        "content-security-policy": "default-src 'self'; style-src 'self' 'unsafe-inline'; frame-ancestors 'none'; base-uri 'self'",
      },
    },
  );
}

async function ensureAuthTables(env: ContractorAuthFixEnv) {
  await env.DB.prepare(`CREATE TABLE IF NOT EXISTS companies (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    name TEXT NOT NULL,
    licence_key TEXT NOT NULL UNIQUE,
    licence_status TEXT NOT NULL DEFAULT 'trial',
    expires_at TEXT NOT NULL,
    grace_days INTEGER NOT NULL DEFAULT 7,
    max_users INTEGER NOT NULL DEFAULT 10,
    created_at TEXT NOT NULL
  )`).run();

  await env.DB.prepare(`CREATE TABLE IF NOT EXISTS contractor_accounts (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    company_id INTEGER NOT NULL,
    email TEXT NOT NULL UNIQUE,
    full_name TEXT NOT NULL,
    role TEXT NOT NULL DEFAULT 'company_admin',
    status TEXT NOT NULL DEFAULT 'active',
    password_hash TEXT NOT NULL,
    password_salt TEXT NOT NULL,
    created_at TEXT NOT NULL,
    updated_at TEXT NOT NULL
  )`).run();

  await env.DB.prepare(`CREATE TABLE IF NOT EXISTS contractor_sessions (
    token_hash TEXT PRIMARY KEY,
    company_id INTEGER NOT NULL,
    account_id INTEGER NOT NULL,
    expires_at TEXT NOT NULL,
    created_at TEXT NOT NULL
  )`).run();
}

function licenceValid(status: string, expiresAt: string, graceDays: number) {
  if (!["active", "trial"].includes(status.toLowerCase())) return false;
  const end = new Date(expiresAt).getTime() + Math.max(0, graceDays) * 86400000;
  return Number.isFinite(end) && Date.now() <= end;
}

async function createFromOwnerForm(request: Request, env: ContractorAuthFixEnv) {
  try {
    await ensureAuthTables(env);
    const form = await request.formData();
    const ownerPassword = String(form.get("ownerPassword") || "");
    const configured = String(env.ADMIN_PASSWORD || "");

    if (!configured) {
      return page("Setup required", `<h1>Contractor not created</h1><div class="result err">ADMIN_PASSWORD is not configured in Cloudflare.</div><a class="btn" href="/owner/contractors">Back</a>`, 503);
    }
    if (!ownerPassword || !(await secureEqual(ownerPassword, configured))) {
      return page("Authentication failed", `<h1>Contractor not created</h1><div class="result err"><b>Owner password is incorrect.</b><br>Use the exact ADMIN_PASSWORD configured in Cloudflare.</div><a class="btn" href="/owner/contractors">Try again</a>`, 401);
    }

    const companyName = text(form.get("companyName"), 120);
    const fullName = text(form.get("fullName"), 120);
    const userEmail = email(form.get("email"));
    const password = String(form.get("password") || "");
    const role = text(form.get("role") || "company_admin", 40);

    if (!companyName || !fullName || !userEmail) {
      return page("Missing information", `<h1>Contractor not created</h1><div class="result err">Company name, administrator name and email are required.</div><a class="btn" href="/owner/contractors">Back</a>`, 400);
    }
    if (!userEmail.includes("@")) {
      return page("Invalid email", `<h1>Contractor not created</h1><div class="result err">Enter a valid administrator email address.</div><a class="btn" href="/owner/contractors">Back</a>`, 400);
    }
    if (password.length < 10) {
      return page("Password too short", `<h1>Contractor not created</h1><div class="result err">Contractor password must contain at least 10 characters.</div><a class="btn" href="/owner/contractors">Back</a>`, 400);
    }

    const existing = await env.DB.prepare("SELECT id FROM contractor_accounts WHERE lower(email)=? LIMIT 1").bind(userEmail).first();
    if (existing) {
      return page("Email already used", `<h1>Contractor not created</h1><div class="result err">The administrator email <b>${escapeHtml(userEmail)}</b> is already linked to a contractor account.</div><a class="btn" href="/contractor-login">Go to contractor login</a><a class="btn" href="/owner/contractors">Back</a>`, 409);
    }

    // Hash first. This prevents a failed hashing operation from leaving a half-created company record.
    const salt = bytesToHex(crypto.getRandomValues(new Uint8Array(16)));
    const hash = await passwordHash(password, salt);

    const days = Math.max(1, Math.min(3650, Number(form.get("licenceDays") || 30)));
    const now = new Date();
    const expiresAt = new Date(Date.now() + days * 86400000).toISOString();
    const licenceKey = "SAS-" + b64url(crypto.getRandomValues(new Uint8Array(12))).toUpperCase();

    await env.DB.prepare("INSERT INTO companies(name,licence_key,licence_status,expires_at,grace_days,max_users,created_at) VALUES(?,?,?,?,?,?,?)")
      .bind(companyName, licenceKey, "active", expiresAt, 7, 10, now.toISOString()).run();

    const company = await env.DB.prepare("SELECT id FROM companies WHERE licence_key=? LIMIT 1").bind(licenceKey).first<{ id: number }>();
    if (!company) throw new Error("Company row could not be retrieved after creation.");

    try {
      await env.DB.prepare("INSERT INTO contractor_accounts(company_id,email,full_name,role,status,password_hash,password_salt,created_at,updated_at) VALUES(?,?,?,?,?,?,?,?,?)")
        .bind(company.id, userEmail, fullName, role, "active", hash, salt, now.toISOString(), now.toISOString()).run();
    } catch (error) {
      // Roll back the company row if the administrator insert fails.
      try { await env.DB.prepare("DELETE FROM companies WHERE id=?").bind(company.id).run(); } catch { /* best effort rollback */ }
      throw error;
    }

    return page("Contractor created", `<h1>Created successfully ✅</h1><div class="result ok">The contractor company and administrator login are now active.</div><div class="details"><div><b>Company</b>${escapeHtml(companyName)}</div><div><b>Administrator</b>${escapeHtml(fullName)}</div><div><b>Login email</b>${escapeHtml(userEmail)}</div><div><b>Licence key</b>${escapeHtml(licenceKey)}</div><div><b>Licence expires</b>${escapeHtml(expiresAt)}</div><div><b>Password protection</b>PBKDF2-SHA256 · 100,000 iterations</div></div><a class="btn" href="/contractor-login">Test contractor login</a><a class="btn" href="/owner/contractors">Create another contractor</a>`, 201);
  } catch (error) {
    console.error("CONTRACTOR_AUTH_CREATE_ERROR", error);
    return page("Creation error", `<h1>Contractor not created</h1><div class="result err">Server/database error: ${escapeHtml(error instanceof Error ? error.message : String(error))}</div><a class="btn" href="/owner/contractors">Back</a>`, 500);
  }
}

async function contractorLogin(request: Request, env: ContractorAuthFixEnv) {
  try {
    await ensureAuthTables(env);
    const body = await request.json().catch(() => ({})) as Record<string, unknown>;
    const userEmail = email(body.email);
    const password = String(body.password || "");
    if (!userEmail || !password) return json({ error: "Email and password are required." }, 400);

    const row = await env.DB.prepare(`SELECT
      a.id AS accountId,
      a.company_id AS companyId,
      a.full_name AS fullName,
      a.role,
      a.status AS accountStatus,
      a.password_hash AS passwordHash,
      a.password_salt AS passwordSalt,
      c.name AS companyName,
      c.licence_status AS licenceStatus,
      c.expires_at AS licenceExpires,
      c.grace_days AS graceDays
      FROM contractor_accounts a
      JOIN companies c ON c.id=a.company_id
      WHERE lower(a.email)=?
      LIMIT 1`).bind(userEmail).first<Record<string, unknown>>();

    if (!row || String(row.accountStatus) !== "active") return json({ error: "Invalid email or password." }, 401);

    const calculated = await passwordHash(password, String(row.passwordSalt));
    if (!(await secureEqual(calculated, String(row.passwordHash)))) return json({ error: "Invalid email or password." }, 401);

    if (!licenceValid(String(row.licenceStatus), String(row.licenceExpires), Number(row.graceDays || 0))) {
      return json({ error: "Company licence is inactive or expired." }, 403);
    }

    const token = b64url(crypto.getRandomValues(new Uint8Array(32)));
    const tokenHash = await sha256(token);
    const now = new Date();
    const expires = new Date(Date.now() + 12 * 3600000);

    await env.DB.prepare("DELETE FROM contractor_sessions WHERE expires_at<?").bind(now.toISOString()).run();
    await env.DB.prepare("INSERT INTO contractor_sessions(token_hash,company_id,account_id,expires_at,created_at) VALUES(?,?,?,?,?)")
      .bind(tokenHash, Number(row.companyId), Number(row.accountId), expires.toISOString(), now.toISOString()).run();

    return json({ ok: true }, 200, {
      "set-cookie": `${COOKIE}=${token}; Path=/; HttpOnly; Secure; SameSite=Lax; Max-Age=43200`,
    });
  } catch (error) {
    console.error("CONTRACTOR_AUTH_LOGIN_ERROR", error);
    return json({ error: "Contractor login service error. Check Cloudflare Observability." }, 500);
  }
}

export async function handleContractorAuthFix(request: Request, env: ContractorAuthFixEnv): Promise<Response | null> {
  const path = new URL(request.url).pathname;

  if (path === "/owner/contractors/create" && request.method === "POST") {
    return createFromOwnerForm(request, env);
  }

  if (path === "/api/contractor/login" && request.method === "POST") {
    return contractorLogin(request, env);
  }

  return null;
}
