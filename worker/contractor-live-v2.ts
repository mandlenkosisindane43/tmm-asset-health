export interface ContractorEnvV2 {
  DB: D1Database;
  BUCKET?: R2Bucket;
  ADMIN_PASSWORD?: string;
}

type Session = {
  companyId: number;
  accountId: number;
  email: string;
  fullName: string;
  role: string;
  companyName: string;
  licenceStatus: string;
  licenceExpiresAt: string;
};

const COOKIE = "sas_contractor_v2";
const encoder = new TextEncoder();
let ready: Promise<void> | null = null;

function json(data: unknown, status = 200, headers: Record<string, string> = {}) {
  return new Response(JSON.stringify(data), {
    status,
    headers: { "content-type": "application/json; charset=utf-8", "cache-control": "no-store", ...headers },
  });
}

function html(body: string, status = 200) {
  return new Response(body, {
    status,
    headers: {
      "content-type": "text/html; charset=utf-8",
      "cache-control": "no-store",
      "x-frame-options": "DENY",
      "referrer-policy": "same-origin",
      "content-security-policy": "default-src 'self'; style-src 'self' 'unsafe-inline'; script-src 'self' 'unsafe-inline'; connect-src 'self'; img-src 'self' data:; frame-ancestors 'none'; base-uri 'self'",
    },
  });
}

function text(value: unknown, max = 240) { return String(value ?? "").trim().slice(0, max); }
function email(value: unknown) { return text(value, 200).toLowerCase(); }
function bytesToHex(bytes: Uint8Array) { return Array.from(bytes, b => b.toString(16).padStart(2, "0")).join(""); }
function hexToBytes(value: string) { const out = new Uint8Array(value.length / 2); for (let i = 0; i < out.length; i++) out[i] = parseInt(value.slice(i * 2, i * 2 + 2), 16); return out; }
function b64url(bytes: Uint8Array) { let s = ""; bytes.forEach(b => s += String.fromCharCode(b)); return btoa(s).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/g, ""); }

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
  const bits = await crypto.subtle.deriveBits({ name: "PBKDF2", hash: "SHA-256", salt: hexToBytes(saltHex), iterations: 150000 }, key, 256);
  return bytesToHex(new Uint8Array(bits));
}

function getCookie(request: Request) {
  const raw = request.headers.get("cookie") || "";
  for (const part of raw.split(";")) {
    const i = part.indexOf("=");
    if (i < 0) continue;
    if (part.slice(0, i).trim() === COOKIE) return part.slice(i + 1).trim();
  }
  return "";
}

async function ensureSchema(env: ContractorEnvV2) {
  if (ready) return ready;
  ready = (async () => {
    const statements = [
      `CREATE TABLE IF NOT EXISTS companies (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        name TEXT NOT NULL,
        licence_key TEXT NOT NULL UNIQUE,
        licence_status TEXT NOT NULL DEFAULT 'trial',
        expires_at TEXT NOT NULL,
        grace_days INTEGER NOT NULL DEFAULT 7,
        max_users INTEGER NOT NULL DEFAULT 10,
        created_at TEXT NOT NULL
      )`,
      `CREATE TABLE IF NOT EXISTS contractor_accounts (
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
      )`,
      `CREATE TABLE IF NOT EXISTS contractor_sessions (
        token_hash TEXT PRIMARY KEY,
        company_id INTEGER NOT NULL,
        account_id INTEGER NOT NULL,
        expires_at TEXT NOT NULL,
        created_at TEXT NOT NULL
      )`,
      `CREATE TABLE IF NOT EXISTS contractor_documents (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        company_id INTEGER NOT NULL,
        uploaded_by INTEGER NOT NULL,
        file_name TEXT NOT NULL,
        object_key TEXT NOT NULL UNIQUE,
        content_type TEXT,
        size_bytes INTEGER NOT NULL DEFAULT 0,
        category TEXT NOT NULL DEFAULT 'general',
        created_at TEXT NOT NULL
      )`,
      `CREATE TABLE IF NOT EXISTS machines (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        company_id INTEGER NOT NULL,
        fleet_number TEXT NOT NULL,
        category TEXT NOT NULL,
        site TEXT NOT NULL,
        status TEXT NOT NULL DEFAULT 'operating',
        operating_hours REAL NOT NULL DEFAULT 0,
        availability_target REAL NOT NULL DEFAULT 0.9,
        next_service_hours REAL,
        created_at TEXT NOT NULL
      )`,
      `CREATE TABLE IF NOT EXISTS events (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        company_id INTEGER NOT NULL,
        fleet_number TEXT NOT NULL,
        event_type TEXT NOT NULL,
        severity TEXT NOT NULL,
        system_name TEXT NOT NULL,
        component TEXT NOT NULL,
        description TEXT NOT NULL,
        opened_at TEXT NOT NULL,
        closed_at TEXT,
        downtime_hours REAL NOT NULL DEFAULT 0,
        status TEXT NOT NULL DEFAULT 'open',
        action TEXT,
        spares_status TEXT,
        expected_return TEXT,
        oil_litres_lost REAL NOT NULL DEFAULT 0,
        created_at TEXT NOT NULL
      )`,
      `CREATE TABLE IF NOT EXISTS work_orders (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        company_id INTEGER NOT NULL,
        fleet_number TEXT NOT NULL,
        title TEXT NOT NULL,
        priority TEXT NOT NULL,
        assigned_to TEXT,
        due_at TEXT,
        status TEXT NOT NULL DEFAULT 'open',
        created_at TEXT NOT NULL
      )`,
      `CREATE TABLE IF NOT EXISTS production_records (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        company_id INTEGER NOT NULL,
        report_date TEXT NOT NULL,
        fleet_number TEXT NOT NULL,
        shift_hours REAL NOT NULL DEFAULT 24,
        planned_downtime REAL NOT NULL DEFAULT 0,
        unplanned_downtime REAL NOT NULL DEFAULT 0,
        operating_hours REAL NOT NULL DEFAULT 0,
        productive_hours REAL NOT NULL DEFAULT 0,
        tonnes REAL NOT NULL DEFAULT 0,
        source_file TEXT,
        created_at TEXT NOT NULL
      )`,
    ];
    for (const statement of statements) await env.DB.prepare(statement).run();
  })().catch(error => { ready = null; throw error; });
  return ready;
}

