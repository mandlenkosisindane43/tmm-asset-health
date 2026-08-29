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
  companyExpiresAt: string;
  graceDays: number;
};

const SESSION_COOKIE = "sas_contractor_session";
const encoder = new TextEncoder();
let schemaReady: Promise<void> | null = null;

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
      "content-security-policy": "default-src 'self'; style-src 'self' 'unsafe-inline'; script-src 'self' 'unsafe-inline'; img-src 'self' data:; connect-src 'self'; frame-ancestors 'none'; base-uri 'self'; form-action 'self'",
    },
  });
}

function normaliseEmail(value: unknown) {
  return String(value || "").trim().toLowerCase();
}

function safeText(value: unknown, max = 240) {
  return String(value || "").trim().slice(0, max);
}

function toHex(bytes: Uint8Array) {
  return Array.from(bytes, (b) => b.toString(16).padStart(2, "0")).join("");
}

function fromHex(value: string) {
  const out = new Uint8Array(Math.floor(value.length / 2));
  for (let i = 0; i < out.length; i++) out[i] = Number.parseInt(value.slice(i * 2, i * 2 + 2), 16);
  return out;
}

function base64url(bytes: Uint8Array) {
  let binary = "";
  for (const b of bytes) binary += String.fromCharCode(b);
  return btoa(binary).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/g, "");
}

async function sha256Hex(value: string) {
  return toHex(new Uint8Array(await crypto.subtle.digest("SHA-256", encoder.encode(value))));
}

async function secureTextEqual(a: string, b: string) {
  const [ha, hb] = await Promise.all([sha256Hex(a), sha256Hex(b)]);
  if (ha.length !== hb.length) return false;
  let diff = 0;
  for (let i = 0; i < ha.length; i++) diff |= ha.charCodeAt(i) ^ hb.charCodeAt(i);
  return diff === 0;
}

async function passwordHash(password: string, saltHex: string) {
  const key = await crypto.subtle.importKey("raw", encoder.encode(password), "PBKDF2", false, ["deriveBits"]);
  const bits = await crypto.subtle.deriveBits(
    { name: "PBKDF2", hash: "SHA-256", salt: fromHex(saltHex), iterations: 150000 },
    key,
    256,
  );
  return toHex(new Uint8Array(bits));
}

function cookieValue(request: Request, name: string) {
  const cookie = request.headers.get("cookie") || "";
  for (const part of cookie.split(";")) {
    const [k, ...rest] = part.trim().split("=");
    if (k === name) return rest.join("=");
  }
  return "";
}

function licenceAllowed(status: string, expiresAt: string, graceDays: number) {
  if (!["active", "trial"].includes(String(status).toLowerCase())) return false;
  const expiry = new Date(expiresAt).getTime();
  if (!Number.isFinite(expiry)) return false;
  return Date.now() <= expiry + Math.max(0, Number(graceDays || 0)) * 86400000;
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
      CREATE INDEX IF NOT EXISTS contractor_sessions_company_idx ON contractor_sessions(company_id);
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
      CREATE INDEX IF NOT EXISTS contractor_documents_company_idx ON contractor_documents(company_id);
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
    const alterations = [
      "ALTER TABLE company_users ADD COLUMN password_hash TEXT",
      "ALTER TABLE company_users ADD COLUMN password_salt TEXT",
      "ALTER TABLE company_users ADD COLUMN updated_at TEXT",
    ];
    for (const sql of alterations) {
      try { await env.DB.prepare(sql).run(); } catch { /* already exists */ }
    }
  })().catch((error) => { schemaReady = null; throw error; });
  return schemaReady;
}

async function getSession(request: Request, env: ContractorEnv): Promise<Session | null> {
  await ensureSchema(env);
  const token = cookieValue(request, SESSION_COOKIE);
  if (!token) return null;
  const tokenHash = await sha256Hex(token);
  const row = await env.DB.prepare(`
    SELECT s.company_id AS companyId, s.user_id AS userId, s.expires_at AS sessionExpiresAt,
           u.email AS email, u.full_name AS fullName, u.role AS role, u.status AS userStatus,
           c.name AS companyName, c.licence_status AS licenceStatus, c.expires_at AS companyExpiresAt,
           c.grace_days AS graceDays
    FROM contractor_sessions s
    JOIN company_users u ON u.id = s.user_id AND u.company_id = s.company_id
    JOIN companies c ON c.id = s.company_id
    WHERE s.token_hash = ?
    LIMIT 1
  `).bind(tokenHash).first<Record<string, unknown>>();
  if (!row) return null;
  if (String(row.userStatus) !== "active" || new Date(String(row.sessionExpiresAt)).getTime() < Date.now()) {
    await env.DB.prepare("DELETE FROM contractor_sessions WHERE token_hash = ?").bind(tokenHash).run();
    return null;
  }
  if (!licenceAllowed(String(row.licenceStatus), String(row.companyExpiresAt), Number(row.graceDays || 0))) return null;
  return {
    companyId: Number(row.companyId), userId: Number(row.userId), email: String(row.email),
    fullName: String(row.fullName), role: String(row.role), companyName: String(row.companyName),
    licenceStatus: String(row.licenceStatus), companyExpiresAt: String(row.companyExpiresAt), graceDays: Number(row.graceDays || 0),
  };
}

async function requireSession(request: Request, env: ContractorEnv) {
  const session = await getSession(request, env);
  return session || null;
}

async function verifyAdmin(request: Request, env: ContractorEnv) {
  const configured = String(env.ADMIN_PASSWORD || "");
  if (!configured) return false;
  const auth = request.headers.get("authorization") || "";
  const supplied = auth.startsWith("Bearer ") ? auth.slice(7) : (request.headers.get("x-admin-password") || "");
  if (!supplied) return false;
  return secureTextEqual(supplied, configured);
}

