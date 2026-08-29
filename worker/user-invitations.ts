export interface InvitationEnv {
  DB: D1Database;
  RESEND_API_KEY?: string;
  INVITE_FROM_EMAIL?: string;
}

type Session = {
  companyId: number;
  accountId: number;
  fullName: string;
  email: string;
  role: string;
  companyName: string;
};

const COOKIE = "sas_contractor_v2";
const PBKDF2_ITERATIONS = 100000;
const enc = new TextEncoder();
let schemaReady: Promise<void> | null = null;

function esc(v: unknown) {
  return String(v ?? "").replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c] || c));
}
function txt(v: unknown, max = 240) { return String(v ?? "").trim().slice(0, max); }
function lower(v: unknown) { return txt(v, 200).toLowerCase(); }
function bytesToHex(bytes: Uint8Array) { return Array.from(bytes, (b) => b.toString(16).padStart(2, "0")).join(""); }
function hexToBytes(value: string) { const out = new Uint8Array(value.length / 2); for (let i = 0; i < out.length; i++) out[i] = parseInt(value.slice(i * 2, i * 2 + 2), 16); return out; }
async function sha256(value: string) { return bytesToHex(new Uint8Array(await crypto.subtle.digest("SHA-256", enc.encode(value)))); }
async function passwordHash(password: string, saltHex: string) {
  const key = await crypto.subtle.importKey("raw", enc.encode(password), "PBKDF2", false, ["deriveBits"]);
  const bits = await crypto.subtle.deriveBits({ name: "PBKDF2", hash: "SHA-256", salt: hexToBytes(saltHex), iterations: PBKDF2_ITERATIONS }, key, 256);
  return bytesToHex(new Uint8Array(bits));
}
function getCookie(request: Request) {
  const raw = request.headers.get("cookie") || "";
  for (const part of raw.split(";")) {
    const i = part.indexOf("=");
    if (i > -1 && part.slice(0, i).trim() === COOKIE) return part.slice(i + 1).trim();
  }
  return "";
}
function redirect(location: string) { return new Response(null, { status: 303, headers: { location, "cache-control": "no-store" } }); }
function html(body: string, status = 200) {
  return new Response(body, { status, headers: {
    "content-type": "text/html; charset=utf-8",
    "cache-control": "private, no-store",
    "x-frame-options": "DENY",
    "referrer-policy": "same-origin",
    "content-security-policy": "default-src 'self'; style-src 'self' 'unsafe-inline'; img-src 'self' data:; frame-ancestors 'none'; base-uri 'self'; form-action 'self'"
  }});
}
function roleName(role: string) {
  return ({ company_admin: "Company Administrator", engineer: "Engineer", mechanic: "Mechanic", supervisor: "Supervisor", manager: "Manager", admin: "Administrator" } as Record<string,string>)[role] || role.replace(/_/g, " ");
}
async function ensureSchema(env: InvitationEnv) {
  if (schemaReady) return schemaReady;
  schemaReady = (async () => {
    await env.DB.prepare(`CREATE TABLE IF NOT EXISTS user_invitations_v3 (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      company_id INTEGER NOT NULL,
      email TEXT NOT NULL,
      full_name TEXT NOT NULL,
      role TEXT NOT NULL,
      token_hash TEXT NOT NULL UNIQUE,
      status TEXT NOT NULL DEFAULT 'pending',
      created_by INTEGER NOT NULL,
      created_at TEXT NOT NULL,
      expires_at TEXT NOT NULL,
      accepted_at TEXT,
      provider_message_id TEXT
    )`).run();
    await env.DB.prepare(`CREATE INDEX IF NOT EXISTS idx_user_invitations_company_email ON user_invitations_v3(company_id,email,status)`).run();
  })().catch((e) => { schemaReady = null; throw e; });
  return schemaReady;
}
async function session(request: Request, env: InvitationEnv): Promise<Session | null> {
  const token = getCookie(request);
  if (!token) return null;
  const row = await env.DB.prepare(`SELECT s.company_id AS companyId,s.account_id AS accountId,s.expires_at AS sessionExpires,a.email,a.full_name AS fullName,a.role,a.status AS accountStatus,c.name AS companyName,c.licence_status AS licenceStatus,c.expires_at AS licenceExpires,c.grace_days AS graceDays FROM contractor_sessions s JOIN contractor_accounts a ON a.id=s.account_id AND a.company_id=s.company_id JOIN companies c ON c.id=s.company_id WHERE s.token_hash=? LIMIT 1`).bind(await sha256(token)).first<Record<string, unknown>>();
  if (!row || String(row.accountStatus) !== "active" || new Date(String(row.sessionExpires)).getTime() < Date.now()) return null;
  const licenceStatus = String(row.licenceStatus || "").toLowerCase();
  const licenceEnd = new Date(String(row.licenceExpires)).getTime() + Number(row.graceDays || 0) * 86400000;
  if (!["active", "trial"].includes(licenceStatus) || Date.now() > licenceEnd) return null;
  return { companyId: Number(row.companyId), accountId: Number(row.accountId), fullName: String(row.fullName), email: String(row.email), role: String(row.role), companyName: String(row.companyName) };
}
function page(title: string, content: string) {
  return `<!doctype html><html><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>${esc(title)} | TMM Asset Health</title><style>
  *{box-sizing:border-box}body{margin:0;background:#f3f6f8;color:#0b1724;font-family:Arial,Helvetica,sans-serif}.wrap{min-height:100vh;display:grid;place-items:center;padding:26px}.card{width:min(580px,100%);background:#fff;border:1px solid #dfe7eb;border-radius:18px;box-shadow:0 18px 50px rgba(8,28,41,.09);overflow:hidden}.brand{background:linear-gradient(135deg,#071622,#0a2b2a);padding:26px 30px;color:white}.mark{display:inline-flex;align-items:center;gap:10px;font-weight:900;font-size:18px}.mark i{display:grid;place-items:center;width:38px;height:38px;border-radius:12px;background:#11975c;font-style:normal}.brand small{display:block;color:#e4ad17;letter-spacing:.18em;font-size:9px;margin-top:8px}.body{padding:30px}.body h1{font-size:27px;margin:0 0 8px}.body p{color:#52606c;line-height:1.55}.field{display:block;font-size:12px;font-weight:800;margin:15px 0}.field input{display:block;width:100%;margin-top:7px;padding:13px;border:1px solid #cfd9df;border-radius:9px;font-size:14px}.btn{border:0;border-radius:9px;background:#11975c;color:white;font-weight:900;padding:13px 18px;font-size:14px;cursor:pointer;width:100%;margin-top:8px}.meta{background:#f7faf8;border:1px solid #dcebe2;border-radius:10px;padding:14px;margin:16px 0;font-size:13px}.meta b{color:#096b43}.err{background:#fff0f0;border:1px solid #f2b8b8;color:#a20e0e;padding:12px;border-radius:9px;margin-bottom:14px}.ok{background:#edf9f2;border:1px solid #b7e3c8;color:#08683f;padding:12px;border-radius:9px;margin-bottom:14px}.link{display:inline-block;color:#08764a;font-weight:800;text-decoration:none;margin-top:14px}.foot{text-align:center;color:#84909a;font-size:10px;padding:0 30px 26px}</style></head><body><div class="wrap"><div class="card"><div class="brand"><div class="mark"><i>SA</i><span>SINDANE ASSET SOLUTIONS</span></div><small>TRACK. PREVENT. PERFORM.</small></div><div class="body">${content}</div><div class="foot">TMM Asset Health · Secure company workspace</div></div></div></body></html>`;
}
async function sendInviteEmail(env: InvitationEnv, input: { to: string; name: string; company: string; role: string; link: string; inviter: string; }) {
  if (!env.RESEND_API_KEY) throw new Error("Email service is not configured. Add the RESEND_API_KEY secret in Cloudflare.");
  const from = txt(env.INVITE_FROM_EMAIL || "TMM Asset Health <admin@sindaneassetsolutions.co.za>", 250);
  const subject = `${input.company} invited you to TMM Asset Health`;
  const emailHtml = `<!doctype html><html><body style="margin:0;background:#f4f7f6;font-family:Arial,sans-serif;color:#10202b"><div style="max-width:620px;margin:30px auto;background:#fff;border-radius:14px;overflow:hidden;border:1px solid #e1e8e5"><div style="background:#071622;padding:28px;color:#fff"><div style="font-size:22px;font-weight:800">Sindane Asset Solutions</div><div style="font-size:10px;letter-spacing:3px;color:#e4ad17;margin-top:7px">TRACK. PREVENT. PERFORM.</div></div><div style="padding:30px"><h2 style="margin-top:0">You're invited to TMM Asset Health</h2><p>Hello ${esc(input.name)},</p><p>${esc(input.inviter)} has invited you to join <strong>${esc(input.company)}</strong> as <strong>${esc(roleName(input.role))}</strong>.</p><p>Use the secure button below to accept the invitation and create your own password. This link expires in 48 hours and can only be used once.</p><p style="margin:28px 0"><a href="${esc(input.link)}" style="background:#11975c;color:#fff;padding:13px 20px;text-decoration:none;border-radius:8px;font-weight:700">Accept invitation</a></p><p style="font-size:12px;color:#66747d">If the button does not work, copy this link into your browser:<br>${esc(input.link)}</p></div><div style="padding:18px 30px;background:#f7faf8;font-size:11px;color:#7d898f">TMM Asset Health · Sindane Asset Solutions</div></div></body></html>`;
  const res = await fetch("https://api.resend.com/emails", {
    method: "POST",
    headers: { "authorization": `Bearer ${env.RESEND_API_KEY}`, "content-type": "application/json" },
    body: JSON.stringify({ from, to: [input.to], subject, html: emailHtml })
  });
  const data = await res.json().catch(() => ({})) as Record<string, unknown>;
  if (!res.ok) {
    const message = String(data.message || data.name || `Email provider returned ${res.status}`);
    throw new Error(message);
  }
  return String(data.id || "");
}

