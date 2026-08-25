import NcaConsole from "./nca-console";
import { requireChatGPTUser } from "./chatgpt-auth";
import { getDb } from "../db";
import { softwareUsers } from "../db/schema";
import { eq } from "drizzle-orm";

export const dynamic = "force-dynamic";

export default async function Home() {
  const user = await requireChatGPTUser("/");
  let owner = null;
  try {
    [owner] = await getDb().select().from(softwareUsers).where(eq(softwareUsers.email,user.email)).limit(1);
  } catch { owner = null; }
  return <NcaConsole authenticatedUser={user} ownerProfile={owner ?? null} />;
}
