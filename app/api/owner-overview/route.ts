import { NextResponse } from "next/server";
import { env } from "cloudflare:workers";
import { getChatGPTUser } from "../../chatgpt-auth";
import { ensureCoreSchema } from "../../../db/bootstrap";

export async function GET() {
  const user = await getChatGPTUser();
  if (!user) return NextResponse.json({ error: "Unauthorised" }, { status: 401 });
  await ensureCoreSchema();

  const db = env.DB;
  const [companies, activeLicences, pendingLicences, machines, sites, users, quotes, criticalAlerts, recent] = await Promise.all([
    db.prepare("SELECT COUNT(*) AS value FROM subscriptions").first<{ value: number }>(),
    db.prepare("SELECT COUNT(*) AS value FROM subscriptions WHERE licence_status = 'active'").first<{ value: number }>(),
    db.prepare("SELECT COUNT(*) AS value FROM subscriptions WHERE licence_status != 'active'").first<{ value: number }>(),
    db.prepare("SELECT COUNT(*) AS value FROM machines").first<{ value: number }>(),
    db.prepare("SELECT COUNT(DISTINCT site) AS value FROM machines").first<{ value: number }>(),
    db.prepare("SELECT COUNT(*) AS value FROM company_users WHERE status = 'active'").first<{ value: number }>(),
    db.prepare("SELECT COUNT(*) AS value FROM quotations WHERE status IN ('draft','published')").first<{ value: number }>(),
    db.prepare("SELECT COUNT(*) AS value FROM events WHERE severity = 'Critical' AND status = 'open'").first<{ value: number }>(),
    db.prepare(`SELECT id, company_name AS companyName, customer_type AS customerType, plan_name AS planName,
      licence_status AS licenceStatus, status, max_machines AS maxMachines, max_sites AS maxSites,
      contact_email AS contactEmail, updated_at AS updatedAt
      FROM subscriptions ORDER BY updated_at DESC LIMIT 8`).all(),
  ]);

  return NextResponse.json({
    kpis: {
      companies: Number(companies?.value || 0),
      activeLicences: Number(activeLicences?.value || 0),
      pendingLicences: Number(pendingLicences?.value || 0),
      machines: Number(machines?.value || 0),
      sites: Number(sites?.value || 0),
      users: Number(users?.value || 0),
      commercialActions: Number(quotes?.value || 0),
      criticalAlerts: Number(criticalAlerts?.value || 0),
    },
    companies: recent.results || [],
  });
}
