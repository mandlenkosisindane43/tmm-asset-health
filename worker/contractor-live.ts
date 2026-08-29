export interface ContractorEnv {
  DB: D1Database;
  BUCKET?: R2Bucket;
  ADMIN_PASSWORD?: string;
}

type Session = {
  companyId: number;
  userId: number;
  email: string;
  fullName: string;
  role: string;
  companyName: string;
  licenceStatus: string;
  licenceExpiresAt: string;
};

const COOKIE = "sas_contractor_session";
const te = new TextEncoder();
let schemaReady: Promise<void> | null = null;

function responseJson(value: unknown, status = 200, extra: Record<string, string> = {}) {
  return new Response(JSON.stringify(value), {
    status,
    headers: { "content-type": "application/json; charset=utf-8", "cache-control": "no-store", ...extra },
  });
}

function responseHtml(value: string, status = 200) {
  return new Response(value, {
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

function txt(v: unknown, max = 240) { return String(v || "").trim().slice(0, max); }
function email(v: unknown) { return txt(v, 200).toLowerCase(); }
function hex(bytes: Uint8Array) { return Array.from(bytes, b => b.toString(16).padStart(2, "0")).join(""); }
function unhex(value: string) { const b = new Uint8Array(value.length / 2); for (let i = 0; i < b.length; i++) b[i] = parseInt(value.slice(i * 2, i * 2 + 2), 16); return b; }
function b64url(bytes: Uint8Array) { let s = ""; bytes.forEach(b => s += String.fromCharCode(b)); return btoa(s).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/g, ""); }

async function sha(value: string) { return hex(new Uint8Array(await crypto.subtle.digest("SHA-256", te.encode(value)))); }
async function same(a: string, b: string) { const [x, y] = await Promise.all([sha(a), sha(b)]); let d = x.length ^ y.length; for (let i = 0; i < Math.min(x.length, y.length); i++) d |= x.charCodeAt(i) ^ y.charCodeAt(i); return d === 0; }
async function passHash(password: string, salt: string) {
  const key = await crypto.subtle.importKey("raw", te.encode(password), "PBKDF2", false, ["deriveBits"]);
  const bits = await crypto.subtle.deriveBits({ name: "PBKDF2", hash: "SHA-256", salt: unhex(salt), iterations: 150000 }, key, 256);
  return hex(new Uint8Array(bits));
}

function cookie(request: Request) {
  const raw = request.headers.get("cookie") || "";
  for (const part of raw.split(";")) {
    const pair = part.trim().split("=");
    if (pair.shift() === COOKIE) return pair.join("=");
  }
  return "";
}

async function ensureSchema(env: ContractorEnv) {
  if (schemaReady) return schemaReady;
  schemaReady = (async () => {
    await env.DB.exec(`
      CREATE TABLE IF NOT EXISTS companies (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        name TEXT NOT NULL,
        licence_key TEXT NOT NULL UNIQUE,
        licence_status TEXT NOT NULL DEFAULT 'trial',
        expires_at TEXT NOT NULL,
        grace_days INTEGER NOT NULL DEFAULT 7,
        max_users INTEGER NOT NULL DEFAULT 10,
        created_at TEXT NOT NULL
      );
      CREATE TABLE IF NOT EXISTS company_users (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        company_id INTEGER NOT NULL,
        email TEXT NOT NULL,
        full_name TEXT NOT NULL,
        role TEXT NOT NULL DEFAULT 'viewer',
        status TEXT NOT NULL DEFAULT 'active',
        password_hash TEXT,
        password_salt TEXT,
        updated_at TEXT,
        created_at TEXT NOT NULL
      );
      CREATE INDEX IF NOT EXISTS company_users_company_idx ON company_users(company_id);
      CREATE INDEX IF NOT EXISTS company_users_email_idx ON company_users(email);
      CREATE TABLE IF NOT EXISTS contractor_sessions (
        token_hash TEXT PRIMARY KEY,
        company_id INTEGER NOT NULL,
        user_id INTEGER NOT NULL,
        expires_at TEXT NOT NULL,
        created_at TEXT NOT NULL
      );
      CREATE TABLE IF NOT EXISTS contractor_documents (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        company_id INTEGER NOT NULL,
        uploaded_by INTEGER NOT NULL,
        file_name TEXT NOT NULL,
        object_key TEXT NOT NULL UNIQUE,
        content_type TEXT,
        size_bytes INTEGER NOT NULL DEFAULT 0,
        category TEXT NOT NULL DEFAULT 'general',
        created_at TEXT NOT NULL
      );
      CREATE TABLE IF NOT EXISTS machines (
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
      );
      CREATE UNIQUE INDEX IF NOT EXISTS machines_company_fleet ON machines(company_id, fleet_number);
      CREATE TABLE IF NOT EXISTS events (
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
      );
      CREATE TABLE IF NOT EXISTS work_orders (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        company_id INTEGER NOT NULL,
        fleet_number TEXT NOT NULL,
        title TEXT NOT NULL,
        priority TEXT NOT NULL,
        assigned_to TEXT,
        due_at TEXT,
        status TEXT NOT NULL DEFAULT 'open',
        created_at TEXT NOT NULL
      );
      CREATE TABLE IF NOT EXISTS production_records (
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
      );
    `);
    for (const q of [
      "ALTER TABLE company_users ADD COLUMN password_hash TEXT",
      "ALTER TABLE company_users ADD COLUMN password_salt TEXT",
      "ALTER TABLE company_users ADD COLUMN updated_at TEXT",
    ]) { try { await env.DB.prepare(q).run(); } catch { /* existing column */ } }
  })().catch(e => { schemaReady = null; throw e; });
  return schemaReady;
}

function activeLicence(status: string, expires: string, graceDays: number) {
  if (!["active", "trial"].includes(status.toLowerCase())) return false;
  const end = new Date(expires).getTime() + Math.max(0, graceDays) * 86400000;
  return Number.isFinite(end) && Date.now() <= end;
}

async function sessionFor(request: Request, env: ContractorEnv): Promise<Session | null> {
  await ensureSchema(env);
  const token = cookie(request);
  if (!token) return null;
  const tokenHash = await sha(token);
  const row = await env.DB.prepare(`
    SELECT s.company_id AS companyId,s.user_id AS userId,s.expires_at AS sessionExpires,
           u.email,u.full_name AS fullName,u.role,u.status AS userStatus,
           c.name AS companyName,c.licence_status AS licenceStatus,c.expires_at AS licenceExpires,c.grace_days AS graceDays
    FROM contractor_sessions s
    JOIN company_users u ON u.id=s.user_id AND u.company_id=s.company_id
    JOIN companies c ON c.id=s.company_id
    WHERE s.token_hash=? LIMIT 1
  `).bind(tokenHash).first<Record<string, unknown>>();
  if (!row) return null;
  if (String(row.userStatus) !== "active" || new Date(String(row.sessionExpires)).getTime() < Date.now()) return null;
  if (!activeLicence(String(row.licenceStatus), String(row.licenceExpires), Number(row.graceDays || 0))) return null;
  return {
    companyId: Number(row.companyId), userId: Number(row.userId), email: String(row.email), fullName: String(row.fullName),
    role: String(row.role), companyName: String(row.companyName), licenceStatus: String(row.licenceStatus), licenceExpiresAt: String(row.licenceExpires),
  };
}

async function login(request: Request, env: ContractorEnv) {
  const body = await request.json().catch(() => ({})) as Record<string, unknown>;
  const userEmail = email(body.email), password = String(body.password || "");
  if (!userEmail || !password) return responseJson({ error: "Email and password are required." }, 400);
  const row = await env.DB.prepare(`
    SELECT u.id AS userId,u.company_id AS companyId,u.full_name AS fullName,u.role,u.status AS userStatus,u.password_hash AS passwordHash,u.password_salt AS passwordSalt,
           c.name AS companyName,c.licence_status AS licenceStatus,c.expires_at AS licenceExpires,c.grace_days AS graceDays
    FROM company_users u JOIN companies c ON c.id=u.company_id WHERE lower(u.email)=? ORDER BY u.id LIMIT 1
  `).bind(userEmail).first<Record<string, unknown>>();
  if (!row || String(row.userStatus) !== "active" || !row.passwordHash || !row.passwordSalt) return responseJson({ error: "Invalid email or password." }, 401);
  const calculated = await passHash(password, String(row.passwordSalt));
  if (!(await same(calculated, String(row.passwordHash)))) return responseJson({ error: "Invalid email or password." }, 401);
  if (!activeLicence(String(row.licenceStatus), String(row.licenceExpires), Number(row.graceDays || 0))) return responseJson({ error: "Company licence is inactive or expired." }, 403);
  const bytes = crypto.getRandomValues(new Uint8Array(32));
  const token = b64url(bytes), tokenHash = await sha(token), now = new Date(), expires = new Date(Date.now() + 12 * 3600000);
  await env.DB.prepare("DELETE FROM contractor_sessions WHERE expires_at<?").bind(now.toISOString()).run();
  await env.DB.prepare("INSERT INTO contractor_sessions(token_hash,company_id,user_id,expires_at,created_at) VALUES(?,?,?,?,?)")
    .bind(tokenHash, Number(row.companyId), Number(row.userId), expires.toISOString(), now.toISOString()).run();
  return responseJson({ ok: true }, 200, { "set-cookie": COOKIE + "=" + token + "; Path=/; HttpOnly; Secure; SameSite=Lax; Max-Age=43200" });
}

async function logout(request: Request, env: ContractorEnv) {
  const token = cookie(request);
  if (token) await env.DB.prepare("DELETE FROM contractor_sessions WHERE token_hash=?").bind(await sha(token)).run();
  return responseJson({ ok: true }, 200, { "set-cookie": COOKIE + "=; Path=/; HttpOnly; Secure; SameSite=Lax; Max-Age=0" });
}

async function adminOk(request: Request, env: ContractorEnv) {
  const configured = String(env.ADMIN_PASSWORD || "");
  if (!configured) return false;
  const auth = request.headers.get("authorization") || "";
  const supplied = auth.startsWith("Bearer ") ? auth.slice(7) : String(request.headers.get("x-admin-password") || "");
  return supplied ? same(supplied, configured) : false;
}

async function createCompany(request: Request, env: ContractorEnv) {
  if (!(await adminOk(request, env))) return responseJson({ error: env.ADMIN_PASSWORD ? "Administrator authentication failed." : "ADMIN_PASSWORD is not configured in Cloudflare secrets." }, env.ADMIN_PASSWORD ? 401 : 503);
  const b = await request.json().catch(() => ({})) as Record<string, unknown>;
  const companyName = txt(b.companyName, 120), fullName = txt(b.fullName, 120), userEmail = email(b.email), password = String(b.password || "");
  if (!companyName || !fullName || !userEmail) return responseJson({ error: "Company, administrator name and email are required." }, 400);
  if (password.length < 10) return responseJson({ error: "Use a contractor password with at least 10 characters." }, 400);
  const exists = await env.DB.prepare("SELECT id FROM company_users WHERE lower(email)=? LIMIT 1").bind(userEmail).first();
  if (exists) return responseJson({ error: "This email is already linked to a contractor account." }, 409);
  const days = Math.max(1, Math.min(3650, Number(b.licenceDays || 30))), now = new Date(), expires = new Date(Date.now() + days * 86400000).toISOString();
  const licence = "SAS-" + b64url(crypto.getRandomValues(new Uint8Array(12))).toUpperCase();
  await env.DB.prepare("INSERT INTO companies(name,licence_key,licence_status,expires_at,grace_days,max_users,created_at) VALUES(?,?,?,?,?,?,?)")
    .bind(companyName, licence, "active", expires, 7, 10, now.toISOString()).run();
  const company = await env.DB.prepare("SELECT id FROM companies WHERE licence_key=? LIMIT 1").bind(licence).first<{ id: number }>();
  if (!company) return responseJson({ error: "Company creation failed." }, 500);
  const salt = hex(crypto.getRandomValues(new Uint8Array(16))), hash = await passHash(password, salt);
  await env.DB.prepare("INSERT INTO company_users(company_id,email,full_name,role,status,password_hash,password_salt,updated_at,created_at) VALUES(?,?,?,?,?,?,?,?,?)")
    .bind(company.id, userEmail, fullName, txt(b.role || "company_admin", 40), "active", hash, salt, now.toISOString(), now.toISOString()).run();
  return responseJson({ ok: true, companyId: company.id, companyName, email: userEmail, licenceKey: licence, expiresAt: expires }, 201);
}

async function dataApi(request: Request, env: ContractorEnv, s: Session, path: string): Promise<Response | null> {
  const method = request.method.toUpperCase(), cid = s.companyId;
  if (path === "/api/contractor/me" && method === "GET") return responseJson({ user: { email: s.email, fullName: s.fullName, role: s.role }, company: { id: cid, name: s.companyName, licenceStatus: s.licenceStatus, expiresAt: s.licenceExpiresAt } });

  if (path === "/api/contractor/fleet") {
    if (method === "GET") {
      const r = await env.DB.prepare("SELECT id,fleet_number AS fleetNumber,category,site,status,operating_hours AS operatingHours,availability_target AS availabilityTarget,next_service_hours AS nextServiceHours FROM machines WHERE company_id=? ORDER BY fleet_number LIMIT 1000").bind(cid).all<Record<string, unknown>>();
      return responseJson({ machines: r.results });
    }
    if (method === "POST") {
      const b = await request.json().catch(() => ({})) as Record<string, unknown>;
      const fleet = txt(b.fleetNumber, 60), category = txt(b.category, 100);
      if (!fleet || !category) return responseJson({ error: "Fleet number and machine type are required." }, 400);
      try { await env.DB.prepare("INSERT INTO machines(company_id,fleet_number,category,site,status,operating_hours,availability_target,next_service_hours,created_at) VALUES(?,?,?,?,?,?,?,?,?)")
        .bind(cid, fleet, category, txt(b.site || "Unassigned", 100), txt(b.status || "operating", 30), Number(b.operatingHours || 0), Number(b.availabilityTarget || 0.9), b.nextServiceHours === "" || b.nextServiceHours == null ? null : Number(b.nextServiceHours), new Date().toISOString()).run(); }
      catch { return responseJson({ error: "That fleet number already exists for this company." }, 409); }
      return responseJson({ ok: true }, 201);
    }
  }

  if (path === "/api/contractor/breakdowns") {
    if (method === "GET") {
      const r = await env.DB.prepare("SELECT id,fleet_number AS fleetNumber,severity,system_name AS system,component,description,opened_at AS openedAt,downtime_hours AS downtimeHours,status,action FROM events WHERE company_id=? ORDER BY id DESC LIMIT 500").bind(cid).all<Record<string, unknown>>();
      return responseJson({ events: r.results });
    }
    if (method === "POST") {
      const b = await request.json().catch(() => ({})) as Record<string, unknown>, fleet = txt(b.fleetNumber, 60), description = txt(b.description, 500), now = new Date().toISOString();
      if (!fleet || !description) return responseJson({ error: "Machine and fault description are required." }, 400);
      await env.DB.prepare("INSERT INTO events(company_id,fleet_number,event_type,severity,system_name,component,description,opened_at,downtime_hours,status,action,spares_status,oil_litres_lost,created_at) VALUES(?,?,?,?,?,?,?,?,?,?,?,?,?,?)")
        .bind(cid, fleet, "breakdown", txt(b.severity || "medium", 30), txt(b.system || "General", 80), txt(b.component || "Not confirmed", 100), description, now, Number(b.downtimeHours || 0), "open", txt(b.action || "Inspection required", 300), "Not assessed", Number(b.oilLitresLost || 0), now).run();
      return responseJson({ ok: true }, 201);
    }
  }

  if (path === "/api/contractor/work-orders") {
    if (method === "GET") {
      const r = await env.DB.prepare("SELECT id,fleet_number AS fleetNumber,title,priority,assigned_to AS assignedTo,due_at AS dueAt,status FROM work_orders WHERE company_id=? ORDER BY id DESC LIMIT 500").bind(cid).all<Record<string, unknown>>();
      return responseJson({ workOrders: r.results });
    }
    if (method === "POST") {
      const b = await request.json().catch(() => ({})) as Record<string, unknown>, fleet = txt(b.fleetNumber, 60), title = txt(b.title, 300);
      if (!fleet || !title) return responseJson({ error: "Fleet number and work description are required." }, 400);
      await env.DB.prepare("INSERT INTO work_orders(company_id,fleet_number,title,priority,assigned_to,due_at,status,created_at) VALUES(?,?,?,?,?,?,?,?)")
        .bind(cid, fleet, title, txt(b.priority || "medium", 30), txt(b.assignedTo, 120), txt(b.dueAt, 40), "open", new Date().toISOString()).run();
      return responseJson({ ok: true }, 201);
    }
  }

  if (path === "/api/contractor/production") {
    if (method === "GET") {
      const r = await env.DB.prepare("SELECT id,report_date AS reportDate,fleet_number AS fleetNumber,shift_hours AS shiftHours,unplanned_downtime AS unplannedDowntime,operating_hours AS operatingHours,tonnes FROM production_records WHERE company_id=? ORDER BY report_date DESC,id DESC LIMIT 500").bind(cid).all<Record<string, unknown>>();
      return responseJson({ records: r.results });
    }
    if (method === "POST") {
      const b = await request.json().catch(() => ({})) as Record<string, unknown>, now = new Date().toISOString();
      await env.DB.prepare("INSERT INTO production_records(company_id,report_date,fleet_number,shift_hours,planned_downtime,unplanned_downtime,operating_hours,productive_hours,tonnes,source_file,created_at) VALUES(?,?,?,?,?,?,?,?,?,?,?)")
        .bind(cid, txt(b.reportDate || now.slice(0, 10), 20), txt(b.fleetNumber || "Plant", 60), Number(b.shiftHours || 24), 0, Number(b.unplannedDowntime || 0), Number(b.operatingHours || 0), Number(b.operatingHours || 0), Number(b.tonnes || 0), "contractor live capture", now).run();
      return responseJson({ ok: true }, 201);
    }
  }

  if (path === "/api/contractor/dashboard" && method === "GET") {
    const fleet = (await env.DB.prepare("SELECT id,fleet_number AS fleetNumber,category,site,status,operating_hours AS operatingHours,next_service_hours AS nextServiceHours FROM machines WHERE company_id=? ORDER BY fleet_number LIMIT 1000").bind(cid).all<Record<string, unknown>>()).results;
    const breaks = (await env.DB.prepare("SELECT id,fleet_number AS fleetNumber,severity,description,opened_at AS openedAt,downtime_hours AS downtimeHours,status FROM events WHERE company_id=? AND status!='closed' ORDER BY id DESC LIMIT 100").bind(cid).all<Record<string, unknown>>()).results;
    const work = (await env.DB.prepare("SELECT id FROM work_orders WHERE company_id=? AND status NOT IN ('closed','completed') LIMIT 1000").bind(cid).all()).results;
    const prod = (await env.DB.prepare("SELECT report_date AS reportDate,tonnes FROM production_records WHERE company_id=? ORDER BY report_date DESC,id DESC LIMIT 500").bind(cid).all<Record<string, unknown>>()).results;
    const operating = fleet.filter(x => ["operating", "running", "available"].includes(String(x.status || "").toLowerCase())).length;
    const latestDate = prod.length ? String(prod[0].reportDate) : "";
    const tonnes = latestDate ? prod.filter(x => String(x.reportDate) === latestDate).reduce((sum, x) => sum + Number(x.tonnes || 0), 0) : 0;
    return responseJson({ metrics: { fleetTotal: fleet.length, operating, availability: fleet.length ? operating / fleet.length * 100 : 0, openBreakdowns: breaks.length, openWorkOrders: work.length, production: tonnes, productionDate: latestDate }, fleet, breakdowns: breaks });
  }

  if (path === "/api/contractor/documents") {
    if (method === "GET") {
      const r = await env.DB.prepare("SELECT id,file_name AS fileName,category,size_bytes AS sizeBytes,created_at AS createdAt FROM contractor_documents WHERE company_id=? ORDER BY id DESC LIMIT 300").bind(cid).all<Record<string, unknown>>();
      return responseJson({ documents: r.results });
    }
    if (method === "POST") {
      if (!env.BUCKET) return responseJson({ error: "R2 storage is not configured." }, 503);
      const form = await request.formData(), file = form.get("file");
      if (!(file instanceof File) || !file.size) return responseJson({ error: "Choose a file." }, 400);
      if (file.size > 15_000_000) return responseJson({ error: "File must be 15 MB or smaller." }, 400);
      const allowed = new Set(["application/pdf","image/png","image/jpeg","application/vnd.openxmlformats-officedocument.wordprocessingml.document","application/vnd.openxmlformats-officedocument.spreadsheetml.sheet","application/vnd.ms-excel","text/csv","application/csv","text/plain"]);
      if (file.type && !allowed.has(file.type)) return responseJson({ error: "Upload PDF, Word, Excel, CSV, TXT, PNG or JPG." }, 400);
      const safe = file.name.replace(/[^a-zA-Z0-9._-]/g, "-").slice(-140) || "document";
      const key = "companies/" + cid + "/documents/" + crypto.randomUUID() + "-" + safe;
      await env.BUCKET.put(key, file.stream(), { httpMetadata: { contentType: file.type || "application/octet-stream" } });
      await env.DB.prepare("INSERT INTO contractor_documents(company_id,uploaded_by,file_name,object_key,content_type,size_bytes,category,created_at) VALUES(?,?,?,?,?,?,?,?)")
        .bind(cid, s.userId, file.name.slice(0, 240), key, file.type || "application/octet-stream", file.size, txt(form.get("category") || "general", 60), new Date().toISOString()).run();
      return responseJson({ ok: true }, 201);
    }
  }

  const dm = path.match(/^\/api\/contractor\/documents\/(\d+)\/download$/);
  if (dm && method === "GET") {
    if (!env.BUCKET) return responseJson({ error: "R2 storage is not configured." }, 503);
    const d = await env.DB.prepare("SELECT object_key AS objectKey,file_name AS fileName,content_type AS contentType FROM contractor_documents WHERE id=? AND company_id=? LIMIT 1").bind(Number(dm[1]), cid).first<Record<string, unknown>>();
    if (!d) return responseJson({ error: "Document not found." }, 404);
    const obj = await env.BUCKET.get(String(d.objectKey));
    if (!obj) return responseJson({ error: "Stored file not found." }, 404);
    return new Response(obj.body, { headers: { "content-type": String(d.contentType || "application/octet-stream"), "content-disposition": "attachment; filename=\"" + String(d.fileName).replace(/[\"\r\n]/g, "-") + "\"", "cache-control": "private, no-store" } });
  }
  return null;
}

function loginPage() {
  return `<!doctype html><html><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>Contractor Login</title><style>*{box-sizing:border-box}body{margin:0;min-height:100vh;display:grid;place-items:center;background:#09192e;font-family:Arial,sans-serif;padding:20px}.box{width:min(430px,100%);background:#fff;border-radius:18px;padding:32px;color:#15243c}.brand{font-weight:900;color:#103963}.brand small{display:block;color:#718198;margin-top:4px}.tag{margin-top:22px;font-size:11px;font-weight:900;color:#1267b3}.box h1{margin:7px 0}.box p{color:#64748b;font-size:13px;line-height:1.5}.field{display:grid;gap:7px;margin-top:15px;font-size:12px;font-weight:800}.field input{padding:13px;border:1px solid #cbd5e1;border-radius:8px;font-size:15px}.btn{width:100%;margin-top:20px;border:0;border-radius:8px;background:#1267b3;color:#fff;padding:13px;font-weight:900}.msg{min-height:18px;margin-top:12px;color:#b91c1c;font-size:12px}.demo{border-top:1px solid #e5e7eb;margin-top:18px;padding-top:16px;font-size:12px}.demo a{color:#1267b3;font-weight:800;text-decoration:none}</style></head><body><form id="f" class="box"><div class="brand">TMM Asset Health<small>Sindane Asset Solutions</small></div><div class="tag">CONTRACTOR SECURE ACCESS</div><h1>Company workspace login</h1><p>After sign-in, every database query uses the company ID stored in your secure server session.</p><label class="field">Email<input name="email" type="email" required></label><label class="field">Password<input name="password" type="password" required></label><button class="btn">Sign in securely</button><div id="msg" class="msg"></div><div class="demo"><a href="/contractor-demo">Open the sample contractor demo</a></div></form><script>document.getElementById('f').onsubmit=async function(e){e.preventDefault();var f=new FormData(e.currentTarget);var r=await fetch('/api/contractor/login',{method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify({email:f.get('email'),password:f.get('password')})});var j=await r.json().catch(function(){return {}});if(r.ok){location.href='/contractor';return}document.getElementById('msg').textContent=j.error||'Sign in failed.'}</script></body></html>`;
}

function ownerPage() {
  return `<!doctype html><html><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>Create Contractor</title><style>*{box-sizing:border-box}body{margin:0;background:#f4f7fb;font-family:Arial,sans-serif;color:#15243c;padding:28px}.card{max-width:760px;margin:auto;background:#fff;border:1px solid #dce5ef;border-radius:16px;padding:25px}.grid{display:grid;grid-template-columns:1fr 1fr;gap:12px}.field{display:grid;gap:6px;font-size:12px;font-weight:800}.field input,.field select{padding:11px;border:1px solid #cbd5e1;border-radius:8px}.wide{grid-column:1/-1}.btn{border:0;background:#1267b3;color:#fff;padding:12px 16px;border-radius:8px;font-weight:900;margin-top:8px}.msg{margin-top:16px;padding:12px;background:#f8fafc;border-radius:8px;white-space:pre-wrap;font-size:12px}@media(max-width:650px){.grid{grid-template-columns:1fr}.wide{grid-column:auto}}</style></head><body><div class="card"><h1>Create live contractor account</h1><p>This owner-only page creates an isolated company tenant and its first administrator.</p><form id="f" class="grid"><label class="field wide">Sindane owner password<input name="ownerPassword" type="password" required></label><label class="field wide">Company name<input name="companyName" required></label><label class="field">Administrator name<input name="fullName" required></label><label class="field">Administrator email<input name="email" type="email" required></label><label class="field">Contractor password<input name="password" type="password" minlength="10" required></label><label class="field">Licence days<input name="licenceDays" type="number" value="30" min="1"></label><label class="field">Role<select name="role"><option value="company_admin">Company Admin</option><option value="engineer">Engineer</option><option value="manager">Manager</option></select></label><div class="wide"><button class="btn">Create contractor</button><div id="msg" class="msg">No account created yet.</div></div></form></div><script>document.getElementById('f').onsubmit=async function(e){e.preventDefault();var f=new FormData(e.currentTarget);var p={companyName:f.get('companyName'),fullName:f.get('fullName'),email:f.get('email'),password:f.get('password'),licenceDays:Number(f.get('licenceDays')),role:f.get('role')};var r=await fetch('/api/admin/contractors',{method:'POST',headers:{'content-type':'application/json','x-admin-password':String(f.get('ownerPassword')||'')},body:JSON.stringify(p)});var j=await r.json().catch(function(){return {}});var m=document.getElementById('msg');m.textContent=r.ok?('Created: '+j.companyName+'\nLogin: '+j.email+'\nLicence: '+j.licenceKey+'\nExpires: '+j.expiresAt):(j.error||'Creation failed.')}</script></body></html>`;
}

function appPage() {
  return `<!doctype html><html><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>Contractor Workspace</title><style>*{box-sizing:border-box}body{margin:0;background:#f4f7fb;color:#14213d;font-family:Arial,sans-serif}.app{min-height:100vh;display:grid;grid-template-columns:245px 1fr}.side{background:#0c1b33;color:#fff;padding:20px 14px;display:flex;flex-direction:column}.brand{font-weight:900;padding:7px;border-bottom:1px solid #243750}.brand small{display:block;color:#91a8c8;margin-top:4px}.company{margin:16px 0;padding:12px;background:#112642;border:1px solid #29405f;border-radius:10px}.company b,.company small{display:block}.company small{color:#91a8c8;margin-top:4px}.nav{display:grid;gap:4px}.nav button{background:transparent;border:0;color:#bcc9da;text-align:left;padding:11px;border-radius:8px;font-weight:800}.nav button.active,.nav button:hover{background:#1a3d68;color:#fff}.secure{margin-top:auto;font-size:10px;color:#7fd7a9}.main{min-width:0}.top{height:80px;background:#fff;border-bottom:1px solid #dce4ed;padding:15px 24px;display:flex;align-items:center;justify-content:space-between}.top h1{margin:2px 0;font-size:22px}.top small{color:#758399}.top button{border:1px solid #d5deea;background:#fff;border-radius:8px;padding:8px 10px;font-weight:800}.content{padding:22px 24px}.hero{background:linear-gradient(120deg,#10355d,#185c8d);color:#fff;padding:22px;border-radius:14px}.hero h2{margin:5px 0}.hero p{margin:0;color:#c8daea;font-size:13px}.metrics{display:grid;grid-template-columns:repeat(5,1fr);gap:12px;margin:14px 0}.metric,.panel{background:#fff;border:1px solid #dce5ef;border-radius:12px}.metric{padding:15px}.metric small{color:#748398;font-weight:800}.metric b{font-size:24px;display:block;margin:7px 0}.panel{padding:17px}.tab{display:none}.tab.active{display:block}.grid{display:grid;grid-template-columns:1fr 1fr;gap:14px}.form{display:grid;grid-template-columns:repeat(3,1fr);gap:9px;margin-bottom:12px}.form input,.form select{padding:10px;border:1px solid #cbd5e1;border-radius:7px}.form button,.upload button{border:0;background:#1267b3;color:#fff;border-radius:7px;padding:10px;font-weight:800}.table{overflow:auto}table{width:100%;border-collapse:collapse;font-size:12px}th{background:#f7f9fc;text-align:left;padding:10px;font-size:9px;text-transform:uppercase;color:#64748b}td{border-top:1px solid #edf1f5;padding:10px}.msg{font-size:11px;color:#9a3412;min-height:16px}.empty{padding:18px;text-align:center;color:#7b8798}.upload{display:flex;gap:9px;flex-wrap:wrap;align-items:center}@media(max-width:1050px){.metrics{grid-template-columns:repeat(2,1fr)}.grid{grid-template-columns:1fr}}@media(max-width:760px){.app{display:block}.side{display:block}.company,.secure{display:none}.nav{grid-template-columns:repeat(4,1fr);overflow:auto}.nav button{font-size:10px;padding:8px}.top{height:auto;padding:12px 14px}.content{padding:14px}.form{grid-template-columns:1fr}}</style></head><body><div class="app"><aside class="side"><div class="brand">TMM Asset Health<small>Sindane Asset Solutions</small></div><div class="company"><b id="company">Company</b><small id="user">Loading...</small></div><nav class="nav"><button class="active" data-tab="dashboard">Dashboard</button><button data-tab="fleet">Fleet</button><button data-tab="breakdowns">Breakdowns</button><button data-tab="maintenance">Maintenance</button><button data-tab="workorders">Work orders</button><button data-tab="production">Production</button><button data-tab="documents">Documents</button><button data-tab="reports">Reports</button></nav><div class="secure">Server-side tenant isolation enabled</div></aside><main class="main"><header class="top"><div><small>CONTRACTOR LIVE PORTAL</small><h1 id="title">Operations Dashboard</h1></div><div><button onclick="load(current)">Refresh</button> <button onclick="signout()">Sign out</button></div></header><div class="content">
<section id="dashboard" class="tab active"><div class="hero"><small>LIVE COMPANY DATA</small><h2 id="welcome">Contractor workspace</h2><p>Every record below is filtered on the server using your signed-in company session.</p></div><div class="metrics"><div class="metric"><small>Availability</small><b id="ma">0%</b></div><div class="metric"><small>Operating</small><b id="mo">0 / 0</b></div><div class="metric"><small>Breakdowns</small><b id="mb">0</b></div><div class="metric"><small>Work orders</small><b id="mw">0</b></div><div class="metric"><small>Production</small><b id="mp">0 t</b><span id="mpd"></span></div></div><div class="grid"><div class="panel"><h3>Fleet status</h3><div id="df"></div></div><div class="panel"><h3>Open breakdowns</h3><div id="db"></div></div></div></section>
<section id="fleet" class="tab"><div class="panel"><h3>Fleet register</h3><form id="fleetForm" class="form"><input name="fleetNumber" placeholder="Fleet no." required><input name="category" placeholder="Machine type" required><input name="site" placeholder="Site"><input name="operatingHours" type="number" step="0.1" placeholder="Current hours"><input name="nextServiceHours" type="number" step="0.1" placeholder="Next service meter"><button>Add machine</button></form><div id="fleetMsg" class="msg"></div><div id="fleetTable" class="table"></div></div></section>
<section id="breakdowns" class="tab"><div class="panel"><h3>Breakdown register</h3><form id="breakForm" class="form"><input name="fleetNumber" placeholder="Fleet no." required><input name="description" placeholder="Fault description" required><select name="severity"><option>medium</option><option>high</option><option>critical</option><option>low</option></select><input name="system" placeholder="System"><input name="component" placeholder="Component"><button>Capture breakdown</button></form><div id="breakMsg" class="msg"></div><div id="breakTable" class="table"></div></div></section>
<section id="maintenance" class="tab"><div class="panel"><h3>Maintenance due</h3><div id="maintTable" class="table"></div></div></section>
<section id="workorders" class="tab"><div class="panel"><h3>Work orders</h3><form id="woForm" class="form"><input name="fleetNumber" placeholder="Fleet no." required><input name="title" placeholder="Work required" required><select name="priority"><option>medium</option><option>high</option><option>critical</option><option>low</option></select><input name="assignedTo" placeholder="Assigned to"><input name="dueAt" type="date"><button>Create work order</button></form><div id="woMsg" class="msg"></div><div id="woTable" class="table"></div></div></section>
<section id="production" class="tab"><div class="panel"><h3>Production</h3><form id="prodForm" class="form"><input name="reportDate" type="date" required><input name="fleetNumber" value="Plant" placeholder="Fleet / Plant"><input name="tonnes" type="number" step="0.1" placeholder="Tonnes"><input name="operatingHours" type="number" step="0.1" placeholder="Operating h"><input name="unplannedDowntime" type="number" step="0.1" placeholder="Downtime h"><button>Save production</button></form><div id="prodMsg" class="msg"></div><div id="prodTable" class="table"></div></div></section>
<section id="documents" class="tab"><div class="panel"><h3>Secure documents</h3><form id="docForm" class="upload"><input name="file" type="file" required><select name="category"><option value="general">General</option><option value="purchase_order">Purchase order</option><option value="inspection">Inspection</option><option value="oem">OEM / service</option><option value="job_card">Job card</option></select><button>Upload to R2</button></form><div id="docMsg" class="msg"></div><div id="docTable" class="table"></div></div></section>
<section id="reports" class="tab"><div class="panel"><h3>Reports</h3><p>Daily, weekly, monthly, downtime Pareto and maintenance compliance exports will use only this tenant's records.</p><button onclick="window.print()">Print current view</button></div></section>
</div></main></div><script>
var current='dashboard';var titles={dashboard:'Operations Dashboard',fleet:'Fleet',breakdowns:'Breakdowns',maintenance:'Maintenance',workorders:'Work orders',production:'Production',documents:'Documents',reports:'Reports'};
function esc(v){return String(v==null?'':v).replace(/[&<>"']/g,function(m){return {'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[m]})}function num(v){return Number(v||0)}
async function api(path,opt){var r=await fetch(path,opt);if(r.status===401){location.href='/contractor-login';throw new Error('Sign in required')}var j=await r.json().catch(function(){return {}});if(!r.ok)throw new Error(j.error||'Request failed');return j}
function tbl(cols,rows){if(!rows||!rows.length)return '<div class="empty">No records yet.</div>';var h='<table><thead><tr>';cols.forEach(function(c){h+='<th>'+esc(c[0])+'</th>'});h+='</tr></thead><tbody>';rows.forEach(function(r){h+='<tr>';cols.forEach(function(c){h+='<td>'+esc(r[c[1]])+'</td>'});h+='</tr>'});return h+'</tbody></table>'}
async function loadMe(){var j=await api('/api/contractor/me');document.getElementById('company').textContent=j.company.name;document.getElementById('user').textContent=j.user.fullName+' - '+j.user.role;document.getElementById('welcome').textContent='Welcome, '+j.user.fullName}
async function dashboard(){var j=await api('/api/contractor/dashboard'),m=j.metrics;document.getElementById('ma').textContent=num(m.availability).toFixed(1)+'%';document.getElementById('mo').textContent=m.operating+' / '+m.fleetTotal;document.getElementById('mb').textContent=m.openBreakdowns;document.getElementById('mw').textContent=m.openWorkOrders;document.getElementById('mp').textContent=num(m.production).toLocaleString()+' t';document.getElementById('mpd').textContent=m.productionDate||'No records';document.getElementById('df').innerHTML=tbl([['Fleet','fleetNumber'],['Type','category'],['Site','site'],['Status','status']],j.fleet.slice(0,8));document.getElementById('db').innerHTML=tbl([['Fleet','fleetNumber'],['Severity','severity'],['Fault','description'],['Opened','openedAt']],j.breakdowns.slice(0,8))}
async function fleet(){var j=await api('/api/contractor/fleet');document.getElementById('fleetTable').innerHTML=tbl([['Fleet','fleetNumber'],['Machine','category'],['Site','site'],['Status','status'],['Hours','operatingHours'],['Next service','nextServiceHours']],j.machines);var a=j.machines.map(function(x){var y=Object.assign({},x);y.dueIn=x.nextServiceHours==null?'Not set':(num(x.nextServiceHours)-num(x.operatingHours)).toFixed(1)+' h';return y});document.getElementById('maintTable').innerHTML=tbl([['Fleet','fleetNumber'],['Machine','category'],['Hours','operatingHours'],['Next service','nextServiceHours'],['Due in','dueIn']],a)}
async function breakdowns(){var j=await api('/api/contractor/breakdowns');document.getElementById('breakTable').innerHTML=tbl([['Fleet','fleetNumber'],['Severity','severity'],['System','system'],['Component','component'],['Fault','description'],['Opened','openedAt'],['Status','status']],j.events)}
async function workorders(){var j=await api('/api/contractor/work-orders');document.getElementById('woTable').innerHTML=tbl([['Fleet','fleetNumber'],['Work','title'],['Priority','priority'],['Assigned','assignedTo'],['Due','dueAt'],['Status','status']],j.workOrders)}
async function production(){var j=await api('/api/contractor/production');document.getElementById('prodTable').innerHTML=tbl([['Date','reportDate'],['Fleet / Plant','fleetNumber'],['Tonnes','tonnes'],['Operating h','operatingHours'],['Downtime h','unplannedDowntime']],j.records)}
async function documents(){var j=await api('/api/contractor/documents');if(!j.documents.length){document.getElementById('docTable').innerHTML='<div class="empty">No documents yet.</div>';return}var h='<table><thead><tr><th>File</th><th>Category</th><th>Size</th><th>Uploaded</th><th></th></tr></thead><tbody>';j.documents.forEach(function(d){h+='<tr><td>'+esc(d.fileName)+'</td><td>'+esc(d.category)+'</td><td>'+Math.round(num(d.sizeBytes)/1024)+' KB</td><td>'+esc(d.createdAt)+'</td><td><a href="/api/contractor/documents/'+d.id+'/download">Download</a></td></tr>'});document.getElementById('docTable').innerHTML=h+'</tbody></table>'}
async function load(id){if(id==='dashboard')return dashboard();if(id==='fleet'||id==='maintenance')return fleet();if(id==='breakdowns')return breakdowns();if(id==='workorders')return workorders();if(id==='production')return production();if(id==='documents')return documents()}
function openTab(id){current=id;document.querySelectorAll('.tab').forEach(function(x){x.classList.remove('active')});document.querySelectorAll('.nav button').forEach(function(x){x.classList.remove('active')});document.getElementById(id).classList.add('active');document.querySelector('[data-tab="'+id+'"]').classList.add('active');document.getElementById('title').textContent=titles[id];load(id).catch(function(e){console.error(e)})}document.querySelectorAll('.nav button').forEach(function(b){b.onclick=function(){openTab(b.dataset.tab)}});
function bindForm(id,url,msg,after){document.getElementById(id).onsubmit=async function(e){e.preventDefault();var f=new FormData(e.currentTarget),p={};f.forEach(function(v,k){p[k]=v});try{await api(url,{method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify(p)});document.getElementById(msg).textContent='Saved successfully.';e.currentTarget.reset();await after()}catch(err){document.getElementById(msg).textContent=err.message}}}
bindForm('fleetForm','/api/contractor/fleet','fleetMsg',fleet);bindForm('breakForm','/api/contractor/breakdowns','breakMsg',breakdowns);bindForm('woForm','/api/contractor/work-orders','woMsg',workorders);bindForm('prodForm','/api/contractor/production','prodMsg',production);document.querySelector('#prodForm [name=reportDate]').value=new Date().toISOString().slice(0,10);
document.getElementById('docForm').onsubmit=async function(e){e.preventDefault();try{var r=await fetch('/api/contractor/documents',{method:'POST',body:new FormData(e.currentTarget)}),j=await r.json();if(!r.ok)throw new Error(j.error||'Upload failed');document.getElementById('docMsg').textContent='Uploaded securely.';e.currentTarget.reset();await documents()}catch(err){document.getElementById('docMsg').textContent=err.message}};
async function signout(){await fetch('/api/contractor/logout',{method:'POST'});location.href='/contractor-login'};(async function(){try{await loadMe();await dashboard()}catch(e){location.href='/contractor-login'}})();
</script></body></html>`;
}

export async function handleContractorLive(request: Request, env: ContractorEnv): Promise<Response | null> {
  const url = new URL(request.url), path = url.pathname;
  if (!path.startsWith("/contractor") && !path.startsWith("/api/contractor") && path !== "/owner/contractors" && path !== "/owner/contractors/" && path !== "/api/admin/contractors") return null;
  try {
    await ensureSchema(env);
    if (path === "/contractor-login" || path === "/contractor-login/") return (await sessionFor(request, env)) ? Response.redirect(new URL("/contractor", request.url), 302) : responseHtml(loginPage());
    if (path === "/owner/contractors" || path === "/owner/contractors/") return responseHtml(ownerPage());
    if (path === "/api/admin/contractors" && request.method === "POST") return createCompany(request, env);
    if (path === "/api/contractor/login" && request.method === "POST") return login(request, env);
    if (path === "/api/contractor/logout" && request.method === "POST") return logout(request, env);
    const s = await sessionFor(request, env);
    if (!s) return (path === "/contractor" || path === "/contractor/") ? Response.redirect(new URL("/contractor-login", request.url), 302) : responseJson({ error: "Sign in required." }, 401);
    if (path === "/contractor" || path === "/contractor/") return responseHtml(appPage());
    return (await dataApi(request, env, s, path)) || responseJson({ error: "Not found." }, 404);
  } catch (e) {
    console.error("CONTRACTOR_LIVE_ERROR", { path, message: e instanceof Error ? e.message : String(e) });
    return path.startsWith("/api/") ? responseJson({ error: "Contractor service error. The event has been logged." }, 500) : responseHtml("<h1>Contractor service temporarily unavailable</h1><p>The error has been logged.</p>", 500);
  }
}