function licenceValid(status: string, expiresAt: string, graceDays: number) {
  if (!["active", "trial"].includes(status.toLowerCase())) return false;
  const end = new Date(expiresAt).getTime() + Math.max(0, graceDays) * 86400000;
  return Number.isFinite(end) && Date.now() <= end;
}

async function currentSession(request: Request, env: ContractorEnvV2): Promise<Session | null> {
  const token = getCookie(request);
  if (!token) return null;
  const tokenHash = await sha256(token);
  const row = await env.DB.prepare(`SELECT s.company_id AS companyId,s.account_id AS accountId,s.expires_at AS sessionExpires,
    a.email,a.full_name AS fullName,a.role,a.status AS accountStatus,
    c.name AS companyName,c.licence_status AS licenceStatus,c.expires_at AS licenceExpires,c.grace_days AS graceDays
    FROM contractor_sessions s
    JOIN contractor_accounts a ON a.id=s.account_id AND a.company_id=s.company_id
    JOIN companies c ON c.id=s.company_id
    WHERE s.token_hash=? LIMIT 1`).bind(tokenHash).first<Record<string, unknown>>();
  if (!row) return null;
  if (String(row.accountStatus) !== "active" || new Date(String(row.sessionExpires)).getTime() < Date.now()) return null;
  if (!licenceValid(String(row.licenceStatus), String(row.licenceExpires), Number(row.graceDays || 0))) return null;
  return {
    companyId: Number(row.companyId), accountId: Number(row.accountId), email: String(row.email), fullName: String(row.fullName),
    role: String(row.role), companyName: String(row.companyName), licenceStatus: String(row.licenceStatus), licenceExpiresAt: String(row.licenceExpires),
  };
}

async function ownerAuthorized(request: Request, env: ContractorEnvV2) {
  const expected = String(env.ADMIN_PASSWORD || "");
  if (!expected) return false;
  const auth = request.headers.get("authorization") || "";
  const supplied = auth.startsWith("Bearer ") ? auth.slice(7) : String(request.headers.get("x-admin-password") || "");
  return supplied ? secureEqual(supplied, expected) : false;
}

async function login(request: Request, env: ContractorEnvV2) {
  const body = await request.json().catch(() => ({})) as Record<string, unknown>;
  const userEmail = email(body.email), password = String(body.password || "");
  if (!userEmail || !password) return json({ error: "Email and password are required." }, 400);
  const row = await env.DB.prepare(`SELECT a.id AS accountId,a.company_id AS companyId,a.full_name AS fullName,a.role,a.status AS accountStatus,a.password_hash AS passwordHash,a.password_salt AS passwordSalt,
    c.name AS companyName,c.licence_status AS licenceStatus,c.expires_at AS licenceExpires,c.grace_days AS graceDays
    FROM contractor_accounts a JOIN companies c ON c.id=a.company_id WHERE lower(a.email)=? LIMIT 1`).bind(userEmail).first<Record<string, unknown>>();
  if (!row || String(row.accountStatus) !== "active") return json({ error: "Invalid email or password." }, 401);
  const calculated = await passwordHash(password, String(row.passwordSalt));
  if (!(await secureEqual(calculated, String(row.passwordHash)))) return json({ error: "Invalid email or password." }, 401);
  if (!licenceValid(String(row.licenceStatus), String(row.licenceExpires), Number(row.graceDays || 0))) return json({ error: "Company licence is inactive or expired." }, 403);
  const token = b64url(crypto.getRandomValues(new Uint8Array(32)));
  const tokenHash = await sha256(token);
  const now = new Date(), expires = new Date(Date.now() + 12 * 3600000);
  await env.DB.prepare("DELETE FROM contractor_sessions WHERE expires_at<?").bind(now.toISOString()).run();
  await env.DB.prepare("INSERT INTO contractor_sessions(token_hash,company_id,account_id,expires_at,created_at) VALUES(?,?,?,?,?)")
    .bind(tokenHash, Number(row.companyId), Number(row.accountId), expires.toISOString(), now.toISOString()).run();
  return json({ ok: true }, 200, { "set-cookie": `${COOKIE}=${token}; Path=/; HttpOnly; Secure; SameSite=Lax; Max-Age=43200` });
}

