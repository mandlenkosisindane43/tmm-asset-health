import { NextResponse } from "next/server";
import { desc } from "drizzle-orm";
import { getChatGPTUser } from "../../chatgpt-auth";
import { getDb } from "../../../db";
import { ensureCoreSchema } from "../../../db/bootstrap";
import { machines, events, productionRecords } from "../../../db/schema";

// Read-only software-owner preview. Do not expose this as a contractor endpoint.
// Contractor access requires explicit company-scoped authorisation.
export async function GET() {
  const user = await getChatGPTUser();
  if (!user) return NextResponse.json({ error: "Unauthorised" }, { status: 401 });
  try {
    await ensureCoreSchema();
    const db = getDb();
    // Separate bounded queries to avoid excessive Cloudflare Worker subrequests.
    const fleet = await db.select({
      id: machines.id, companyId: machines.companyId, fleetNumber: machines.fleetNumber,
      category: machines.category, site: machines.site, status: machines.status,
      operatingHours: machines.operatingHours
    }).from(machines).limit(100);
    const faults = await db.select({
      id: events.id, companyId: events.companyId, fleetNumber: events.fleetNumber,
      severity: events.severity, system: events.system, description: events.description,
      status: events.status, openedAt: events.openedAt
    }).from(events).orderBy(desc(events.id)).limit(30);
    const production = await db.select({
      companyId: productionRecords.companyId, reportDate: productionRecords.reportDate,
      shiftHours: productionRecords.shiftHours, plannedDowntime: productionRecords.plannedDowntime,
      unplannedDowntime: productionRecords.unplannedDowntime,
      operatingHours: productionRecords.operatingHours, productiveHours: productionRecords.productiveHours
    }).from(productionRecords).orderBy(desc(productionRecords.id)).limit(200);
    return NextResponse.json({ fleet, faults, production, source: "existing-records", generatedAt: new Date().toISOString() }, { headers: { "Cache-Control": "private, no-store" } });
  } catch {
    return NextResponse.json({ error: "Fleet records temporarily unavailable" }, { status: 503 });
  }
}
