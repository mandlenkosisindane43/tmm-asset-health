import { requireChatGPTUser } from "../chatgpt-auth";
import SubscriptionClient from "./subscription-client";

export const dynamic = "force-dynamic";

export default async function SubscriptionPage() {
  const user = await requireChatGPTUser("/subscription");
  return <SubscriptionClient userEmail={user.email} />;
}