async function login(request: Request, env: ContractorEnv) {
  await ensureSchema(env);
  const body = await request.json().catch(() => ({})) as Record<string, unknown>;
  const email = normaliseEmail(body.email);
  const password = String(body.password || "");
  if (!email || !password) return json({ error: "Email and password are required." }, 400);
  const row = await env.DB.prepare(`
    SELECT u.id AS userId, u.company_id AS companyId, u.email, u.full_name AS fullName, u.role,
           u.status AS userStatus, u.password_hash AS passwordHash, u.password_salt AS passwordSalt,
           c.name AS companyName, c.licence_status AS licenceStatus, c.expires_at AS companyExpiresAt,
           c.grace_days AS graceDays
    FROM company_users u JOIN companies c ON c.id = u.company_id
    WHERE lower(u.email) = ? ORDER BY u.id ASC LIMIT 1
  `).bind(email).first<Record<string, unknown>>();
  if (!row || String(row.userStatus) !== "active" || !row.passwordHash || !row.passwordSalt) {
    return json({ error: "Invalid email or password." }, 401);
  }
  const hash = await passwordHash(password, String(row.passwordSalt));
  if (!(await secureTextEqual(hash, String(row.passwordHash)))) return json({ error: "Invalid email or password." }, 401);
  if (!licenceAllowed(String(row.licenceStatus), String(row.companyExpiresAt), Number(row.graceDays || 0))) {
    return json({ error: "This company licence is inactive or expired. Contact Sindane Asset Solutions." }, 403);
  }
  const tokenBytes = crypto.getRandomValues(new Uint8Array(32));
  const token = base64url(tokenBytes);
  const tokenHash = await sha256Hex(token);
  const now = new Date();
  const expires = new Date(now.getTime() + 12 * 60 * 60 * 1000);
  await env.DB.prepare("DELETE FROM contractor_sessions WHERE expires_at < ?").bind(now.toISOString()).run();
  await env.DB.prepare("INSERT INTO contractor_sessions(token_hash,company_id,user_id,expires_at,created_at) VALUES(?,?,?,?,?)")
    .bind(tokenHash, Number(row.companyId), Number(row.userId), expires.toISOString(), now.toISOString()).run();
  return json({ ok: true, company: row.companyName, name: row.fullName }, 200, {
    "set-cookie": `${SESSION_COOKIE}=${token}; Path=/; HttpOnly; Secure; SameSite=Lax; Max-Age=43200`,
  });
}

async function logout(request: Request, env: ContractorEnv) {
  const token = cookieValue(request, SESSION_COOKIE);
  if (token) await env.DB.prepare("DELETE FROM contractor_sessions WHERE token_hash = ?").bind(await sha256Hex(token)).run();
  return json({ ok: true }, 200, { "set-cookie": `${SESSION_COOKIE}=; Path=/; HttpOnly; Secure; SameSite=Lax; Max-Age=0` });
}

async function createContractor(request: Request, env: ContractorEnv) {
  await ensureSchema(env);
  if (!(await verifyAdmin(request, env))) {
    if (!env.ADMIN_PASSWORD) return json({ error: "ADMIN_PASSWORD is not configured in Cloudflare secrets." }, 503);
    return json({ error: "Administrator authentication failed." }, 401);
  }
  const body = await request.json().catch(() => ({})) as Record<string, unknown>;
  const companyName = safeText(body.companyName, 120);
  const email = normaliseEmail(body.email);
  const fullName = safeText(body.fullName, 120);
  const password = String(body.password || "");
  const role = safeText(body.role || "company_admin", 40) || "company_admin";
  const licenceDays = Math.min(3650, Math.max(1, Number(body.licenceDays || 30)));
  if (!companyName || !email || !fullName) return json({ error: "Company name, administrator name and email are required." }, 400);
  if (password.length < 10) return json({ error: "Use a password with at least 10 characters." }, 400);
  const existing = await env.DB.prepare("SELECT id FROM company_users WHERE lower(email) = ? LIMIT 1").bind(email).first();
  if (existing) return json({ error: "That email is already linked to a contractor account." }, 409);
  const licenceKey = `SAS-${base64url(crypto.getRandomValues(new Uint8Array(12))).toUpperCase()}`;
  const now = new Date();
  const expiresAt = new Date(now.getTime() + licenceDays * 86400000).toISOString();
  await env.DB.prepare("INSERT INTO companies(name,licence_key,licence_status,expires_at,grace_days,max_users,created_at) VALUES(?,?,?,?,?,?,?)")
    .bind(companyName, licenceKey, "active", expiresAt, 7, 10, now.toISOString()).run();
  const company = await env.DB.prepare("SELECT id FROM companies WHERE licence_key = ? LIMIT 1").bind(licenceKey).first<{ id: number }>();
  if (!company) return json({ error: "Company creation failed." }, 500);
  const salt = toHex(crypto.getRandomValues(new Uint8Array(16)));
  const hash = await passwordHash(password, salt);
  await env.DB.prepare(`INSERT INTO company_users(company_id,email,full_name,role,status,password_hash,password_salt,updated_at,created_at)
    VALUES(?,?,?,?,?,?,?,?,?)`).bind(company.id, email, fullName, role, "active", hash, salt, now.toISOString(), now.toISOString()).run();
  return json({ ok: true, companyId: company.id, companyName, email, licenceKey, expiresAt }, 201);
}