async function logout(request: Request, env: ContractorEnvV2) {
  const token = getCookie(request);
  if (token) await env.DB.prepare("DELETE FROM contractor_sessions WHERE token_hash=?").bind(await sha256(token)).run();
  return json({ ok: true }, 200, { "set-cookie": `${COOKIE}=; Path=/; HttpOnly; Secure; SameSite=Lax; Max-Age=0` });
}

async function createContractor(request: Request, env: ContractorEnvV2) {
  if (!(await ownerAuthorized(request, env))) return json({ error: env.ADMIN_PASSWORD ? "Administrator authentication failed." : "ADMIN_PASSWORD is not configured in Cloudflare." }, env.ADMIN_PASSWORD ? 401 : 503);
  const b = await request.json().catch(() => ({})) as Record<string, unknown>;
  const companyName = text(b.companyName, 120), fullName = text(b.fullName, 120), userEmail = email(b.email), password = String(b.password || "");
  if (!companyName || !fullName || !userEmail) return json({ error: "Company, administrator name and email are required." }, 400);
  if (password.length < 10) return json({ error: "Use a contractor password with at least 10 characters." }, 400);
  const exists = await env.DB.prepare("SELECT id FROM contractor_accounts WHERE lower(email)=? LIMIT 1").bind(userEmail).first();
  if (exists) return json({ error: "This email is already linked to a contractor account." }, 409);
  const now = new Date(), days = Math.max(1, Math.min(3650, Number(b.licenceDays || 30))), expiresAt = new Date(Date.now() + days * 86400000).toISOString();
  const licenceKey = `SAS-${b64url(crypto.getRandomValues(new Uint8Array(12))).toUpperCase()}`;
  await env.DB.prepare("INSERT INTO companies(name,licence_key,licence_status,expires_at,grace_days,max_users,created_at) VALUES(?,?,?,?,?,?,?)")
    .bind(companyName, licenceKey, "active", expiresAt, 7, 10, now.toISOString()).run();
  const company = await env.DB.prepare("SELECT id FROM companies WHERE licence_key=? LIMIT 1").bind(licenceKey).first<{ id: number }>();
  if (!company) return json({ error: "Company creation failed." }, 500);
  const salt = bytesToHex(crypto.getRandomValues(new Uint8Array(16))), hash = await passwordHash(password, salt);
  await env.DB.prepare("INSERT INTO contractor_accounts(company_id,email,full_name,role,status,password_hash,password_salt,created_at,updated_at) VALUES(?,?,?,?,?,?,?,?,?)")
    .bind(company.id, userEmail, fullName, text(b.role || "company_admin", 40), "active", hash, salt, now.toISOString(), now.toISOString()).run();
  return json({ ok: true, companyId: company.id, companyName, email: userEmail, licenceKey, expiresAt }, 201);
}

