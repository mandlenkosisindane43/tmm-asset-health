import { and, eq } from "drizzle-orm";
import { ensureCoreSchema } from "../../../db/bootstrap";
import { getDb } from "../../../db";
import { machines } from "../../../db/schema";

export async function GET() {
  await ensureCoreSchema();
  return Response.json({ machines: await getDb().select().from(machines).limit(1000) });
}

export async function POST(request: Request) {
  await ensureCoreSchema();
  const body = await request.json() as { companyId?: number; rows?: Record<string, unknown>[] };
  const rows = (body.rows || []).slice(0, 1000);
  if (!rows.length) return Response.json({ error: "No fleet rows supplied" }, { status: 400 });
  const db = getDb();
  const now = new Date().toISOString();
  let imported = 0, skipped = 0;
  for (const row of rows) {
    const fleetNumber = String(row.fleetNumber || row.fleet || row.machine || "").trim();
    const category = String(row.category || row.machineType || row.type || "").trim();
    const site = String(row.site || row.section || "Unassigned").trim();
    if (!fleetNumber || !category) { skipped++; continue; }
    const companyId = Number(body.companyId || 1);
    const duplicate = await db.select({ id: machines.id }).from(machines)
      .where(and(eq(machines.companyId, companyId), eq(machines.fleetNumber, fleetNumber))).limit(1);
    if (duplicate.length) { skipped++; continue; }
    await db.insert(machines).values({
      companyId, fleetNumber, category, site,
      status: String(row.status || "operating"),
      operatingHours: Number(row.operatingHours || row.hours || 0),
      availabilityTarget: Number(row.availabilityTarget || 0.9),
      nextServiceHours: row.nextServiceHours == null ? null : Number(row.nextServiceHours),
      createdAt: now
    });
    imported++;
  }
  return Response.json({ imported, skipped }, { status: 201 });
}
