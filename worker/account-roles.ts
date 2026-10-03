export const ACCOUNT_ROLES = ["company_admin", "engineer"] as const;
export type AccountRole = typeof ACCOUNT_ROLES[number];

type RoleEnv = { DB: D1Database };

export function validRoles(values: unknown[]): AccountRole[] {
  const allowed = new Set<string>(ACCOUNT_ROLES);
  return [...new Set(values.map(v => String(v ?? "").trim().toLowerCase()).filter(v => allowed.has(v)))] as AccountRole[];
}

export function roleLabel(role: string) {
  return ({
    company_admin: "Company Administrator",
    engineer: "Engineer",
  } as Record<string, string>)[role] || role.replace(/_/g, " ");
}

export const TWO_ROLE_MIGRATION_SQL = [
  "UPDATE contractor_accounts SET role='company_admin' WHERE role='admin'",
  "UPDATE contractor_accounts SET role='engineer' WHERE role IN ('manager','supervisor','mechanic')",
  `INSERT OR IGNORE INTO contractor_account_roles_v1(account_id,company_id,role,created_at)
   SELECT account_id,company_id,CASE WHEN role='admin' THEN 'company_admin' ELSE 'engineer' END,created_at
   FROM contractor_account_roles_v1 WHERE role IN ('admin','manager','supervisor','mechanic')`,
  "DELETE FROM contractor_account_roles_v1 WHERE role IN ('admin','manager','supervisor','mechanic')",
  "UPDATE contractor_sessions SET active_role='company_admin' WHERE active_role='admin'",
  "UPDATE contractor_sessions SET active_role='engineer' WHERE active_role IN ('manager','supervisor','mechanic')",
];
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
    if (accountsTable) {
      await env.DB.prepare("CREATE TABLE IF NOT EXISTS account_role_migrations_v1 (name TEXT PRIMARY KEY, applied_at TEXT NOT NULL)").run();
      const applied = await env.DB.prepare("SELECT name FROM account_role_migrations_v1 WHERE name='admin-engineer-only'").first();
      if (!applied) {
        const statements = TWO_ROLE_MIGRATION_SQL.map(sql => env.DB.prepare(sql));
        const invitations = await env.DB.prepare("SELECT name FROM sqlite_master WHERE type='table' AND name='user_invitations_v3'").first();
        if (invitations) statements.push(env.DB.prepare("UPDATE user_invitations_v3 SET role='engineer' WHERE role IN ('manager','supervisor','mechanic')"));
        statements.push(env.DB.prepare("INSERT OR IGNORE INTO account_role_migrations_v1(name,applied_at) VALUES('admin-engineer-only',datetime('now'))"));
        await env.DB.batch(statements);
      }
    }
  })().catch(error => { ready = null; throw error; });
  return ready;
}

export async function rolesForAccount(env: RoleEnv, accountId: number, companyId: number) {
  await ensureAccountRoles(env);
  const rows = await env.DB.prepare("SELECT role FROM contractor_account_roles_v1 WHERE account_id=? AND company_id=? ORDER BY CASE role WHEN 'company_admin' THEN 1 ELSE 2 END")
    .bind(accountId, companyId).all<Record<string, unknown>>();
  return validRoles((rows.results || []).map(row => row.role));
}

export async function replaceAccountRoles(env: RoleEnv, accountId: number, companyId: number, roles: AccountRole[]) {
  if (!roles.length || validRoles(roles).length !== roles.length) throw new Error("Select Company Administrator or Engineer.");
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
