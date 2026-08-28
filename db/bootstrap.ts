import { env } from "cloudflare:workers";

let ready: Promise<void> | null = null;

export function ensureCoreSchema(): Promise<void> {
  if (!ready) ready = env.DB.exec(`
    CREATE TABLE IF NOT EXISTS software_users (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      email TEXT NOT NULL UNIQUE,
      full_name TEXT NOT NULL,
      business_name TEXT NOT NULL,
      phone TEXT,
      role TEXT NOT NULL DEFAULT 'software_owner',
      status TEXT NOT NULL DEFAULT 'active',
      created_at TEXT NOT NULL,
      updated_at TEXT NOT NULL
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
    CREATE UNIQUE INDEX IF NOT EXISTS machines_company_fleet
      ON machines(company_id, fleet_number);
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
    CREATE TABLE IF NOT EXISTS purchase_orders (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      company_id INTEGER NOT NULL,
      order_number TEXT NOT NULL,
      document_type TEXT NOT NULL DEFAULT 'purchase_order',
      supplier TEXT NOT NULL,
      store_contact TEXT,
      fleet_number TEXT,
      description TEXT NOT NULL,
      amount REAL NOT NULL DEFAULT 0,
      order_date TEXT NOT NULL,
      expected_delivery TEXT,
      actual_delivery TEXT,
      payment_status TEXT NOT NULL DEFAULT 'not_paid',
      order_status TEXT NOT NULL DEFAULT 'quotation_requested',
      attachment_key TEXT,
      attachment_name TEXT,
      responsible_person TEXT,
      reminder_email INTEGER NOT NULL DEFAULT 1,
      reminder_sms INTEGER NOT NULL DEFAULT 0,
      next_reminder_at TEXT,
      notes TEXT,
      created_at TEXT NOT NULL,
      updated_at TEXT NOT NULL
    );
  `).then(() => undefined).catch((error) => {
    ready = null;
    throw error;
  });
  return ready;
}