async function api(request: Request, env: ContractorEnvV2, s: Session, path: string): Promise<Response | null> {
  const method = request.method.toUpperCase(), cid = s.companyId;
  if (path === "/api/contractor/me" && method === "GET") return json({ user: { email: s.email, fullName: s.fullName, role: s.role }, company: { id: cid, name: s.companyName, licenceStatus: s.licenceStatus, expiresAt: s.licenceExpiresAt } });

  if (path === "/api/contractor/dashboard" && method === "GET") {
    const fleet = (await env.DB.prepare("SELECT id,fleet_number AS fleetNumber,category,site,status,operating_hours AS operatingHours,next_service_hours AS nextServiceHours FROM machines WHERE company_id=? ORDER BY fleet_number LIMIT 1000").bind(cid).all<Record<string, unknown>>()).results;
    const breakdowns = (await env.DB.prepare("SELECT id,fleet_number AS fleetNumber,severity,description,opened_at AS openedAt,downtime_hours AS downtimeHours,status FROM events WHERE company_id=? AND status!='closed' ORDER BY id DESC LIMIT 100").bind(cid).all<Record<string, unknown>>()).results;
    const work = (await env.DB.prepare("SELECT id FROM work_orders WHERE company_id=? AND status NOT IN ('closed','completed') LIMIT 1000").bind(cid).all()).results;
    const prod = (await env.DB.prepare("SELECT report_date AS reportDate,tonnes FROM production_records WHERE company_id=? ORDER BY report_date DESC,id DESC LIMIT 500").bind(cid).all<Record<string, unknown>>()).results;
    const operating = fleet.filter(m => ["operating","running","available"].includes(String(m.status || "").toLowerCase())).length;
    const latestDate = prod.length ? String(prod[0].reportDate) : "";
    const tonnes = latestDate ? prod.filter(r => String(r.reportDate) === latestDate).reduce((sum, r) => sum + Number(r.tonnes || 0), 0) : 0;
    return json({ metrics: { fleetTotal: fleet.length, operating, availability: fleet.length ? operating / fleet.length * 100 : 0, openBreakdowns: breakdowns.length, openWorkOrders: work.length, production: tonnes, productionDate: latestDate }, fleet, breakdowns });
  }

  if (path === "/api/contractor/fleet") {
    if (method === "GET") return json({ machines: (await env.DB.prepare("SELECT id,fleet_number AS fleetNumber,category,site,status,operating_hours AS operatingHours,next_service_hours AS nextServiceHours FROM machines WHERE company_id=? ORDER BY fleet_number LIMIT 1000").bind(cid).all()).results });
    if (method === "POST") {
      const b = await request.json().catch(() => ({})) as Record<string, unknown>, fleet = text(b.fleetNumber, 60), category = text(b.category, 100);
      if (!fleet || !category) return json({ error: "Fleet number and machine type are required." }, 400);
      await env.DB.prepare("INSERT INTO machines(company_id,fleet_number,category,site,status,operating_hours,availability_target,next_service_hours,created_at) VALUES(?,?,?,?,?,?,?,?,?)")
        .bind(cid, fleet, category, text(b.site || "Unassigned", 100), text(b.status || "operating", 30), Number(b.operatingHours || 0), 0.9, b.nextServiceHours === "" || b.nextServiceHours == null ? null : Number(b.nextServiceHours), new Date().toISOString()).run();
      return json({ ok: true }, 201);
    }
  }

  if (path === "/api/contractor/breakdowns") {
    if (method === "GET") return json({ events: (await env.DB.prepare("SELECT id,fleet_number AS fleetNumber,severity,system_name AS system,component,description,opened_at AS openedAt,downtime_hours AS downtimeHours,status,action FROM events WHERE company_id=? ORDER BY id DESC LIMIT 500").bind(cid).all()).results });
    if (method === "POST") {
      const b = await request.json().catch(() => ({})) as Record<string, unknown>, fleet = text(b.fleetNumber, 60), description = text(b.description, 500), now = new Date().toISOString();
      if (!fleet || !description) return json({ error: "Machine and fault description are required." }, 400);
      await env.DB.prepare("INSERT INTO events(company_id,fleet_number,event_type,severity,system_name,component,description,opened_at,downtime_hours,status,action,spares_status,oil_litres_lost,created_at) VALUES(?,?,?,?,?,?,?,?,?,?,?,?,?,?)")
        .bind(cid, fleet, "breakdown", text(b.severity || "medium", 30), text(b.system || "General", 80), text(b.component || "Not confirmed", 100), description, now, Number(b.downtimeHours || 0), "open", text(b.action || "Inspection required", 300), "Not assessed", Number(b.oilLitresLost || 0), now).run();
      return json({ ok: true }, 201);
    }
  }

  if (path === "/api/contractor/work-orders") {
    if (method === "GET") return json({ workOrders: (await env.DB.prepare("SELECT id,fleet_number AS fleetNumber,title,priority,assigned_to AS assignedTo,due_at AS dueAt,status FROM work_orders WHERE company_id=? ORDER BY id DESC LIMIT 500").bind(cid).all()).results });
    if (method === "POST") {
      const b = await request.json().catch(() => ({})) as Record<string, unknown>, fleet = text(b.fleetNumber, 60), title = text(b.title, 300);
      if (!fleet || !title) return json({ error: "Fleet number and work description are required." }, 400);
      await env.DB.prepare("INSERT INTO work_orders(company_id,fleet_number,title,priority,assigned_to,due_at,status,created_at) VALUES(?,?,?,?,?,?,?,?)")
        .bind(cid, fleet, title, text(b.priority || "medium", 30), text(b.assignedTo, 120), text(b.dueAt, 40), "open", new Date().toISOString()).run();
      return json({ ok: true }, 201);
    }
  }

  if (path === "/api/contractor/production") {
    if (method === "GET") return json({ records: (await env.DB.prepare("SELECT id,report_date AS reportDate,fleet_number AS fleetNumber,shift_hours AS shiftHours,unplanned_downtime AS unplannedDowntime,operating_hours AS operatingHours,tonnes FROM production_records WHERE company_id=? ORDER BY report_date DESC,id DESC LIMIT 500").bind(cid).all()).results });
    if (method === "POST") {
      const b = await request.json().catch(() => ({})) as Record<string, unknown>, now = new Date().toISOString();
      await env.DB.prepare("INSERT INTO production_records(company_id,report_date,fleet_number,shift_hours,planned_downtime,unplanned_downtime,operating_hours,productive_hours,tonnes,source_file,created_at) VALUES(?,?,?,?,?,?,?,?,?,?,?)")
        .bind(cid, text(b.reportDate || now.slice(0,10), 20), text(b.fleetNumber || "Plant", 60), Number(b.shiftHours || 24), 0, Number(b.unplannedDowntime || 0), Number(b.operatingHours || 0), Number(b.operatingHours || 0), Number(b.tonnes || 0), "contractor live capture", now).run();
      return json({ ok: true }, 201);
    }
  }

  if (path === "/api/contractor/documents") {
    if (method === "GET") return json({ documents: (await env.DB.prepare("SELECT id,file_name AS fileName,category,size_bytes AS sizeBytes,created_at AS createdAt FROM contractor_documents WHERE company_id=? ORDER BY id DESC LIMIT 300").bind(cid).all()).results });
    if (method === "POST") {
      if (!env.BUCKET) return json({ error: "R2 storage is not configured." }, 503);
      const form = await request.formData(), file = form.get("file");
      if (!(file instanceof File) || !file.size) return json({ error: "Choose a file." }, 400);
      if (file.size > 15_000_000) return json({ error: "File must be 15 MB or smaller." }, 400);
      const allowed = new Set(["application/pdf","image/png","image/jpeg","application/vnd.openxmlformats-officedocument.wordprocessingml.document","application/vnd.openxmlformats-officedocument.spreadsheetml.sheet","application/vnd.ms-excel","text/csv","application/csv","text/plain"]);
      if (file.type && !allowed.has(file.type)) return json({ error: "Upload PDF, Word, Excel, CSV, TXT, PNG or JPG." }, 400);
      const safe = file.name.replace(/[^a-zA-Z0-9._-]/g, "-").slice(-140) || "document";
      const key = `companies/${cid}/documents/${crypto.randomUUID()}-${safe}`;
      await env.BUCKET.put(key, file.stream(), { httpMetadata: { contentType: file.type || "application/octet-stream" } });
      await env.DB.prepare("INSERT INTO contractor_documents(company_id,uploaded_by,file_name,object_key,content_type,size_bytes,category,created_at) VALUES(?,?,?,?,?,?,?,?)")
        .bind(cid, s.accountId, file.name.slice(0,240), key, file.type || "application/octet-stream", file.size, text(form.get("category") || "general",60), new Date().toISOString()).run();
      return json({ ok: true }, 201);
    }
  }

  const match = path.match(/^\/api\/contractor\/documents\/(\d+)\/download$/);
  if (match && method === "GET") {
    if (!env.BUCKET) return json({ error: "R2 storage is not configured." }, 503);
    const doc = await env.DB.prepare("SELECT object_key AS objectKey,file_name AS fileName,content_type AS contentType FROM contractor_documents WHERE id=? AND company_id=? LIMIT 1").bind(Number(match[1]), cid).first<Record<string,unknown>>();
    if (!doc) return json({ error: "Document not found." }, 404);
    const obj = await env.BUCKET.get(String(doc.objectKey));
    if (!obj) return json({ error: "Stored file not found." }, 404);
    return new Response(obj.body, { headers: { "content-type": String(doc.contentType || "application/octet-stream"), "content-disposition": `attachment; filename="${String(doc.fileName).replace(/["\r\n]/g,"-")}"`, "cache-control": "private, no-store" } });
  }
  return null;
}

