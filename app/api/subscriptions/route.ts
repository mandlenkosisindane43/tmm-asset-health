import { NextResponse } from "next/server";
import { desc, eq } from "drizzle-orm";
import { getChatGPTUser } from "../../chatgpt-auth";
import { ensureCoreSchema } from "../../../db/bootstrap";
import { getDb } from "../../../db";
import { subscriptions } from "../../../db/schema";

const PLAN_LIMITS: Record<string, { maxMachines: number; maxSites: number; monthlyAmount: number; implementationFee: number }> = {
  "Contractor Starter": { maxMachines: 10, maxSites: 1, monthlyAmount: 3500, implementationFee: 5000 },
  "Contractor Multi-Site": { maxMachines: 20, maxSites: 3, monthlyAmount: 7500, implementationFee: 6500 },
  "Mine Standard": { maxMachines: 25, maxSites: 1, monthlyAmount: 16500, implementationFee: 20000 },
  "Mine Plus": { maxMachines: 40, maxSites: 1, monthlyAmount: 22000, implementationFee: 25000 },
  "Mine Enterprise": { maxMachines: 60, maxSites: 2, monthlyAmount: 32000, implementationFee: 35000 },
  "Enterprise+": { maxMachines: 9999, maxSites: 9999, monthlyAmount: 40000, implementationFee: 0 },
};

function licenceKey(companyName: string) {
  const prefix = companyName.toUpperCase().replace(/[^A-Z0-9]/g, "").slice(0, 4).padEnd(4, "X");
  return `SAS-${prefix}-${crypto.randomUUID().slice(0, 8).toUpperCase()}`;
}

export async function GET() {
  const user = await getChatGPTUser();
  if (!user) return NextResponse.json({ error: "Unauthorised" }, { status: 401 });
  await ensureCoreSchema();
  const rows = await getDb().select().from(subscriptions).orderBy(desc(subscriptions.updatedAt)).limit(100);
  return NextResponse.json({ subscriptions: rows });
}

export async function POST(request: Request) {
  const user = await getChatGPTUser();
  if (!user) return NextResponse.json({ error: "Unauthorised" }, { status: 401 });
  await ensureCoreSchema();

  const body = await request.json().catch(() => ({}));
  const companyName = String(body.companyName || "").trim();
  const customerType = String(body.customerType || "").trim();
  const planName = String(body.planName || "").trim();
  const contactEmail = String(body.contactEmail || "").trim();
  const plan = PLAN_LIMITS[planName];

  if (!companyName || !["Contractor", "Mine"].includes(customerType) || !plan) {
    return NextResponse.json({ error: "Complete the company, customer type and package." }, { status: 400 });
  }

  if ((customerType === "Contractor" && planName.startsWith("Mine")) || (customerType === "Mine" && planName.startsWith("Contractor"))) {
    return NextResponse.json({ error: "The selected package does not match the customer type." }, { status: 400 });
  }

  const now = new Date().toISOString();
  const billingCycle = "Monthly";
  const amount = plan.monthlyAmount;
  const [existing] = await getDb().select().from(subscriptions).where(eq(subscriptions.companyName, companyName)).limit(1);

  if (existing) {
    await getDb().update(subscriptions).set({
      customerType,
      planName,
      billingCycle,
      contactEmail: contactEmail || existing.contactEmail,
      maxMachines: plan.maxMachines,
      maxSites: plan.maxSites,
      subscriptionAmount: amount,
      implementationFee: plan.implementationFee,
      status: "pending_approval",
      updatedBy: user.email,
      updatedAt: now,
    }).where(eq(subscriptions.id, existing.id));
  } else {
    await getDb().insert(subscriptions).values({
      companyName,
      customerType,
      planName,
      billingCycle,
      contactEmail: contactEmail || null,
      licenceKey: licenceKey(companyName),
      licenceStatus: "pending_payment",
      status: "pending_approval",
      maxMachines: plan.maxMachines,
      maxSites: plan.maxSites,
      subscriptionAmount: amount,
      implementationFee: plan.implementationFee,
      createdBy: user.email,
      updatedBy: user.email,
      createdAt: now,
      updatedAt: now,
    });
  }

  const [saved] = await getDb().select().from(subscriptions).where(eq(subscriptions.companyName, companyName)).limit(1);
  return NextResponse.json({ subscription: saved });
}

export async function PATCH(request: Request) {
  const user = await getChatGPTUser();
  if (!user) return NextResponse.json({ error: "Unauthorised" }, { status: 401 });
  await ensureCoreSchema();

  const body = await request.json().catch(() => ({}));
  const id = Number(body.id || 0);
  const status = String(body.status || "");
  const licenceStatus = String(body.licenceStatus || "");

  if (!id || !["pending_approval", "approved", "active", "suspended"].includes(status) || !["pending_payment", "active", "grace", "read_only", "suspended"].includes(licenceStatus)) {
    return NextResponse.json({ error: "Invalid subscription update." }, { status: 400 });
  }

  await getDb().update(subscriptions).set({
    status,
    licenceStatus,
    updatedBy: user.email,
    updatedAt: new Date().toISOString(),
  }).where(eq(subscriptions.id, id));

  const [saved] = await getDb().select().from(subscriptions).where(eq(subscriptions.id, id)).limit(1);
  return NextResponse.json({ subscription: saved });
}