async function contractorData(request: Request, env: ContractorEnv, session: Session, path: string) {
  const method = request.method.toUpperCase();
  const companyId = session.companyId;

  if (path === "/api/contractor/me" && method === "GET") {
    return json({ user: { email: session.email, fullName: session.fullName, role: session.role }, company: { id: companyId, name: session.companyName, licenceStatus: session.licenceStatus, expiresAt: session.companyExpiresAt } });
  }

  if (path === "/api/contractor/dashboard" && method === "GET") {
    const machines = (await env.DB.prepare("SELECT id,fleet_number AS fleetNumber,category,site,status,operating_hours AS operatingHours,availability_target AS availabilityTarget,next_service_hours AS nextServiceHours FROM machines WHERE company_id=? ORDER BY fleet_number LIMIT 1000").bind(companyId).all<Record<string, unknown>>()).results;
    const breakdowns = (await env.DB.prepare("SELECT id,fleet_number AS fleetNumber,severity,system_name AS system,component,description,opened_at AS openedAt,downtime_hours AS downtimeHours,status,action FROM events WHERE company_id=? AND status!='closed' ORDER BY id DESC LIMIT 100").bind(companyId).all<Record<string, unknown>>()).results;
    const workOrders = (await env.DB.prepare("SELECT id,fleet_number AS fleetNumber,title,priority,assigned_to AS assignedTo,due_at AS dueAt,status FROM work_orders WHERE company_id=? AND status NOT IN ('closed','completed') ORDER BY id DESC LIMIT 100").bind(companyId).all<Record<string, unknown>>()).results;
    const production = (await env.DB.prepare("SELECT id,report_date AS reportDate,fleet_number AS fleetNumber,shift_hours AS shiftHours,planned_downtime AS plannedDowntime,unplanned_downtime AS unplannedDowntime,operating_hours AS operatingHours,productive_hours AS productiveHours,tonnes FROM production_records WHERE company_id=? ORDER BY report_date DESC,id DESC LIMIT 200").bind(companyId).all<Record<string, unknown>>()).results;
    const total = machines.length;
    const operating = machines.filter((m) => ["operating", "running", "available"].includes(String(m.status || "").toLowerCase())).length;
    const availability = total ? (operating / total) * 100 : 0;
    const latestDate = production[0]?.reportDate ? String(production[0].reportDate) : null;
    const productionToday = latestDate ? production.filter((r) => String(r.reportDate) === latestDate).reduce((sum, r) => sum + Number(r.tonnes || 0), 0) : 0;
    return json({ metrics: { fleetTotal: total, operating, availability, openBreakdowns: breakdowns.length, openWorkOrders: workOrders.length, productionToday, productionDate: latestDate }, machines, breakdowns, workOrders, production });
  }

  if (path === "/api/contractor/fleet") {
    if (method === "GET") {
      const rows = (await env.DB.prepare("SELECT id,fleet_number AS fleetNumber,category,site,status,operating_hours AS operatingHours,availability_target AS availabilityTarget,next_service_hours AS nextServiceHours,created_at AS createdAt FROM machines WHERE company_id=? ORDER BY fleet_number LIMIT 1000").bind(companyId).all<Record<string, unknown>>()).results;
      return json({ machines: rows });
    }
    if (method === "POST") {
      const body = await request.json().catch(() => ({})) as Record<string, unknown>;
      const fleetNumber = safeText(body.fleetNumber, 60), category = safeText(body.category, 100), site = safeText(body.site || "Unassigned", 100);
      if (!fleetNumber || !category) return json({ error: "Fleet number and machine type are required." }, 400);
      try {
        await env.DB.prepare("INSERT INTO machines(company_id,fleet_number,category,site,status,operating_hours,availability_target,next_service_hours,created_at) VALUES(?,?,?,?,?,?,?,?,?)")
          .bind(companyId, fleetNumber, category, site, safeText(body.status || "operating", 30), Number(body.operatingHours || 0), Number(body.availabilityTarget || 0.9), body.nextServiceHours === "" || body.nextServiceHours == null ? null : Number(body.nextServiceHours), new Date().toISOString()).run();
      } catch { return json({ error: "That fleet number already exists for this company." }, 409); }
      return json({ ok: true }, 201);
    }
  }

  if (path === "/api/contractor/breakdowns") {
    if (method === "GET") {
      const rows = (await env.DB.prepare("SELECT id,fleet_number AS fleetNumber,event_type AS eventType,severity,system_name AS system,component,description,opened_at AS openedAt,closed_at AS closedAt,downtime_hours AS downtimeHours,status,action FROM events WHERE company_id=? ORDER BY id DESC LIMIT 500").bind(companyId).all<Record<string, unknown>>()).results;
      return json({ events: rows });
    }
    if (method === "POST") {
      const b = await request.json().catch(() => ({})) as Record<string, unknown>;
      const fleet = safeText(b.fleetNumber, 60), description = safeText(b.description, 500);
      if (!fleet || !description) return json({ error: "Machine and fault description are required." }, 400);
      const now = new Date().toISOString();
      await env.DB.prepare(`INSERT INTO events(company_id,fleet_number,event_type,severity,system_name,component,description,opened_at,downtime_hours,status,action,spares_status,oil_litres_lost,created_at)
        VALUES(?,?,?,?,?,?,?,?,?,?,?,?,?,?)`).bind(companyId, fleet, safeText(b.eventType || "breakdown", 40), safeText(b.severity || "medium", 30), safeText(b.system || "General", 80), safeText(b.component || "Not confirmed", 100), description, now, Number(b.downtimeHours || 0), "open", safeText(b.action || "Inspection required", 300), "Not assessed", Number(b.oilLitresLost || 0), now).run();
      return json({ ok: true }, 201);
    }
  }

  if (path === "/api/contractor/work-orders") {
    if (method === "GET") {
      const rows = (await env.DB.prepare("SELECT id,fleet_number AS fleetNumber,title,priority,assigned_to AS assignedTo,due_at AS dueAt,status,created_at AS createdAt FROM work_orders WHERE company_id=? ORDER BY id DESC LIMIT 500").bind(companyId).all<Record<string, unknown>>()).results;
      return json({ workOrders: rows });
    }
    if (method === "POST") {
      const b = await request.json().catch(() => ({})) as Record<string, unknown>;
      const fleet = safeText(b.fleetNumber, 60), title = safeText(b.title, 300);
      if (!fleet || !title) return json({ error: "Fleet number and work description are required." }, 400);
      await env.DB.prepare("INSERT INTO work_orders(company_id,fleet_number,title,priority,assigned_to,due_at,status,created_at) VALUES(?,?,?,?,?,?,?,?)")
        .bind(companyId, fleet, title, safeText(b.priority || "medium", 30), safeText(b.assignedTo, 120), safeText(b.dueAt, 40), "open", new Date().toISOString()).run();
      return json({ ok: true }, 201);
    }
  }

  if (path === "/api/contractor/production") {
    if (method === "GET") {
      const rows = (await env.DB.prepare("SELECT id,report_date AS reportDate,fleet_number AS fleetNumber,shift_hours AS shiftHours,planned_downtime AS plannedDowntime,unplanned_downtime AS unplannedDowntime,operating_hours AS operatingHours,productive_hours AS productiveHours,tonnes,source_file AS sourceFile,created_at AS createdAt FROM production_records WHERE company_id=? ORDER BY report_date DESC,id DESC LIMIT 500").bind(companyId).all<Record<string, unknown>>()).results;
      return json({ records: rows });
    }
    if (method === "POST") {
      const b = await request.json().catch(() => ({})) as Record<string, unknown>;
      const date = safeText(b.reportDate || new Date().toISOString().slice(0, 10), 20), fleet = safeText(b.fleetNumber || "Plant", 60);
      await env.DB.prepare(`INSERT INTO production_records(company_id,report_date,fleet_number,shift_hours,planned_downtime,unplanned_downtime,operating_hours,productive_hours,tonnes,source_file,created_at)
        VALUES(?,?,?,?,?,?,?,?,?,?,?)`).bind(companyId, date, fleet, Number(b.shiftHours || 24), Number(b.plannedDowntime || 0), Number(b.unplannedDowntime || 0), Number(b.operatingHours || 0), Number(b.productiveHours || 0), Number(b.tonnes || 0), "contractor live capture", new Date().toISOString()).run();
      return json({ ok: true }, 201);
    }
  }

  if (path === "/api/contractor/documents") {
    if (method === "GET") {
      const rows = (await env.DB.prepare("SELECT id,file_name AS fileName,content_type AS contentType,size_bytes AS sizeBytes,category,created_at AS createdAt FROM contractor_documents WHERE company_id=? ORDER BY id DESC LIMIT 300").bind(companyId).all<Record<string, unknown>>()).results;
      return json({ documents: rows });
    }
    if (method === "POST") {
      if (!env.BUCKET) return json({ error: "R2 storage is not configured." }, 503);
      const form = await request.formData();
      const file = form.get("file");
      if (!(file instanceof File) || !file.size) return json({ error: "Choose a document to upload." }, 400);
      if (file.size > 15_000_000) return json({ error: "Document must be 15 MB or smaller." }, 400);
      const allowed = new Set(["application/pdf","image/png","image/jpeg","application/vnd.openxmlformats-officedocument.wordprocessingml.document","application/vnd.openxmlformats-officedocument.spreadsheetml.sheet","application/vnd.ms-excel","text/csv","application/csv","text/plain"]);
      if (file.type && !allowed.has(file.type)) return json({ error: "Upload PDF, Word, Excel, CSV, TXT, PNG or JPG." }, 400);
      const safeName = file.name.replace(/[^a-zA-Z0-9._-]/g, "-").slice(-140) || "document";
      const key = `companies/${companyId}/documents/${crypto.randomUUID()}-${safeName}`;
      await env.BUCKET.put(key, file.stream(), { httpMetadata: { contentType: file.type || "application/octet-stream" } });
      await env.DB.prepare("INSERT INTO contractor_documents(company_id,uploaded_by,file_name,object_key,content_type,size_bytes,category,created_at) VALUES(?,?,?,?,?,?,?,?)")
        .bind(companyId, session.userId, file.name.slice(0, 240), key, file.type || "application/octet-stream", file.size, safeText(form.get("category") || "general", 60), new Date().toISOString()).run();
      return json({ ok: true }, 201);
    }
  }

  const docMatch = path.match(/^\/api\/contractor\/documents\/(\d+)\/download$/);
  if (docMatch && method === "GET") {
    if (!env.BUCKET) return json({ error: "R2 storage is not configured." }, 503);
    const doc = await env.DB.prepare("SELECT object_key AS objectKey,file_name AS fileName,content_type AS contentType FROM contractor_documents WHERE id=? AND company_id=? LIMIT 1")
      .bind(Number(docMatch[1]), companyId).first<Record<string, unknown>>();
    if (!doc) return json({ error: "Document not found." }, 404);
    const object = await env.BUCKET.get(String(doc.objectKey));
    if (!object) return json({ error: "Stored file not found." }, 404);
    return new Response(object.body, { headers: { "content-type": String(doc.contentType || "application/octet-stream"), "content-disposition": `attachment; filename="${String(doc.fileName).replace(/["\r\n]/g, "-")}"`, "cache-control": "private, no-store" } });
  }

  return null;
}

