import OwnerCommandCentre from "./owner-command-centre";
import { requireChatGPTUser } from "./chatgpt-auth";
import { getDb } from "../db";
import { softwareUsers } from "../db/schema";
import { eq } from "drizzle-orm";
import { ensureCoreSchema } from "../db/bootstrap";

export const dynamic = "force-dynamic";

export default async function Home() {
  const user = await requireChatGPTUser("/");

  let owner = null;
  try {
    await ensureCoreSchema();
    [owner] = await getDb().select().from(softwareUsers).where(eq(softwareUsers.email, user.email)).limit(1);
  } catch {
    owner = null;
  }

  return (
    <OwnerCommandCentre
      owner={{
        fullName: owner?.fullName || user.fullName || "Mandlenkosi Sindane",
        businessName: owner?.businessName || "Sindane Asset Solutions",
        email: owner?.email || user.email,
      }}
    />
  );
}
