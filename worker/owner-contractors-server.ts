export interface OwnerContractorEnv {
  DB: D1Database;
  ADMIN_PASSWORD?: string;
}

const enc = new TextEncoder();

function page(title: string, body: string, status = 200) {
  return new Response(`<!doctype html><html><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>${escapeHtml(title)}</title><style>
  *{box-sizing:border-box}body{margin:0;background:#f4f7fb;font-family:Arial,sans-serif;color:#14213d;padding:28px}.card{max-width:760px;margin:auto;background:#fff;border:1px solid #dce5ef;border-radius:16px;padding:25px}.grid{display:grid;grid-template-columns:1fr 1fr;gap:14px}.field{display:grid;gap:6px;font-size:12px;font-weight:800}.field input,.field select{padding:12px;border:1px solid #cbd5e1;border-radius:8px;font-size:14px}.wide{grid-column:1/-1}.btn{display:inline-block;border:0;background:#1267b3;color:#fff;padding:13px 18px;border-radius:9px;font-weight:900;margin-top:18px;cursor:pointer;text-decoration:none}.hint{font-size:11px;color:#64748b;margin-top:5px}.result{margin-top:18px;padding:15px;border-radius:10px;white-space:pre-wrap;line-height:1.55}.ok{background:#e8f7ee;color:#17633a;border:1px solid #b8e2c8}.err{background:#fff0f0;color:#a11b1b;border:1px solid #efc5c5}.details{display:grid;gap:8px;margin-top:14px}.details div{background:#f8fafc;padding:10px;border-radius:8px}.details b{display:block;font-size:11px;color:#64748b;margin-bottom:3px}@media(max-width:650px){.grid{grid-template-columns:1fr}.wide{grid-column:auto}}
  </style></head><body><div class="card">${body}</div></body></html>`, { status, headers: { "content-type": "text/html; charset=utf-8", "cache-control": "no-store", "x-frame-options": "DENY", "referrer-policy": "same-origin", "content-security-policy": "default-src 'self'; style-src 'self' 'unsafe-inline'; frame-ancestors 'none'; base-uri 'self'" } });
}

function escapeHtml(v: unknown) {
  return String(v ?? "").replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c] || c));
}

function text(v: unknown, max = 240) { return String(v ?? "").trim().slice(0, max); }
function email(v: unknown) { return text(v, 200).toLowerCase(); }
function bytesToHex(bytes: Uint8Array) { return Array.from(bytes, b => b.toString(16).padStart(2, "0")).join(""); }
function hexToBytes(value: string) { const out = new Uint8Array(value.length / 2); for (let i = 0; i < out.length; i++) out[i] = parseInt(value.slice(i * 2, i * 2 + 2), 16); return out; }
function b64url(bytes: Uint8Array) { let s = ""; bytes.forEach(b => s += String.fromCharCode(b)); return btoa(s).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/g, ""); }

async function sha256(value: string) { return bytesToHex(new Uint8Array(await crypto.subtle.digest("SHA-256", enc.encode(value)))); }
async function secureEqual(a: string, b: string) { const [x,y] = await Promise.all([sha256(a),sha256(b)]); let d=x.length^y.length; for(let i=0;i<Math.min(x.length,y.length);i++) d|=x.charCodeAt(i)^y.charCodeAt(i); return d===0; }
async function passwordHash(password: string, saltHex: string) { const key=await crypto.subtle.importKey("raw",enc.encode(password),"PBKDF2",false,["deriveBits"]); const bits=await crypto.subtle.deriveBits({name:"PBKDF2",hash:"SHA-256",salt:hexToBytes(saltHex),iterations:150000},key,256); return bytesToHex(new Uint8Array(bits)); }

async function ensureTables(env: OwnerContractorEnv) {
  const statements = [
    `CREATE TABLE IF NOT EXISTS companies (id INTEGER PRIMARY KEY AUTOINCREMENT,name TEXT NOT NULL,licence_key TEXT NOT NULL UNIQUE,licence_status TEXT NOT NULL DEFAULT 'trial',expires_at TEXT NOT NULL,grace_days INTEGER NOT NULL DEFAULT 7,max_users INTEGER NOT NULL DEFAULT 10,created_at TEXT NOT NULL)`,
    `CREATE TABLE IF NOT EXISTS contractor_accounts (id INTEGER PRIMARY KEY AUTOINCREMENT,company_id INTEGER NOT NULL,email TEXT NOT NULL UNIQUE,full_name TEXT NOT NULL,role TEXT NOT NULL DEFAULT 'company_admin',status TEXT NOT NULL DEFAULT 'active',password_hash TEXT NOT NULL,password_salt TEXT NOT NULL,created_at TEXT NOT NULL,updated_at TEXT NOT NULL)`
  ];
  for (const s of statements) await env.DB.prepare(s).run();
}