function loginPage() {
  return `<!doctype html><html><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>Contractor Login | TMM Asset Health</title><style>
  *{box-sizing:border-box}body{margin:0;min-height:100vh;display:grid;place-items:center;background:#08162b;font-family:Arial,sans-serif;padding:20px;color:#14213d}.box{width:min(430px,100%);background:#fff;padding:32px;border-radius:18px;box-shadow:0 25px 70px #0008}.brand{color:#0f3158;font-weight:900}.brand span{display:block;color:#64748b;font-size:12px;margin-top:4px}.tag{margin:18px 0 6px;color:#1369b0;font-size:11px;font-weight:900;letter-spacing:.08em}.box h1{margin:0 0 8px}.box p{color:#64748b;font-size:13px;line-height:1.5}.field{display:grid;gap:7px;margin-top:15px;font-size:12px;font-weight:800}.field input{padding:13px;border:1px solid #cbd5e1;border-radius:9px;font-size:15px}.btn{width:100%;margin-top:20px;border:0;background:#1267b3;color:#fff;padding:13px;border-radius:9px;font-size:15px;font-weight:900;cursor:pointer}.msg{min-height:20px;color:#b91c1c;font-size:12px;margin-top:12px}.demo{margin-top:20px;padding-top:16px;border-top:1px solid #e5e7eb;font-size:12px}.demo a{color:#1267b3;font-weight:800;text-decoration:none}</style></head><body><form class="box" id="login"><div class="brand">TMM Asset Health<span>Sindane Asset Solutions</span></div><div class="tag">CONTRACTOR SECURE ACCESS</div><h1>Sign in to your company workspace</h1><p>Your account is isolated to your contractor company. Fleet, breakdowns, production and documents are never selected by a browser-supplied company ID.</p><label class="field">Email<input name="email" type="email" required autocomplete="username"></label><label class="field">Password<input name="password" type="password" required autocomplete="current-password"></label><button class="btn">Sign in securely</button><div class="msg" id="msg"></div><div class="demo">Need to show the sample first? <a href="/contractor-demo">Open contractor demo</a></div></form><script>
  document.getElementById('login').addEventListener('submit',async(e)=>{e.preventDefault();const f=new FormData(e.currentTarget);const r=await fetch('/api/contractor/login',{method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify({email:f.get('email'),password:f.get('password')})});const j=await r.json().catch(()=>({}));if(r.ok){location.href='/contractor';return}document.getElementById('msg').textContent=j.error||'Sign in failed.'});
  </script></body></html>`;
}