function loginPage() {
  return `<!doctype html><html><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>Contractor Login</title><style>*{box-sizing:border-box}body{margin:0;min-height:100vh;display:grid;place-items:center;background:#08162b;font-family:Arial,sans-serif;padding:20px;color:#14213d}.box{width:min(430px,100%);background:#fff;padding:32px;border-radius:18px}.brand{font-weight:900;color:#0f3158}.brand small{display:block;color:#64748b;margin-top:4px}.tag{margin:20px 0 6px;color:#1267b3;font-size:11px;font-weight:900}.box h1{margin:0 0 8px}.box p{color:#64748b;font-size:13px;line-height:1.5}.field{display:grid;gap:7px;margin-top:15px;font-size:12px;font-weight:800}.field input{padding:13px;border:1px solid #cbd5e1;border-radius:9px;font-size:15px}.btn{width:100%;margin-top:20px;border:0;background:#1267b3;color:#fff;padding:13px;border-radius:9px;font-weight:900}.msg{min-height:20px;color:#b91c1c;font-size:12px;margin-top:12px}.demo{margin-top:18px;font-size:12px}.demo a{color:#1267b3;font-weight:800}</style></head><body><form class="box" id="login"><div class="brand">TMM Asset Health<small>Sindane Asset Solutions</small></div><div class="tag">CONTRACTOR SECURE ACCESS</div><h1>Sign in</h1><p>Each contractor account is isolated to its own company data.</p><label class="field">Email<input name="email" type="email" required></label><label class="field">Password<input name="password" type="password" required></label><button class="btn">Sign in securely</button><div id="msg" class="msg"></div><div class="demo"><a href="/contractor-demo">Open sample contractor demo</a></div></form><script>document.getElementById('login').addEventListener('submit',async function(e){e.preventDefault();var f=new FormData(e.currentTarget);var r=await fetch('/api/contractor/login',{method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify({email:f.get('email'),password:f.get('password')})});var j=await r.json().catch(function(){return {}});if(r.ok){location.href='/contractor';return}document.getElementById('msg').textContent=j.error||'Sign in failed.'});</script></body></html>`;
}