export function ownerContractorsFormPage() {
  return page("Create Contractor", `<h1>Create real contractor account</h1><p>This creates an isolated company licence and contractor administrator.</p>
  <form method="post" action="/owner/contractors/create" class="grid">
    <label class="field wide">Sindane owner password<input name="ownerPassword" type="password" required autocomplete="current-password"><span class="hint">Use the same ADMIN_PASSWORD configured in Cloudflare.</span></label>
    <label class="field wide">Company name<input name="companyName" required maxlength="120"></label>
    <label class="field">Administrator full name<input name="fullName" required maxlength="120"></label>
    <label class="field">Administrator email<input name="email" type="email" required maxlength="200"></label>
    <label class="field">Contractor password<input name="password" type="password" minlength="10" required><span class="hint">Minimum 10 characters.</span></label>
    <label class="field">Licence days<input name="licenceDays" type="number" min="1" max="3650" value="30" required></label>
    <label class="field">Role<select name="role"><option value="company_admin">Company Admin</option><option value="engineer">Engineer</option><option value="manager">Manager</option></select></label>
    <div class="wide"><button class="btn" type="submit">Create contractor</button><div class="result">This version submits directly to the Cloudflare Worker. No browser JavaScript is required.</div></div>
  </form>`);
}

export async function createOwnerContractorFromForm(request: Request, env: OwnerContractorEnv) {
  try {
    await ensureTables(env);
    const form = await request.formData();
    const ownerPassword = String(form.get("ownerPassword") || "");
    const configured = String(env.ADMIN_PASSWORD || "");
    if (!configured) return page("Setup required", `<h1>Cannot create contractor</h1><div class="result err">ADMIN_PASSWORD is not configured in Cloudflare.</div><a class="btn" href="/owner/contractors">Back</a>`, 503);
    if (!ownerPassword || !(await secureEqual(ownerPassword, configured))) return page("Authentication failed", `<h1>Contractor not created</h1><div class="result err"><b>Owner password is incorrect.</b><br>Use the exact ADMIN_PASSWORD configured in the Cloudflare Worker secret.</div><a class="btn" href="/owner/contractors">Try again</a>`, 401);

    const companyName = text(form.get("companyName"),120), fullName = text(form.get("fullName"),120), userEmail = email(form.get("email")), password = String(form.get("password") || ""), role = text(form.get("role") || "company_admin",40);
    if (!companyName || !fullName || !userEmail) return page("Missing information", `<h1>Contractor not created</h1><div class="result err">Company name, administrator name and email are required.</div><a class="btn" href="/owner/contractors">Back</a>`,400);
    if (!userEmail.includes("@")) return page("Invalid email", `<h1>Contractor not created</h1><div class="result err">Enter a valid administrator email address.</div><a class="btn" href="/owner/contractors">Back</a>`,400);
    if (password.length < 10) return page("Password too short", `<h1>Contractor not created</h1><div class="result err">Contractor password must contain at least 10 characters.</div><a class="btn" href="/owner/contractors">Back</a>`,400);

    const existing = await env.DB.prepare("SELECT id FROM contractor_accounts WHERE lower(email)=? LIMIT 1").bind(userEmail).first();
    if (existing) return page("Email already used", `<h1>Contractor not created</h1><div class="result err">The administrator email <b>${escapeHtml(userEmail)}</b> is already linked to a contractor account.</div><a class="btn" href="/owner/contractors">Back</a><a class="btn" href="/contractor-login">Go to contractor login</a>`,409);

    const days = Math.max(1,Math.min(3650,Number(form.get("licenceDays") || 30))), now = new Date(), expiresAt = new Date(Date.now()+days*86400000).toISOString(), licenceKey = "SAS-" + b64url(crypto.getRandomValues(new Uint8Array(12))).toUpperCase();
    await env.DB.prepare("INSERT INTO companies(name,licence_key,licence_status,expires_at,grace_days,max_users,created_at) VALUES(?,?,?,?,?,?,?)").bind(companyName,licenceKey,"active",expiresAt,7,10,now.toISOString()).run();
    const company = await env.DB.prepare("SELECT id FROM companies WHERE licence_key=? LIMIT 1").bind(licenceKey).first<{id:number}>();
    if (!company) throw new Error("Company row could not be retrieved after creation.");
    const salt=bytesToHex(crypto.getRandomValues(new Uint8Array(16))), hash=await passwordHash(password,salt);
    await env.DB.prepare("INSERT INTO contractor_accounts(company_id,email,full_name,role,status,password_hash,password_salt,created_at,updated_at) VALUES(?,?,?,?,?,?,?,?,?)").bind(company.id,userEmail,fullName,role,"active",hash,salt,now.toISOString(),now.toISOString()).run();

    return page("Contractor created", `<h1>Created successfully ✅</h1><div class="result ok">The contractor company and administrator login are now active.</div><div class="details"><div><b>Company</b>${escapeHtml(companyName)}</div><div><b>Administrator</b>${escapeHtml(fullName)}</div><div><b>Login email</b>${escapeHtml(userEmail)}</div><div><b>Licence key</b>${escapeHtml(licenceKey)}</div><div><b>Licence expires</b>${escapeHtml(expiresAt)}</div></div><a class="btn" href="/contractor-login">Test contractor login</a><a class="btn" href="/owner/contractors">Create another contractor</a>`,201);
  } catch (error) {
    console.error("OWNER_CONTRACTOR_CREATE_ERROR", error);
    return page("Creation error", `<h1>Contractor not created</h1><div class="result err">Server/database error: ${escapeHtml(error instanceof Error ? error.message : String(error))}</div><a class="btn" href="/owner/contractors">Back</a>`,500);
  }
}