function ownerSetupPage() {
  return `<!doctype html><html><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>Create Contractor Account</title><style>*{box-sizing:border-box}body{margin:0;background:#f4f7fb;color:#14213d;font-family:Arial,sans-serif;padding:28px}.wrap{max-width:760px;margin:auto}.card{background:#fff;border:1px solid #dce5ef;border-radius:16px;padding:25px}h1{margin-top:0}.grid{display:grid;grid-template-columns:1fr 1fr;gap:14px}.field{display:grid;gap:6px;font-size:12px;font-weight:800}.field input,.field select{padding:12px;border:1px solid #cbd5e1;border-radius:8px}.wide{grid-column:1/-1}.btn{border:0;background:#1267b3;color:white;padding:13px 18px;border-radius:9px;font-weight:900;cursor:pointer;margin-top:18px}.msg{white-space:pre-wrap;margin-top:18px;padding:12px;background:#f8fafc;border-radius:8px;font-size:12px}@media(max-width:650px){.grid{grid-template-columns:1fr}.wide{grid-column:auto}}</style></head><body><div class="wrap"><div class="card"><h1>Create contractor company</h1><p>This owner-only setup creates the company, licence and first contractor administrator. The administrator password is hashed before being stored.</p><form id="form" class="grid"><label class="field wide">Sindane owner password<input name="ownerPassword" type="password" required></label><label class="field wide">Company name<input name="companyName" required></label><label class="field">Administrator full name<input name="fullName" required></label><label class="field">Administrator email<input name="email" type="email" required></label><label class="field">Contractor password<input name="password" type="password" minlength="10" required></label><label class="field">Licence days<input name="licenceDays" type="number" min="1" value="30" required></label><label class="field">Role<select name="role"><option value="company_admin">Company Admin</option><option value="engineer">Engineer</option><option value="manager">Manager</option></select></label><div class="wide"><button class="btn">Create live contractor account</button><div id="msg" class="msg">No company created yet.</div></div></form></div></div><script>
  document.getElementById('form').addEventListener('submit',async(e)=>{e.preventDefault();const f=new FormData(e.currentTarget);const payload={companyName:f.get('companyName'),fullName:f.get('fullName'),email:f.get('email'),password:f.get('password'),licenceDays:Number(f.get('licenceDays')),role:f.get('role')};const r=await fetch('/api/admin/contractors',{method:'POST',headers:{'content-type':'application/json','x-admin-password':String(f.get('ownerPassword')||'')},body:JSON.stringify(payload)});const j=await r.json().catch(()=>({}));document.getElementById('msg').textContent=r.ok?`Created: ${j.companyName}\nLogin: ${j.email}\nLicence: ${j.licenceKey}\nExpires: ${j.expiresAt}`:(j.error||'Creation failed.');});
  </script></body></html>`;
}

