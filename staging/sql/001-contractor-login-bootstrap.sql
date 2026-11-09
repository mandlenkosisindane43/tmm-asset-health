-- Staging-only, additive bootstrap for the existing contractor login.
-- Target: tmm-asset-health-light-staging-db ONLY.
-- Do not apply to production. Does not create accounts or credentials.
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
CREATE TABLE IF NOT EXISTS contractor_accounts (
 id INTEGER PRIMARY KEY AUTOINCREMENT,
 company_id INTEGER NOT NULL,
 email TEXT NOT NULL,
 full_name TEXT NOT NULL,
 role TEXT NOT NULL DEFAULT 'engineer',
 status TEXT NOT NULL DEFAULT 'active',
 password_hash TEXT NOT NULL,
 password_salt TEXT NOT NULL,
 created_at TEXT NOT NULL,
 updated_at TEXT,
 FOREIGN KEY(company_id) REFERENCES companies(id)
);
CREATE UNIQUE INDEX IF NOT EXISTS idx_contractor_accounts_email ON contractor_accounts(email);
CREATE INDEX IF NOT EXISTS idx_contractor_accounts_company ON contractor_accounts(company_id);