export async function handleUserInvitations(request: Request, env: InvitationEnv): Promise<Response | null> {
  const url = new URL(request.url);
  const path = url.pathname;
  if (!["/company-admin/users/invite", "/accept-invite", "/invite-health"].includes(path)) return null;
  await ensureSchema(env);

  if (path === "/invite-health" && request.method === "GET") {
    return Response.json({ ok: true, service: "user-invitations", emailConfigured: Boolean(env.RESEND_API_KEY), sender: env.INVITE_FROM_EMAIL || "admin@sindaneassetsolutions.co.za" }, { headers: { "cache-control": "no-store" } });
  }

  if (path === "/company-admin/users/invite" && request.method === "POST") {
    const s = await session(request, env);
    if (!s) return redirect("/contractor-login");
    if (!["company_admin", "admin"].includes(s.role)) return html(page("Access denied", `<div class="err">Company Administrator authority is required to invite users.</div>`), 403);
    const f = await request.formData();
    const fullName = txt(f.get("fullName"), 120);
    const email = lower(f.get("email"));
    const roleRaw = lower(f.get("role"));
    const allowed = ["engineer", "mechanic", "supervisor", "manager", "company_admin"];
    const role = allowed.includes(roleRaw) ? roleRaw : "mechanic";
    if (!fullName || !email.includes("@")) return redirect(`/contractor?view=users&tone=err&msg=${encodeURIComponent("Enter a valid full name and email address.")}`);
    if (!env.RESEND_API_KEY) return redirect(`/contractor?view=users&tone=err&msg=${encodeURIComponent("Invitation email is not configured yet. Add RESEND_API_KEY in Cloudflare.")}`);
    const existing = await env.DB.prepare("SELECT id FROM contractor_accounts WHERE lower(email)=? LIMIT 1").bind(email).first();
    if (existing) return redirect(`/contractor?view=users&tone=err&msg=${encodeURIComponent("That email already has a user account.")}`);

    const token = `${crypto.randomUUID()}${crypto.randomUUID().replace(/-/g, "")}`;
    const tokenHash = await sha256(token);
    const now = new Date();
    const expires = new Date(now.getTime() + 48 * 60 * 60 * 1000);
    await env.DB.prepare("UPDATE user_invitations_v3 SET status='superseded' WHERE company_id=? AND lower(email)=? AND status='pending'").bind(s.companyId, email).run();
    const inserted = await env.DB.prepare("INSERT INTO user_invitations_v3(company_id,email,full_name,role,token_hash,status,created_by,created_at,expires_at) VALUES(?,?,?,?,?,'pending',?,?,?)").bind(s.companyId, email, fullName, role, tokenHash, s.accountId, now.toISOString(), expires.toISOString()).run();
    const inviteId = Number(inserted.meta?.last_row_id || 0);
    const link = `${url.origin}/accept-invite?token=${encodeURIComponent(token)}`;
    try {
      const providerId = await sendInviteEmail(env, { to: email, name: fullName, company: s.companyName, role, link, inviter: s.fullName });
      if (inviteId) await env.DB.prepare("UPDATE user_invitations_v3 SET provider_message_id=? WHERE id=? AND company_id=?").bind(providerId, inviteId, s.companyId).run();
    } catch (error) {
      if (inviteId) await env.DB.prepare("UPDATE user_invitations_v3 SET status='send_failed' WHERE id=? AND company_id=?").bind(inviteId, s.companyId).run();
      return redirect(`/contractor?view=users&tone=err&msg=${encodeURIComponent(`Invitation email failed: ${error instanceof Error ? error.message : "Unknown email error"}`)}`);
    }
    return redirect(`/contractor?view=users&msg=${encodeURIComponent(`Invitation sent to ${email}. The link expires in 48 hours.`)}`);
  }

  if (path === "/accept-invite" && request.method === "GET") {
    const token = txt(url.searchParams.get("token"), 200);
    if (!token) return html(page("Invalid invitation", `<div class="err">This invitation link is invalid.</div>`), 400);
    const tokenHash = await sha256(token);
    const row = await env.DB.prepare(`SELECT i.id,i.company_id AS companyId,i.email,i.full_name AS fullName,i.role,i.status,i.expires_at AS expiresAt,c.name AS companyName FROM user_invitations_v3 i JOIN companies c ON c.id=i.company_id WHERE i.token_hash=? LIMIT 1`).bind(tokenHash).first<Record<string, unknown>>();
    if (!row || String(row.status) !== "pending" || new Date(String(row.expiresAt)).getTime() < Date.now()) {
      return html(page("Invitation unavailable", `<div class="err">This invitation is invalid, expired, or has already been used.</div><a class="link" href="/contractor-login">Go to login</a>`), 410);
    }
    return html(page("Accept invitation", `<h1>Welcome, ${esc(row.fullName)}</h1><p>You have been invited to join <strong>${esc(row.companyName)}</strong>.</p><div class="meta"><b>Role:</b> ${esc(roleName(String(row.role)))}<br><b>Email:</b> ${esc(row.email)}</div><p>Create your own password to activate your account.</p><form method="post" action="/accept-invite"><input type="hidden" name="token" value="${esc(token)}"><label class="field">Create password<input type="password" name="password" minlength="10" required autocomplete="new-password"></label><label class="field">Confirm password<input type="password" name="confirmPassword" minlength="10" required autocomplete="new-password"></label><button class="btn" type="submit">Activate my account</button></form>`));
  }

  if (path === "/accept-invite" && request.method === "POST") {
    const f = await request.formData();
    const token = txt(f.get("token"), 200);
    const password = String(f.get("password") || "");
    const confirm = String(f.get("confirmPassword") || "");
    if (!token || password.length < 10 || password !== confirm) {
      return html(page("Set password", `<div class="err">Passwords must match and contain at least 10 characters.</div><a class="link" href="${token ? `/accept-invite?token=${encodeURIComponent(token)}` : "/contractor-login"}">Try again</a>`), 400);
    }
    const tokenHash = await sha256(token);
    const row = await env.DB.prepare(`SELECT id,company_id AS companyId,email,full_name AS fullName,role,status,expires_at AS expiresAt FROM user_invitations_v3 WHERE token_hash=? LIMIT 1`).bind(tokenHash).first<Record<string, unknown>>();
    if (!row || String(row.status) !== "pending" || new Date(String(row.expiresAt)).getTime() < Date.now()) {
      return html(page("Invitation unavailable", `<div class="err">This invitation is invalid, expired, or has already been used.</div><a class="link" href="/contractor-login">Go to login</a>`), 410);
    }
    const email = lower(row.email);
    const existing = await env.DB.prepare("SELECT id FROM contractor_accounts WHERE lower(email)=? LIMIT 1").bind(email).first();
    if (existing) {
      await env.DB.prepare("UPDATE user_invitations_v3 SET status='accepted',accepted_at=? WHERE id=?").bind(new Date().toISOString(), Number(row.id)).run();
      return html(page("Account already active", `<div class="ok">Your account is already active.</div><a class="link" href="/contractor-login">Sign in to TMM Asset Health</a>`));
    }
    const salt = bytesToHex(crypto.getRandomValues(new Uint8Array(16)));
    const hash = await passwordHash(password, salt);
    const now = new Date().toISOString();
    await env.DB.prepare("INSERT INTO contractor_accounts(company_id,email,full_name,role,status,password_hash,password_salt,created_at,updated_at) VALUES(?,?,?,?,?,?,?,?,?)").bind(Number(row.companyId), email, txt(row.fullName,120), txt(row.role,40), "active", hash, salt, now, now).run();
    await env.DB.prepare("UPDATE user_invitations_v3 SET status='accepted',accepted_at=? WHERE id=? AND status='pending'").bind(now, Number(row.id)).run();
    return html(page("Account activated", `<div class="ok"><strong>Your TMM Asset Health account is ready.</strong><br>You can now sign in using ${esc(email)} and the password you just created.</div><a class="link" href="/contractor-login">Continue to login →</a>`));
  }

  return null;
}
