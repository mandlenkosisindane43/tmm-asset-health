import NcaConsole from "./nca-console";
import OwnerCommandCentre from "./owner-command-centre";
import { requireChatGPTUser } from "./chatgpt-auth";
import { getDb } from "../db";
import { softwareUsers } from "../db/schema";
import { eq } from "drizzle-orm";
import { ensureCoreSchema } from "../db/bootstrap";

export const dynamic = "force-dynamic";

export default async function Home() {
  const user = await requireChatGPTUser("/");
  await ensureCoreSchema();
  let owner = null;
  try {
    [owner] = await getDb().select().from(softwareUsers).where(eq(softwareUsers.email, user.email)).limit(1);
  } catch {
    owner = null;
  }

  if (!owner) {
    return <NcaConsole authenticatedUser={user} ownerProfile={null} />;
  }

  return (
    <OwnerCommandCentre
      owner={{
        fullName: owner.fullName,
        businessName: owner.businessName,
        email: owner.email,
      }}
    />
  );
}