function contractorAppPage() {
  return `<!doctype html><html><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>Contractor Workspace | TMM Asset Health</title><style>
*{box-sizing:border-box}body{margin:0;background:#f4f7fb;color:#13233c;font-family:Arial,sans-serif}.app{min-height:100vh;display:grid;grid-template-columns:250px 1fr}.side{background:#0b1c33;color:#fff;padding:20px 14px;display:flex;flex-direction:column}.brand{padding:6px 8px 18px;border-bottom:1px solid #233650}.brand b{display:block}.brand small{color:#8da5c4}.company{padding:13px;margin:16px 2px;border:1px solid #29405f;border-radius:10px;background:#112742}.company b,.company small{display:block}.company small{color:#9bb0ca;margin-top:4px}.nav{display:grid;gap:4px}.nav button{border:0;background:transparent;color:#b8c6d8;text-align:left;padding:11px;border-radius:8px;font-weight:800;cursor:pointer}.nav button.active,.nav button:hover{background:#1a3c66;color:white}.bottom{margin-top:auto;font-size:11px;color:#8da5c4}.main{min-width:0}.top{height:82px;background:white;border-bottom:1px solid #dbe4ee;padding:16px 24px;display:flex;align-items:center;justify-content:space-between}.top h1{font-size:22px;margin:2px 0}.top small{color:#7a889e}.actions{display:flex;gap:8px}.actions button{border:1px solid #d5dfeb;background:#fff;padding:9px 11px;border-radius:8px;font-weight:800;cursor:pointer}.content{padding:22px 24px}.hero{background:linear-gradient(120deg,#0f3158,#175886);color:#fff;border-radius:15px;padding:22px 24px}.hero h2{margin:4px 0}.hero p{margin:0;color:#c7daeb;font-size:13px}.metrics{display:grid;grid-template-columns:repeat(5,1fr);gap:12px;margin:14px 0}.metric,.panel{background:#fff;border:1px solid #dde5ee;border-radius:12px}.metric{padding:15px}.metric small{color:#77869a;font-weight:800}.metric b{display:block;font-size:25px;margin:7px 0}.tab{display:none}.tab.active{display:block}.grid{display:grid;grid-template-columns:1.1fr .9fr;gap:14px}.panel{padding:17px}.panel h3{margin:0 0 12px}.table{overflow:auto}table{width:100%;border-collapse:collapse;font-size:12px}th{background:#f7f9fc;text-align:left;padding:10px;color:#64748b;font-size:9px;text-transform:uppercase}td{padding:11px 10px;border-top:1px solid #edf1f5}.form{display:grid;grid-template-columns:repeat(3,1fr);gap:10px;margin-bottom:14px}.form input,.form select{padding:10px;border:1px solid #cbd5e1;border-radius:7px;min-width:0}.form button,.upload button{border:0;background:#1267b3;color:#fff;border-radius:7px;padding:10px;font-weight:800;cursor:pointer}.msg{font-size:11px;color:#9a3412;min-height:16px}.upload{display:flex;gap:10px;align-items:center;flex-wrap:wrap}.empty{padding:18px;color:#7a889e;text-align:center}.pill{display:inline-block;padding:4px 7px;border-radius:999px;background:#edf2f7;font-size:9px;font-weight:800}.good{background:#e2f6eb;color:#177245}.bad{background:#ffe4e4;color:#a82828}.warn{background:#fff0d7;color:#9a5a00}@media(max-width:1050px){.app{grid-template-columns:80px 1fr}.brand small,.company,.bottom{display:none}.nav button{font-size:0;text-align:center}.nav button:before{content:'•';font-size:18px}.metrics{grid-template-columns:repeat(2,1fr)}.grid{grid-template-columns:1fr}}@media(max-width:680px){.app{display:block}.side{display:block}.nav{grid-template-columns:repeat(4,1fr);overflow:auto}.nav button{padding:8px}.top{height:auto;padding:13px 15px}.content{padding:14px}.metrics{grid-template-columns:1fr 1fr}.form{grid-template-columns:1fr}}
</style></head><body><div class="app"><aside class="side"><div class="brand"><b>TMM Asset Health</b><small>Sindane Asset Solutions</small></div><div class="company"><b id="companyName">Company workspace</b><small id="userName">Loading…</small></div><div class="nav"><button class="active" data-tab="dashboard">Dashboard</button><button data-tab="fleet">Fleet</button><button data-tab="breakdowns">Breakdowns</button><button data-tab="maintenance">Maintenance</button><button data-tab="workorders">Work orders</button><button data-tab="production">Production</button><button data-tab="documents">Documents</button><button data-tab="reports">Reports</button></div><div class="bottom">Tenant-isolated D1 + R2 workspace</div></aside><main class="main"><header class="top"><div><small>CONTRACTOR LIVE PORTAL</small><h1 id="title">Operations Dashboard</h1></div><div class="actions"><button onclick="refreshCurrent()">Refresh</button><button onclick="logout()">Sign out</button></div></header><div class="content">
<section id="dashboard" class="tab active"><div class="hero"><small>LIVE COMPANY DATA</small><h2 id="welcome">Contractor workspace</h2><p>Fleet, downtime, maintenance, production and documents are filtered on the server by your signed-in company.</p></div><div class="metrics"><div class="metric"><small>Fleet availability</small><b id="mAvailability">0%</b><span>Live fleet status</span></div><div class="metric"><small>Units operating</small><b id="mOperating">0 / 0</b><span>Current status</span></div><div class="metric"><small>Open breakdowns</small><b id="mBreakdowns">0</b><span>Needs attention</span></div><div class="metric"><small>Open work orders</small><b id="mWorkOrders">0</b><span>Maintenance actions</span></div><div class="metric"><small>Latest production</small><b id="mProduction">0 t</b><span id="mProductionDate">No records</span></div></div><div class="grid"><div class="panel"><h3>Fleet status</h3><div id="dashFleet"></div></div><div class="panel"><h3>Latest breakdowns</h3><div id="dashBreakdowns"></div></div></div></section>
<section id="fleet" class="tab"><div class="panel"><h3>Fleet register</h3><form id="fleetForm" class="form"><input name="fleetNumber" placeholder="Fleet no. e.g. ADT-01" required><input name="category" placeholder="Machine type" required><input name="site" placeholder="Site / section"><input name="operatingHours" type="number" step="0.1" placeholder="Current hours"><input name="nextServiceHours" type="number" step="0.1" placeholder="Next service meter"><button>Add machine</button></form><div id="fleetMsg" class="msg"></div><div id="fleetTable" class="table"></div></div></section>
<section id="breakdowns" class="tab"><div class="panel"><h3>Breakdown register</h3><form id="breakForm" class="form"><input name="fleetNumber" placeholder="Fleet no." required><input name="description" placeholder="Fault description" required><select name="severity"><option>medium</option><option>high</option><option>critical</option><option>low</option></select><input name="system" placeholder="System e.g. Hydraulic"><input name="component" placeholder="Component"><button>Capture breakdown</button></form><div id="breakMsg" class="msg"></div><div id="breakTable" class="table"></div></div></section>
<section id="maintenance" class="tab"><div class="panel"><h3>Maintenance due</h3><p>Calculated from each machine's current hour meter and next service meter.</p><div id="maintenanceTable" class="table"></div></div></section>
<section id="workorders" class="tab"><div class="panel"><h3>Work orders</h3><form id="woForm" class="form"><input name="fleetNumber" placeholder="Fleet no." required><input name="title" placeholder="Work required" required><select name="priority"><option>medium</option><option>high</option><option>critical</option><option>low</option></select><input name="assignedTo" placeholder="Assigned to"><input name="dueAt" type="date"><button>Create work order</button></form><div id="woMsg" class="msg"></div><div id="woTable" class="table"></div></div></section>
<section id="production" class="tab"><div class="panel"><h3>Production records</h3><form id="prodForm" class="form"><input name="reportDate" type="date" required><input name="fleetNumber" placeholder="Fleet / Plant" value="Plant"><input name="tonnes" type="number" step="0.1" placeholder="Tonnes"><input name="operatingHours" type="number" step="0.1" placeholder="Operating hours"><input name="unplannedDowntime" type="number" step="0.1" placeholder="Unplanned downtime"><button>Save production</button></form><div id="prodMsg" class="msg"></div><div id="prodTable" class="table"></div></div></section>
<section id="documents" class="tab"><div class="panel"><h3>Company documents</h3><form id="docForm" class="upload"><input name="file" type="file" required><select name="category"><option value="general">General</option><option value="purchase_order">Purchase order</option><option value="inspection">Inspection</option><option value="oem">OEM / service</option><option value="job_card">Job card</option></select><button>Upload to secure R2</button></form><div id="docMsg" class="msg"></div><div id="docTable" class="table"></div></div></section>
<section id="reports" class="tab"><div class="panel"><h3>Reports</h3><p>The live records in this workspace are ready for daily, weekly, monthly, downtime Pareto and maintenance compliance reports. Report export is the next module after tenant onboarding is verified.</p><button onclick="window.print()">Print current workspace</button></div></section>
</div></main></div><script>
const titles={dashboard:'Operations Dashboard',fleet:'Fleet',breakdowns:'Breakdowns',maintenance:'Maintenance',workorders:'Work orders',production:'Production',documents:'Documents',reports:'Reports'};let current='dashboard';
function esc(v){return String(v??'').replace(/[&<>"']/g,m=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[m]))}function n(v){return Number(v||0)}
async function api(path,opt){const r=await fetch(path,opt);if(r.status===401){location.href='/contractor-login';throw new Error('Sign in required')}const j=await r.json().catch(()=>({}));if(!r.ok)throw new Error(j.error||'Request failed');return j}
function table(headers,rows){if(!rows.length)return '<div class="empty">No records yet.</div>';return '<table><thead><tr>'+headers.map(h=>'<th>'+esc(h[0])+'</th>').join('')+'</tr></thead><tbody>'+rows.map(r=>'<tr>'+headers.map(h=>'<td>'+esc(r[h[1]]??'')+'</td>').join('')+'</tr>').join('')+'</tbody></table>'}
async function me(){const j=await api('/api/contractor/me');document.getElementById('companyName').textContent=j.company.name;document.getElementById('userName').textContent=j.user.fullName+' · '+j.user.role;document.getElementById('welcome').textContent='Welcome, '+j.user.fullName;}
async function dashboard(){const j=await api('/api/contractor/dashboard');const m=j.metrics;document.getElementById('mAvailability').textContent=n(m.availability).toFixed(1)+'%';document.getElementById('mOperating').textContent=m.operating+' / '+m.fleetTotal;document.getElementById('mBreakdowns').textContent=m.openBreakdowns;document.getElementById('mWorkOrders').textContent=m.openWorkOrders;document.getElementById('mProduction').textContent=n(m.productionToday).toLocaleString()+' t';document.getElementById('mProductionDate').textContent=m.productionDate||'No records';document.getElementById('dashFleet').innerHTML=table([['Fleet','fleetNumber'],['Type','category'],['Site','site'],['Status','status']],j.machines.slice(0,8));document.getElementById('dashBreakdowns').innerHTML=table([['Fleet','fleetNumber'],['Severity','severity'],['Fault','description'],['Opened','openedAt']],j.breakdowns.slice(0,8));}
async function fleet(){const j=await api('/api/contractor/fleet');document.getElementById('fleetTable').innerHTML=table([['Fleet','fleetNumber'],['Machine','category'],['Site','site'],['Status','status'],['Hours','operatingHours'],['Next service','nextServiceHours']],j.machines);document.getElementById('maintenanceTable').innerHTML=table([['Fleet','fleetNumber'],['Machine','category'],['Hours','operatingHours'],['Next service','nextServiceHours'],['Due in','dueIn']],j.machines.map(x=>({...x,dueIn:x.nextServiceHours==null?'Not set':(n(x.nextServiceHours)-n(x.operatingHours)).toFixed(1)+' h'})).sort((a,b)=>n(a.nextServiceHours)-n(a.operatingHours)-n(b.nextServiceHours)+n(b.operatingHours)));}
async function breakdowns(){const j=await api('/api/contractor/breakdowns');document.getElementById('breakTable').innerHTML=table([['Fleet','fleetNumber'],['Severity','severity'],['System','system'],['Component','component'],['Description','description'],['Opened','openedAt'],['Status','status']],j.events)}
async function workorders(){const j=await api('/api/contractor/work-orders');document.getElementById('woTable').innerHTML=table([['Fleet','fleetNumber'],['Work','title'],['Priority','priority'],['Assigned','assignedTo'],['Due','dueAt'],['Status','status']],j.workOrders)}
async function production(){const j=await api('/api/contractor/production');document.getElementById('prodTable').innerHTML=table([['Date','reportDate'],['Fleet / Plant','fleetNumber'],['Tonnes','tonnes'],['Operating h','operatingHours'],['Downtime h','unplannedDowntime']],j.records)}
async function documents(){const j=await api('/api/contractor/documents');document.getElementById('docTable').innerHTML=j.documents.length?'<table><thead><tr><th>File</th><th>Category</th><th>Size</th><th>Uploaded</th><th></th></tr></thead><tbody>'+j.documents.map(d=>'<tr><td>'+esc(d.fileName)+'</td><td>'+esc(d.category)+'</td><td>'+Math.round(n(d.sizeBytes)/1024)+' KB</td><td>'+esc(d.createdAt)+'</td><td><a href="/api/contractor/documents/'+d.id+'/download">Download</a></td></tr>').join('')+'</tbody></table>':'<div class="empty">No documents yet.</div>'}
async function load(id){if(id==='dashboard')await dashboard();if(id==='fleet'||id==='maintenance')await fleet();if(id==='breakdowns')await breakdowns();if(id==='workorders')await workorders();if(id==='production')await production();if(id==='documents')await documents()}
function openTab(id){current=id;document.querySelectorAll('.tab').forEach(x=>x.classList.remove('active'));document.querySelectorAll('.nav button').forEach(x=>x.classList.remove('active'));document.getElementById(id).classList.add('active');document.querySelector('[data-tab="'+id+'"]').classList.add('active');document.getElementById('title').textContent=titles[id];load(id).catch(e=>console.error(e))}document.querySelectorAll('.nav button').forEach(b=>b.onclick=()=>openTab(b.dataset.tab));function refreshCurrent(){load(current)}async function logout(){await fetch('/api/contractor/logout',{method:'POST'});location.href='/contractor-login'}
function bindJson(formId,url,msgId,after){document.getElementById(formId).addEventListener('submit',async e=>{e.preventDefault();const f=new FormData(e.currentTarget);const payload=Object.fromEntries(f.entries());try{await api(url,{method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify(payload)});document.getElementById(msgId).textContent='Saved successfully.';e.currentTarget.reset();await after()}catch(err){document.getElementById(msgId).textContent=err.message}})}
bindJson('fleetForm','/api/contractor/fleet','fleetMsg',fleet);bindJson('breakForm','/api/contractor/breakdowns','breakMsg',breakdowns);bindJson('woForm','/api/contractor/work-orders','woMsg',workorders);bindJson('prodForm','/api/contractor/production','prodMsg',production);document.querySelector('#prodForm [name=reportDate]').value=new Date().toISOString().slice(0,10);
document.getElementById('docForm').addEventListener('submit',async e=>{e.preventDefault();try{const r=await fetch('/api/contractor/documents',{method:'POST',body:new FormData(e.currentTarget)});const j=await r.json();if(!r.ok)throw new Error(j.error||'Upload failed');document.getElementById('docMsg').textContent='Uploaded securely.';e.currentTarget.reset();await documents()}catch(err){document.getElementById('docMsg').textContent=err.message}});(async()=>{try{await me();await dashboard()}catch{location.href='/contractor-login'}})();
</script></body></html>`;
}

