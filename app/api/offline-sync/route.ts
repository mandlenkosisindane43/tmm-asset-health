import { env } from "cloudflare:workers";
import { getChatGPTUser } from "../../chatgpt-auth";
import { ensureCoreSchema } from "../../../db/bootstrap";

type Entry = { id: string; companyId: number; kind: "production" | "breakdown"; createdAt: string; data: Record<string, unknown> };
const validNumber = (v: unknown) => typeof v === "number" && Number.isFinite(v) && v >= 0;

export async function GET() {
  if (!await getChatGPTUser()) return Response.json({ error: "Sign in to select a company" }, { status: 401 });
  const result = await env.DB.prepare("SELECT id, name FROM companies ORDER BY name").all<{ id: number; name: string }>();
  return Response.json({ companies: result.results });
}

export async function POST(request: Request) {
  if (!await getChatGPTUser()) return Response.json({ error: "Sign in to sync" }, { status: 401 });
  const entry = await request.json().catch(() => null) as Entry | null;
  if (!entry || !/^[a-f0-9-]{36}$/i.test(entry.id) || !Number.isSafeInteger(entry.companyId) || entry.companyId <= 0 || !["production", "breakdown"].includes(entry.kind) || !entry.data || typeof entry.data !== "object")
    return Response.json({ error: "Invalid offline record" }, { status: 400 });
  const d = entry.data;
  const fleet = String(d.fleetNumber || "").trim();
  if (!fleet || fleet.length > 60) return Response.json({ error: "Fleet number is required" }, { status: 400 });
  if (entry.kind === "production" && (!/^\d{4}-\d{2}-\d{2}$/.test(String(d.reportDate)) || !["shiftHours", "plannedDowntime", "unplannedDowntime", "operatingHours", "productiveHours", "tonnes"].every(k => validNumber(d[k])) || Number(d.shiftHours) > 24 || Number(d.shiftHours) <= 0 || Number(d.operatingHours) + Number(d.plannedDowntime) + Number(d.unplannedDowntime) > Number(d.shiftHours)))
    return Response.json({ error: "Invalid production hours or date" }, { status: 400 });
  if (entry.kind === "breakdown" && (!String(d.description || "").trim() || String(d.description).length > 2000 || !String(d.system || "").trim() || String(d.system).length > 100 || !validNumber(d.downtimeHours)))
    return Response.json({ error: "Invalid breakdown record" }, { status: 400 });

  await ensureCoreSchema();
  const company = await env.DB.prepare("SELECT id FROM companies WHERE id = ?").bind(entry.companyId).first();
  if (!company) return Response.json({ error: "Company no longer exists. Keep the local record and contact the owner." }, { status: 409 });
  await env.DB.exec("CREATE TABLE IF NOT EXISTS offline_sync_receipts (client_id TEXT PRIMARY KEY, company_id INTEGER NOT NULL, kind TEXT NOT NULL, received_at TEXT NOT NULL)");
  const existing = await env.DB.prepare("SELECT kind, company_id AS companyId FROM offline_sync_receipts WHERE client_id = ?").bind(entry.id).first<{ kind: string; companyId: number }>();
  if (existing) return existing.kind === entry.kind && existing.companyId === entry.companyId ? Response.json({ synced: true, duplicate: true }) : Response.json({ error: "Conflicting record ID" }, { status: 409 });

  const receipt = env.DB.prepare("INSERT OR IGNORE INTO offline_sync_receipts (client_id, company_id, kind, received_at) VALUES (?, ?, ?, ?)").bind(entry.id, entry.companyId, entry.kind, new Date().toISOString());
  const insert = entry.kind === "production"
    ? env.DB.prepare(`INSERT INTO production_records (company_id, report_date, fleet_number, shift_hours, planned_downtime, unplanned_downtime, operating_hours, productive_hours, tonnes, source_file, created_at)
      SELECT ?, ?, ?, ?, ?, ?, ?, ?, ?, 'offline capture', ? WHERE changes() = 1`).bind(entry.companyId, String(d.reportDate), fleet, d.shiftHours, d.plannedDowntime, d.unplannedDowntime, d.operatingHours, d.productiveHours, d.tonnes, entry.createdAt)
    : env.DB.prepare(`INSERT INTO events (company_id, fleet_number, event_type, severity, system_name, component, description, opened_at, downtime_hours, status, action, spares_status, oil_litres_lost, created_at)
      SELECT ?, ?, 'breakdown', 'medium', ?, 'Not confirmed', ?, ?, ?, 'open', 'Inspection required', 'Not assessed', 0, ? WHERE changes() = 1`).bind(entry.companyId, fleet, String(d.system), String(d.description), entry.createdAt, d.downtimeHours, entry.createdAt);
  await env.DB.batch([receipt, insert]);
  return Response.json({ synced: true });
}
