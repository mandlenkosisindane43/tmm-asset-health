import currentApp from "./router-operational-alerts-sms";

interface ExecutionContext {
  waitUntil(promise: Promise<unknown>): void;
  passThroughOnException(): void;
}
interface ScheduledController {
  scheduledTime: number;
  cron: string;
  noRetry(): void;
}
interface Env {
  DB: D1Database;
  [key: string]: unknown;
}
type Row = Record<string, unknown>;
type AdminSession = {
  companyId: number;
  accountId: number;
  role: string;
};

const COOKIE = "sas_contractor_v2";
const enc = new TextEncoder();

function txt(v: unknown, max = 300) {
  return String(v ?? "").trim().slice(0, max);
}
function num(v: unknown, fallback = 0) {
  const n = Number(v);
  return Number.isFinite(n) ? n : fallback;
}
function lower(v: unknown) {
  return txt(v).toLowerCase();
}
function esc(v: unknown) {
  return String(v ?? "").replace(
    /[&<>"']/g,
    (c) =>
      ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[
        c
      ] || c,
  );
}
function getCookie(req: Request) {
  for (const part of (req.headers.get("cookie") || "").split(";")) {
    const i = part.indexOf("=");
    if (i > -1 && part.slice(0, i).trim() === COOKIE)
      return part.slice(i + 1).trim();
  }
  return "";
}
async function sha256(value: string) {
  return Array.from(
    new Uint8Array(await crypto.subtle.digest("SHA-256", enc.encode(value))),
    (b) => b.toString(16).padStart(2, "0"),
  ).join("");
}
async function first(env: Env, sql: string, binds: unknown[] = []) {
  try {
    return await env.DB.prepare(sql)
      .bind(...binds)
      .first<Row>();
  } catch {
    return null;
  }
}
async function session(req: Request, env: Env): Promise<AdminSession | null> {
  const token = getCookie(req);
  if (!token) return null;
  const row = await first(
    env,
    `SELECT s.company_id AS companyId,s.account_id AS accountId,
      COALESCE(NULLIF(s.active_role,''),a.role) AS role,a.status AS accountStatus,
      s.expires_at AS sessionExpires,c.licence_status AS licenceStatus
     FROM contractor_sessions s
     JOIN contractor_accounts a ON a.id=s.account_id AND a.company_id=s.company_id
     JOIN companies c ON c.id=s.company_id
     WHERE s.token_hash=? LIMIT 1`,
    [await sha256(token)],
  );
  if (!row) return null;
  if (lower(row.accountStatus) !== "active") return null;
  if (new Date(txt(row.sessionExpires)).getTime() < Date.now()) return null;
  if (!["active", "trial"].includes(lower(row.licenceStatus))) return null;
  return {
    companyId: num(row.companyId),
    accountId: num(row.accountId),
    role: lower(row.role),
  };
}
function redirectUsers(message: string, tone = "ok") {
  return new Response(null, {
    status: 303,
    headers: {
      location: `/contractor?view=users&msg=${encodeURIComponent(message)}&tone=${encodeURIComponent(tone)}`,
      "cache-control": "no-store",
    },
  });
}

async function ensureRemovalAudit(env: Env) {
  await env.DB.prepare(
    `CREATE TABLE IF NOT EXISTS removed_company_users_v1 (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      company_id INTEGER NOT NULL,
      former_account_id INTEGER NOT NULL,
      full_name TEXT NOT NULL,
      email TEXT NOT NULL,
      roles TEXT,
      removed_by INTEGER NOT NULL,
      removed_at TEXT NOT NULL
    )`,
  ).run();
  await env.DB.prepare(
    `CREATE INDEX IF NOT EXISTS idx_removed_company_users_company
     ON removed_company_users_v1(company_id,removed_at)`,
  ).run();
}

async function removeUser(req: Request, env: Env) {
  const s = await session(req, env);
  if (!s)
    return new Response(null, {
      status: 303,
      headers: { location: "/contractor-login", "cache-control": "no-store" },
    });
  if (!["company_admin", "admin"].includes(s.role))
    return redirectUsers("Company Administrator authority is required.", "err");

  const form = await req.formData();
  const id = num(form.get("id"));
  if (!id) return redirectUsers("Choose a valid user to remove.", "err");
  if (id === s.accountId)
    return redirectUsers(
      "You cannot permanently remove your own signed-in administrator account.",
      "err",
    );

  const target = await first(
    env,
    `SELECT a.id,a.email,a.full_name AS fullName,a.role,a.status,
      COALESCE((SELECT group_concat(r.role,',') FROM contractor_account_roles_v1 r
        WHERE r.account_id=a.id AND r.company_id=a.company_id),a.role) AS roles
     FROM contractor_accounts a WHERE a.id=? AND a.company_id=? LIMIT 1`,
    [id, s.companyId],
  );
  if (!target) return redirectUsers("User not found.", "err");

  const roles = txt(target.roles || target.role, 500)
    .split(",")
    .map(lower)
    .filter(Boolean);
  const isAdmin = roles.some((r) => ["company_admin", "admin"].includes(r));
  if (isAdmin) {
    const remaining = await first(
      env,
      `SELECT COUNT(DISTINCT a.id) AS n
       FROM contractor_accounts a
       WHERE a.company_id=? AND a.id<>? AND a.status='active'
         AND (a.role IN ('company_admin','admin') OR EXISTS (
           SELECT 1 FROM contractor_account_roles_v1 rr
           WHERE rr.account_id=a.id AND rr.company_id=a.company_id
             AND rr.role IN ('company_admin','admin')
         ))`,
      [s.companyId, id],
    );
    if (num(remaining?.n) < 1)
      return redirectUsers(
        "This is the last active Company Administrator. Assign another administrator before removing this user.",
        "err",
      );
  }

  await ensureRemovalAudit(env);
  const now = new Date().toISOString();
  await env.DB.prepare(
    `INSERT INTO removed_company_users_v1
      (company_id,former_account_id,full_name,email,roles,removed_by,removed_at)
     VALUES(?,?,?,?,?,?,?)`,
  )
    .bind(
      s.companyId,
      id,
      txt(target.fullName, 160),
      lower(target.email),
      roles.join(","),
      s.accountId,
      now,
    )
    .run();

  // Revoke every access path first. Historical reports keep their original
  // numeric created_by references; the removed-user audit table preserves identity.
  await env.DB.prepare(
    "DELETE FROM contractor_sessions WHERE company_id=? AND account_id=?",
  )
    .bind(s.companyId, id)
    .run();
  await env.DB.prepare(
    "DELETE FROM contractor_account_roles_v1 WHERE company_id=? AND account_id=?",
  )
    .bind(s.companyId, id)
    .run();

  const email = lower(target.email);
  if (email) {
    await env.DB.prepare(
      "DELETE FROM alert_contacts_v3 WHERE company_id=? AND lower(email)=?",
    )
      .bind(s.companyId, email)
      .run()
      .catch(() => undefined);
    await env.DB.prepare(
      "DELETE FROM user_invitations_v3 WHERE company_id=? AND lower(email)=?",
    )
      .bind(s.companyId, email)
      .run()
      .catch(() => undefined);
  }

  await env.DB.prepare(
    "DELETE FROM contractor_accounts WHERE id=? AND company_id=?",
  )
    .bind(id, s.companyId)
    .run();

  return redirectUsers(
    `${txt(target.fullName, 120)} was permanently removed. Login, roles, sessions and alert-recipient access were revoked; historical audit records were retained.`,
  );
}

async function enhanceUsersPage(req: Request, env: Env, response: Response) {
  if (req.method !== "GET" || response.status !== 200) return response;
  const url = new URL(req.url);
  if (url.pathname !== "/contractor" || url.searchParams.get("view") !== "users")
    return response;
  if (!(response.headers.get("content-type") || "").includes("text/html"))
    return response;

  const s = await session(req, env);
  if (!s || !["company_admin", "admin"].includes(s.role)) return response;

  let body = await response.text();
  body = body.replace(
    "<th>Status</th><th>Access</th></tr>",
    "<th>Status</th><th>Access</th><th>Remove</th></tr>",
  );

  body = body.replace(
    /(<td><form method="post" action="\/company-admin\/users\/toggle"><input type="hidden" name="id" value="(\d+)">[\s\S]*?<\/form><\/td>)<\/tr>/g,
    (_match, accessCell: string, idRaw: string) => {
      const id = Number(idRaw);
      const remove =
        id === s.accountId
          ? `<td><span style="font-size:10px;color:#6b7780;font-weight:700">Current account</span></td>`
          : `<td><form method="post" action="/company-admin/users/remove" onsubmit="return confirm('Permanently remove this user? Their login, roles, sessions and alert-recipient access will be revoked immediately. Historical records will remain for audit.');"><input type="hidden" name="id" value="${id}"><button class="btn red" type="submit" style="white-space:nowrap">Delete permanently</button></form></td>`;
      return `${accessCell}${remove}</tr>`;
    },
  );

  const note = `<div class="notice" style="margin-bottom:12px"><b>User removal:</b> Use <b>Deactivate</b> for temporary access suspension. Use <b>Delete permanently</b> only when a person has left the company. Permanent removal revokes login, roles, active sessions and matching alert-contact access immediately, while keeping a removal audit record.</div>`;
  const marker = '<div class="pagehead"><div><h1>Users & Roles</h1>';
  if (body.includes(marker)) body = body.replace(marker, `${note}${marker}`);

  return new Response(body, {
    status: response.status,
    headers: response.headers,
  });
}

export default {
  async fetch(req: Request, env: Env, ctx: ExecutionContext): Promise<Response> {
    const path = new URL(req.url).pathname;
    if (req.method === "POST" && path === "/company-admin/users/remove")
      return removeUser(req, env);

    let response = await currentApp.fetch(req, env as never, ctx as never);
    response = await enhanceUsersPage(req, env, response);
    return response;
  },

  async scheduled(
    controller: ScheduledController,
    env: Env,
    ctx: ExecutionContext,
  ) {
    return currentApp.scheduled(controller as never, env as never, ctx as never);
  },
};