export async function handleContractorLive(request: Request, env: ContractorEnv): Promise<Response | null> {
  const url = new URL(request.url);
  const path = url.pathname;
  if (!path.startsWith("/contractor") && !path.startsWith("/api/contractor") && path !== "/api/admin/contractors" && path !== "/owner/contractors") return null;
  try {
    await ensureSchema(env);
    if (path === "/contractor-login" || path === "/contractor-login/") {
      const session = await getSession(request, env);
      if (session) return Response.redirect(new URL("/contractor", request.url), 302);
      return html(loginPage());
    }
    if (path === "/owner/contractors" || path === "/owner/contractors/") return html(ownerSetupPage());
    if (path === "/api/admin/contractors" && request.method === "POST") return createContractor(request, env);
    if (path === "/api/contractor/login" && request.method === "POST") return login(request, env);
    if (path === "/api/contractor/logout" && request.method === "POST") return logout(request, env);
    const session = await requireSession(request, env);
    if (!session) {
      if (path === "/contractor" || path === "/contractor/") return Response.redirect(new URL("/contractor-login", request.url), 302);
      return json({ error: "Sign in required." }, 401);
    }
    if (path === "/contractor" || path === "/contractor/") return html(contractorAppPage());
    const response = await contractorData(request, env, session, path);
    return response || json({ error: "Not found." }, 404);
  } catch (error) {
    console.error("CONTRACTOR_LIVE_ERROR", { path, message: error instanceof Error ? error.message : String(error) });
    return path.startsWith("/api/") ? json({ error: "Contractor service error. The event has been logged." }, 500) : html("<h1>Contractor service temporarily unavailable</h1><p>The error has been logged.</p>", 500);
  }
}