function ownerPage() {
  return `<!doctype html><html><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>Create Contractor</title><style>*{box-sizing:border-box}body{margin:0;background:#f4f7fb;font-family:Arial,sans-serif;color:#14213d;padding:28px}.card{max-width:760px;margin:auto;background:#fff;border:1px solid #dce5ef;border-radius:16px;padding:25px}.grid{display:grid;grid-template-columns:1fr 1fr;gap:14px}.field{display:grid;gap:6px;font-size:12px;font-weight:800}.field input,.field select{padding:12px;border:1px solid #cbd5e1;border-radius:8px}.wide{grid-column:1/-1}.btn{border:0;background:#1267b3;color:#fff;padding:13px 18px;border-radius:9px;font-weight:900;margin-top:18px}.msg{white-space:pre-wrap;margin-top:18px;padding:12px;background:#f8fafc;border-radius:8px;font-size:12px}@media(max-width:650px){.grid{grid-template-columns:1fr}.wide{grid-column:auto}}</style></head><body><div class="card"><h1>Create real contractor account</h1><p>This creates an isolated company licence and contractor administrator.</p><form id="f" class="grid"><label class="field wide">Sindane owner password<input name="ownerPassword" type="password" required></label><label class="field wide">Company name<input name="companyName" required></label><label class="field">Administrator full name<input name="fullName" required></label><label class="field">Administrator email<input name="email" type="email" required></label><label class="field">Contractor password<input name="password" type="password" minlength="10" required></label><label class="field">Licence days<input name="licenceDays" type="number" min="1" value="30" required></label><label class="field">Role<select name="role"><option value="company_admin">Company Admin</option><option value="engineer">Engineer</option><option value="manager">Manager</option></select></label><div class="wide"><button class="btn">Create contractor</button><div id="msg" class="msg">No company created yet.</div></div></form></div><script>document.getElementById('f').addEventListener('submit',async function(e){e.preventDefault();var f=new FormData(e.currentTarget);var p={companyName:f.get('companyName'),fullName:f.get('fullName'),email:f.get('email'),password:f.get('password'),licenceDays:Number(f.get('licenceDays')),role:f.get('role')};var r=await fetch('/api/admin/contractors',{method:'POST',headers:{'content-type':'application/json','x-admin-password':String(f.get('ownerPassword')||'')},body:JSON.stringify(p)});var j=await r.json().catch(function(){return {}});document.getElementById('msg').textContent=r.ok?('Created: '+j.companyName+'\nLogin: '+j.email+'\nLicence: '+j.licenceKey+'\nExpires: '+j.expiresAt):(j.error||'Creation failed.');});</script></body></html>`;
}

