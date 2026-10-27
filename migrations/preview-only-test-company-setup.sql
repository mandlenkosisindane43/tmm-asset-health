-- TMM Asset Health: PREVIEW DATABASE ONLY
-- Target: tmm-asset-health-preview-db. NEVER run against production.
-- This creates the minimum schema used by preview login and read-only fleet bridge.
-- Existing tables are not dropped, modified or replaced.
PRAGMA foreign_keys = ON;
CREATE TABLE IF NOT EXISTS companies (
 id INTEGER PRIMARY KEY AUTOINCREMENT,
 name TEXT NOT NULL,
 licence_key TEXT NOT NULL UNIQUE,
 licence_status TEXT NOT NULL DEFAULT 'trial',
 expires_at TEXT NOT NULL,
 grace_days INTEGER NOT NULL DEFAULT 0,
 max_users INTEGER NOT NULL DEFAULT 5,
 created_at TEXT NOT NULL
);
CREATE TABLE IF NOT EXISTS contractor_accounts (
 id INTEGER PRIMARY KEY AUTOINCREMENT,
 company_id INTEGER NOT NULL,
 email TEXT NOT NULL UNIQUE,
 full_name TEXT NOT NULL,
 role TEXT NOT NULL DEFAULT 'engineer',
 status TEXT NOT NULL DEFAULT 'pending',
 password_hash TEXT NOT NULL,
 password_salt TEXT NOT NULL,
 created_at TEXT NOT NULL,
 updated_at TEXT NOT NULL,
 FOREIGN KEY(company_id) REFERENCES companies(id)
);
CREATE TABLE IF NOT EXISTS machines (
 id INTEGER PRIMARY KEY AUTOINCREMENT,
 company_id INTEGER NOT NULL,
 fleet_number TEXT NOT NULL,
 category TEXT NOT NULL DEFAULT '',
 site TEXT NOT NULL DEFAULT '',
 status TEXT NOT NULL DEFAULT 'Unknown',
 operating_hours REAL NOT NULL DEFAULT 0,
 next_service_hours REAL,
 UNIQUE(company_id,fleet_number),
 FOREIGN KEY(company_id) REFERENCES companies(id)
);
-- The existing contractor_sessions table is intentionally preserved.
-- No user/password rows are inserted: create credentials via the app's secure account workflow.
INSERT INTO companies(name,licence_key,licence_status,expires_at,grace_days,max_users,created_at)
SELECT 'TMM Preview Test Mine','TMM-PREVIEW-TEST-ONLY-2026','trial','2030-12-31T23:59:59.000Z',0,5,strftime('%Y-%m-%dT%H:%M:%fZ','now')
WHERE NOT EXISTS(SELECT 1 FROM companies WHERE licence_key='TMM-PREVIEW-TEST-ONLY-2026');
INSERT OR IGNORE INTO machines(company_id,fleet_number,category,site,status,operating_hours,next_service_hours)
SELECT id,'EX-101','Excavator','Preview Test Site','Operating',4820,5000 FROM companies WHERE licence_key='TMM-PREVIEW-TEST-ONLY-2026';
INSERT OR IGNORE INTO machines(company_id,fleet_number,category,site,status,operating_hours,next_service_hours)
SELECT id,'ADT-201','Articulated dump truck','Preview Test Site','Operating',3288,3500 FROM companies WHERE licence_key='TMM-PREVIEW-TEST-ONLY-2026';
INSERT OR IGNORE INTO machines(company_id,fleet_number,category,site,status,operating_hours,next_service_hours)
SELECT id,'LD-302','Wheel loader','Preview Test Site','Unavailable',5490,5500 FROM companies WHERE licence_key='TMM-PREVIEW-TEST-ONLY-2026';
-- Verification (safe, read-only):
SELECT name FROM sqlite_master WHERE type='table' AND name IN ('companies','contractor_accounts','contractor_sessions','machines') ORDER BY name;
SELECT c.name,m.fleet_number,m.category,m.status FROM machines m JOIN companies c ON c.id=m.company_id WHERE c.licence_key='TMM-PREVIEW-TEST-ONLY-2026' ORDER BY m.fleet_number;
