import { NextRequest, NextResponse } from "next/server";
import { and, desc, eq } from "drizzle-orm";
import { getChatGPTUser } from "../../chatgpt-auth";
import { getDb } from "../../../db";
import { companyUsers, softwareUsers, machines, events, productionRecords } from "../../../db/schema";

// Authenticated, read-only, company-scoped dashboard API.
// The Cloudflare binding determines the database: staging NEVER reaches production.
// No schema bootstrap, writes, credential forwarding, or cross-origin production fetch.
export async function GET(request: NextRequest) {
  const user = await getChatGPTUser();
  if (!user) return NextResponse.json({ error: "Sign in required" }, { status: 401 });
  const raw = request.nextUrl.searchParams.get("companyId");
  const companyId = Number(raw);
  if (!raw || !Number.isSafeInteger(companyId) || companyId <= 0)
    return NextResponse.json({ error: "A valid companyId is required" }, { status: 400 });

  try {
    const db = getDb();
    const [owner] = await db.select({ role: softwareUsers.role, status: softwareUsers.status })
      .from(softwareUsers).where(eq(softwareUsers.email, user.email)).limit(1);
    const isOwner = owner?.role === "software_owner" && owner.status === "active";
    if (!isOwner) {
      const [member] = await db.select({ role: companyUsers.role })
        .from(companyUsers).where(and(
          eq(companyUsers.email, user.email),
          eq(companyUsers.companyId, companyId),
          eq(companyUsers.status, "active")
        )).limit(1);
      if (!member || !["admin", "engineer"].includes(member.role.toLowerCase()))
        return NextResponse.json({ error: "Access denied for this company" }, { status: 403 });
    }

    const fleet = await db.select({
      id: machines.id, companyId: machines.companyId, fleetNumber: machines.fleetNumber,
      category: machines.category, site: machines.site, status: machines.status,
      operatingHours: machines.operatingHours, nextServiceHours: machines.nextServiceHours
    }).from(machines).where(eq(machines.companyId, companyId)).limit(100);
    const faults = await db.select({
      id: events.id, companyId: events.companyId, fleetNumber: events.fleetNumber,
      severity: events.severity, system: events.system, description: events.description,
      status: events.status, openedAt: events.openedAt, downtimeHours: events.downtimeHours
    }).from(events).where(eq(events.companyId, companyId)).orderBy(desc(events.id)).limit(100);
    const production = await db.select({
      companyId: productionRecords.companyId, reportDate: productionRecords.reportDate,
      shiftHours: productionRecords.shiftHours, plannedDowntime: productionRecords.plannedDowntime,
      unplannedDowntime: productionRecords.unplannedDowntime, operatingHours: productionRecords.operatingHours,
      productiveHours: productionRecords.productiveHours, tonnes: productionRecords.tonnes
    }).from(productionRecords).where(eq(productionRecords.companyId, companyId))
      .orderBy(desc(productionRecords.id)).limit(200);
    return NextResponse.json({
      fleet, faults, production, companyId, source: "company-scoped-stored-records",
      generatedAt: new Date().toISOString(), limits: { fleet: 100, faults: 100, production: 200 }
    }, { headers: { "Cache-Control": "private, no-store" } });
  } catch {
    return NextResponse.json({ error: "Company records unavailable in this environment" }, { status: 503 });
  }
}