function appPage() {
  return `<!doctype html><html><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>Contractor Workspace</title><style>*{box-sizing:border-box}body{margin:0;background:#f4f7fb;color:#14213d;font-family:Arial,sans-serif}.app{min-height:100vh;display:grid;grid-template-columns:240px 1fr}.side{background:#0c1b33;color:#fff;padding:20px 14px}.brand{font-weight:900;padding:8px;border-bottom:1px solid #233650}.brand small{display:block;color:#8da4c6;margin-top:4px}.company{padding:13px;margin:16px 0;background:#112642;border:1px solid #29405f;border-radius:10px}.company b,.company small{display:block}.company small{color:#9bb0ca;margin-top:4px}.nav{display:grid;gap:4px}.nav button{border:0;background:transparent;color:#b6c6db;padding:11px;border-radius:8px;text-align:left;font-weight:800}.nav button.active,.nav button:hover{background:#19385e;color:#fff}.main{min-width:0}.top{background:#fff;border-bottom:1px solid #dde5ef;padding:18px 24px;display:flex;justify-content:space-between;align-items:center}.top h1{margin:0;font-size:22px}.top button{border:1px solid #cbd5e1;background:#fff;padding:8px 11px;border-radius:8px}.content{padding:22px}.metrics{display:grid;grid-template-columns:repeat(4,1fr);gap:12px}.metric,.panel{background:#fff;border:1px solid #dde5ef;border-radius:12px;padding:16px}.metric small{display:block;color:#6b7b91;font-weight:800}.metric b{display:block;font-size:25px;margin-top:8px}.panel{margin-top:14px}.panel h2{margin-top:0}.toolbar{display:flex;gap:8px;flex-wrap:wrap;margin-bottom:12px}.toolbar button{border:0;background:#1267b3;color:#fff;padding:9px 11px;border-radius:8px;font-weight:800}.tab{display:none}.tab.active{display:block}.table{overflow:auto}table{width:100%;border-collapse:collapse;font-size:12px}th{background:#f7f9fc;text-align:left;padding:10px}td{padding:11px 10px;border-top:1px solid #edf1f5}.msg{padding:10px;background:#edf6ff;border-radius:8px;margin-bottom:12px;font-size:12px}.empty{color:#7b8798}.cards{display:grid;grid-template-columns:repeat(3,1fr);gap:10px}.card{border:1px solid #dde5ef;border-radius:10px;padding:14px}.card a{color:#1267b3;font-weight:800}@media(max-width:900px){.app{grid-template-columns:1fr}.side{display:block}.nav{grid-template-columns:repeat(4,1fr)}.nav button{text-align:center;font-size:11px}.metrics{grid-template-columns:1fr 1fr}.cards{grid-template-columns:1fr}}</style></head><body><div class="app"><aside class="side"><div class="brand">TMM Asset Health<small>Sindane Asset Solutions</small></div><div class="company"><b id="company">Loading company...</b><small id="user"></small></div><div class="nav"><button class="active" data-tab="dashboard">Dashboard</button><button data-tab="fleet">Fleet</button><button data-tab="breakdowns">Breakdowns</button><button data-tab="work">Work orders</button><button data-tab="production">Production</button><button data-tab="documents">Documents</button><button data-tab="reports">Reports</button></div></aside><main class="main"><div class="top"><h1 id="title">Operations Dashboard</h1><button id="logout">Sign out</button></div><div class="content"><div id="notice" class="msg">Secure tenant workspace loading...</div><section id="dashboard" class="tab active"><div class="metrics"><div class="metric"><small>Availability</small><b id="availability">0%</b></div><div class="metric"><small>Units operating</small><b id="operating">0 / 0</b></div><div class="metric"><small>Open breakdowns</small><b id="openBreakdowns">0</b></div><div class="metric"><small>Production latest day</small><b id="productionToday">0 t</b></div></div><div class="panel"><h2>Fleet health</h2><div id="dashFleet"></div></div></section><section id="fleet" class="tab"><div class="panel"><h2>Fleet</h2><div class="toolbar"><button onclick="addFleet()">+ Add machine</button></div><div id="fleetTable"></div></div></section><section id="breakdowns" class="tab"><div class="panel"><h2>Breakdowns</h2><div class="toolbar"><button onclick="addBreakdown()">+ Report breakdown</button></div><div id="breakTable"></div></div></section><section id="work" class="tab"><div class="panel"><h2>Work orders</h2><div class="toolbar"><button onclick="addWork()">+ Add work order</button></div><div id="workTable"></div></div></section><section id="production" class="tab"><div class="panel"><h2>Production</h2><div class="toolbar"><button onclick="addProduction()">+ Capture production</button></div><div id="productionTable"></div></div></section><section id="documents" class="tab"><div class="panel"><h2>Documents</h2><form id="upload" class="toolbar"><input name="file" type="file" required><select name="category"><option>general</option><option>purchase-order</option><option>inspection</option><option>job-card</option><option>oem</option></select><button>Upload to private R2</button></form><div id="documentCards"></div></div></section><section id="reports" class="tab"><div class="panel"><h2>Reports</h2><p>Live report exports are the next module. Current data is already stored per contractor and ready for daily, weekly, monthly and Pareto reporting.</p></div></section></div></main></div><script>
var titles={dashboard:'Operations Dashboard',fleet:'Fleet',breakdowns:'Breakdowns',work:'Work orders',production:'Production',documents:'Documents',reports:'Reports'};
function esc(v){return String(v==null?'':v).replace(/[&<>"']/g,function(c){return {'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]})}
async function req(url,opt){var r=await fetch(url,opt);if(r.status===401){location.href='/contractor-login';throw new Error('Sign in required')}var j=await r.json().catch(function(){return {}});if(!r.ok)throw new Error(j.error||'Request failed');return j}
function notice(t){document.getElementById('notice').textContent=t}
function table(headers,rows){if(!rows.length)return '<p class="empty">No records yet.</p>';return '<div class="table"><table><thead><tr>'+headers.map(function(h){return '<th>'+esc(h)+'</th>'}).join('')+'</tr></thead><tbody>'+rows.map(function(r){return '<tr>'+r.map(function(c){return '<td>'+esc(c)+'</td>'}).join('')+'</tr>'}).join('')+'</tbody></table></div>'}
async function loadAll(){var me=await req('/api/contractor/me');document.getElementById('company').textContent=me.company.name;document.getElementById('user').textContent=me.user.fullName+' · '+me.user.role;var d=await req('/api/contractor/dashboard');document.getElementById('availability').textContent=Number(d.metrics.availability||0).toFixed(1)+'%';document.getElementById('operating').textContent=d.metrics.operating+' / '+d.metrics.fleetTotal;document.getElementById('openBreakdowns').textContent=d.metrics.openBreakdowns;document.getElementById('productionToday').textContent=Number(d.metrics.production||0).toLocaleString()+' t';document.getElementById('dashFleet').innerHTML=table(['Fleet','Machine','Site','Status'],d.fleet.map(function(x){return [x.fleetNumber,x.category,x.site,x.status]}));var f=await req('/api/contractor/fleet');document.getElementById('fleetTable').innerHTML=table(['Fleet','Machine','Site','Status','Hours','Service due'],f.machines.map(function(x){return [x.fleetNumber,x.category,x.site,x.status,x.operatingHours,x.nextServiceHours==null?'—':x.nextServiceHours]}));var b=await req('/api/contractor/breakdowns');document.getElementById('breakTable').innerHTML=table(['Fleet','Severity','Fault','Downtime','Status'],b.events.map(function(x){return [x.fleetNumber,x.severity,x.description,x.downtimeHours,x.status]}));var w=await req('/api/contractor/work-orders');document.getElementById('workTable').innerHTML=table(['Fleet','Work','Priority','Assigned','Status'],w.workOrders.map(function(x){return [x.fleetNumber,x.title,x.priority,x.assignedTo||'—',x.status]}));var p=await req('/api/contractor/production');document.getElementById('productionTable').innerHTML=table(['Date','Fleet','Shift h','Operating h','Downtime h','Tonnes'],p.records.map(function(x){return [x.reportDate,x.fleetNumber,x.shiftHours,x.operatingHours,x.unplannedDowntime,x.tonnes]}));var docs=await req('/api/contractor/documents');document.getElementById('documentCards').innerHTML=docs.documents.length?'<div class="cards">'+docs.documents.map(function(x){return '<div class="card"><b>'+esc(x.fileName)+'</b><p>'+esc(x.category)+' · '+Math.round(Number(x.sizeBytes||0)/1024)+' KB</p><a href="/api/contractor/documents/'+x.id+'/download">Download</a></div>'}).join('')+'</div>':'<p class="empty">No documents uploaded yet.</p>';notice('Live company data loaded securely.');}
async function post(url,data){await req(url,{method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify(data)});await loadAll()}
async function addFleet(){var fleet=prompt('Fleet number');if(!fleet)return;var category=prompt('Machine type');if(!category)return;var site=prompt('Site / section','Unassigned');await post('/api/contractor/fleet',{fleetNumber:fleet,category:category,site:site,status:'operating'})}
async function addBreakdown(){var fleet=prompt('Fleet number');if(!fleet)return;var description=prompt('Fault / breakdown description');if(!description)return;var severity=prompt('Severity: low, medium, high, critical','medium');await post('/api/contractor/breakdowns',{fleetNumber:fleet,description:description,severity:severity})}
async function addWork(){var fleet=prompt('Fleet number');if(!fleet)return;var title=prompt('Work to be done');if(!title)return;var assignedTo=prompt('Assigned to','Workshop Team');await post('/api/contractor/work-orders',{fleetNumber:fleet,title:title,assignedTo:assignedTo,priority:'medium'})}
async function addProduction(){var date=prompt('Date YYYY-MM-DD',new Date().toISOString().slice(0,10));if(!date)return;var fleet=prompt('Fleet / plant','Plant');var tonnes=Number(prompt('Tonnes produced','0')||0);var operatingHours=Number(prompt('Operating hours','0')||0);var downtime=Number(prompt('Unplanned downtime hours','0')||0);await post('/api/contractor/production',{reportDate:date,fleetNumber:fleet,tonnes:tonnes,operatingHours:operatingHours,unplannedDowntime:downtime})}
document.querySelectorAll('.nav button').forEach(function(b){b.addEventListener('click',function(){document.querySelectorAll('.nav button').forEach(function(x){x.classList.remove('active')});document.querySelectorAll('.tab').forEach(function(x){x.classList.remove('active')});b.classList.add('active');document.getElementById(b.dataset.tab).classList.add('active');document.getElementById('title').textContent=titles[b.dataset.tab]})});document.getElementById('logout').addEventListener('click',async function(){await fetch('/api/contractor/logout',{method:'POST'});location.href='/contractor-login'});document.getElementById('upload').addEventListener('submit',async function(e){e.preventDefault();var r=await fetch('/api/contractor/documents',{method:'POST',body:new FormData(e.currentTarget)});var j=await r.json().catch(function(){return {}});if(!r.ok){alert(j.error||'Upload failed');return}e.currentTarget.reset();await loadAll()});loadAll().catch(function(e){notice(e.message)});
</script></body></html>`;
}

