import "./navy.css";
import NcaConsole from "../nca-console";
import { requireChatGPTUser } from "../chatgpt-auth";

export const dynamic = "force-dynamic";

export default async function OperationsPage() {
  const started = Date.now();
  console.log("[operations] authentication start");
  const user = await requireChatGPTUser("/operations");
  console.log("[operations] authentication completed", { elapsedMs: Date.now() - started });

  // Owner profile is optional presentation data. Do not perform a D1 lookup
  // while rendering the initial dashboard; it can be loaded independently.
  console.log("[operations] render console", { elapsedMs: Date.now() - started });
  return <NcaConsole authenticatedUser={user} ownerProfile={null} />;
}
