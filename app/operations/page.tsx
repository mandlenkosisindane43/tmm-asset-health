import NcaConsole from "../nca-console";
import { requireChatGPTUser } from "../chatgpt-auth";
import { getDb } from "../../db";
import { softwareUsers } from "../../db/schema";
import { eq } from "drizzle-orm";
import { ensureCoreSchema } from "../../db/bootstrap";

export const dynamic = "force-dynamic";

export default async function OperationsPage() {
  const user = await requireChatGPTUser("/operations");
  await ensureCoreSchema();
  let owner = null;
  try {
    [owner] = await getDb().select().from(softwareUsers).where(eq(softwareUsers.email, user.email)).limit(1);
  } catch {
    owner = null;
  }
  return <NcaConsole authenticatedUser={user} ownerProfile={owner ?? null} />;
}
