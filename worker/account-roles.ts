export const ACCOUNT_ROLES = ["company_admin", "manager", "engineer", "supervisor", "mechanic"] as const;
export type AccountRole = typeof ACCOUNT_ROLES[number];

type RoleEnv = { DB: D1Database };

export function validRoles(values: unknown[]): AccountRole[] {
  const allowed = new Set<string>(ACCOUNT_ROLES);
  return [...new Set(values.map(v => String(v ?? "").trim().toLowerCase()).filter(v => allowed.has(v)))] as AccountRole[];
}

export function roleLabel(role: string) {
  return ({
    company_admin: "Company Administrator",
    manager: "Mine Manager",
    engineer: "Engineer",
    supervisor: "Supervisor",
    mechanic: "Mechanic",
  } as Record<string, string>)[role] || role.replace(/_/g, " ");
}

let ready: Promise<void> | null = null;
export async function ensureAccountRoles(env: RoleEnv) {
  if (ready) return ready;
  ready = (async () => {
    await env.DB.prepare(`CREATE TABLE IF NOT EXISTS contractor_account_roles_v1 (
      account_id INTEGER NOT NULL,
      company_id INTEGER NOT NULL,
      role TEXT NOT NULL,
      created_at TEXT NOT NULL,
      PRIMARY KEY(account_id,role)
    )`).run();
    await env.DB.prepare("CREATE INDEX IF NOT EXISTS idx_account_roles_company ON contractor_account_roles_v1(company_id,account_id)").run();
    const accountsTable = await env.DB.prepare("SELECT name FROM sqlite_master WHERE type='table' AND name='contractor_accounts'").first<Record<string, unknown>>();
    if (accountsTable) await env.DB.prepare(`INSERT OR IGNORE INTO contractor_account_roles_v1(account_id,company_id,role,created_at)
      SELECT id,company_id,role,COALESCE(created_at,datetime('now')) FROM contractor_accounts`).run();
    await env.DB.prepare(`CREATE TABLE IF NOT EXISTS contractor_sessions (
      token_hash TEXT PRIMARY KEY,company_id INTEGER NOT NULL,account_id INTEGER NOT NULL,
      expires_at TEXT NOT NULL,created_at TEXT NOT NULL,active_role TEXT
    )`).run();
    const info = await env.DB.prepare("PRAGMA table_info(contractor_sessions)").all<Record<string, unknown>>();
    if (!(info.results || []).some(row => String(row.name) === "active_role")) {
      await env.DB.prepare("ALTER TABLE contractor_sessions ADD COLUMN active_role TEXT").run();
    }
  })().catch(error => { ready = null; throw error; });
  return ready;
}

export async function rolesForAccount(env: RoleEnv, accountId: number, companyId: number) {
  await ensureAccountRoles(env);
  const rows = await env.DB.prepare("SELECT role FROM contractor_account_roles_v1 WHERE account_id=? AND company_id=? ORDER BY CASE role WHEN 'company_admin' THEN 1 WHEN 'manager' THEN 2 WHEN 'engineer' THEN 3 WHEN 'supervisor' THEN 4 ELSE 5 END")
    .bind(accountId, companyId).all<Record<string, unknown>>();
  return validRoles((rows.results || []).map(row => row.role));
}

export async function replaceAccountRoles(env: RoleEnv, accountId: number, companyId: number, roles: AccountRole[]) {
  if (!roles.length) throw new Error("Select at least one role.");
  await ensureAccountRoles(env);
  const now = new Date().toISOString();
  await env.DB.prepare("DELETE FROM contractor_account_roles_v1 WHERE account_id=? AND company_id=?").bind(accountId, companyId).run();
  for (const role of roles) {
    await env.DB.prepare("INSERT INTO contractor_account_roles_v1(account_id,company_id,role,created_at) VALUES(?,?,?,?)").bind(accountId, companyId, role, now).run();
  }
  await env.DB.prepare("UPDATE contractor_accounts SET role=?,updated_at=? WHERE id=? AND company_id=?").bind(roles[0], now, accountId, companyId).run();
  await env.DB.prepare(`UPDATE contractor_sessions SET active_role=? WHERE account_id=? AND company_id=?
    AND (active_role IS NULL OR active_role='' OR active_role NOT IN (${roles.map(() => "?").join(",")}))`)
    .bind(roles[0], accountId, companyId, ...roles).run();
}
