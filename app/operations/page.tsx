import "./navy.css";
import NcaConsole from "../nca-console";
import { requireChatGPTUser } from "../chatgpt-auth";
import { getDb } from "../../db";
import { softwareUsers } from "../../db/schema";
import { eq } from "drizzle-orm";

export const dynamic = "force-dynamic";

export default async function OperationsPage() {
  console.log("[operations] authentication start");
  const user = await requireChatGPTUser("/operations");
  console.log("[operations] authentication completed");
  let owner = null;
  try {
    [owner] = await getDb().select().from(softwareUsers).where(eq(softwareUsers.email, user.email)).limit(1);
    console.log("[operations] owner lookup completed");
  } catch (error) {
    console.error("[operations] owner lookup failed", error);
    owner = null;
  }
  return <NcaConsole authenticatedUser={user} ownerProfile={owner ?? null} />;
}