export async function handleContractorLiveV2(request: Request, env: ContractorEnvV2): Promise<Response | null> {
  const path = new URL(request.url).pathname;
  const managed = path === "/contractor-health" || path === "/owner/contractors" || path === "/contractor-login" || path === "/contractor" || path.startsWith("/api/contractor/") || path === "/api/admin/contractors";
  if (!managed) return null;
  try {
    await ensureSchema(env);
    if (path === "/contractor-health") {
      const dbCheck = await env.DB.prepare("SELECT 1 AS ok").first<{ ok: number }>();
      return json({ ok: dbCheck?.ok === 1, service: "contractor-v2", database: true, storage: Boolean(env.BUCKET), adminSecretConfigured: Boolean(env.ADMIN_PASSWORD), time: new Date().toISOString() });
    }
    if (path === "/owner/contractors" && request.method === "GET") return html(ownerPage());
    if (path === "/api/admin/contractors" && request.method === "POST") return createContractor(request, env);
    if (path === "/contractor-login" && request.method === "GET") return html(loginPage());
    if (path === "/api/contractor/login" && request.method === "POST") return login(request, env);
    if (path === "/api/contractor/logout" && request.method === "POST") return logout(request, env);
    const session = await currentSession(request, env);
    if (!session) {
      if (path === "/contractor") return Response.redirect(new URL("/contractor-login", request.url), 302);
      return json({ error: "Sign in required." }, 401);
    }
    if (path === "/contractor" && request.method === "GET") return html(appPage());
    const response = await api(request, env, session, path);
    if (response) return response;
    return json({ error: "Contractor route not found." }, 404);
  } catch (error) {
    console.error("CONTRACTOR_V2_ERROR", { path, message: error instanceof Error ? error.message : String(error) });
    return path.startsWith("/api/") || path === "/contractor-health" ? json({ error: "Contractor service error. Check Cloudflare Observability for CONTRACTOR_V2_ERROR." }, 500) : html("<h1>Contractor service temporarily unavailable</h1><p>The error has been logged.</p>", 500);
  }
}
