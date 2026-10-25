import { requireChatGPTUser } from "../chatgpt-auth";
import IndustrialPreview from "./preview";
import "./industrial.css";

export const dynamic = "force-dynamic";

export default async function IndustrialPreviewPage() {
  await requireChatGPTUser("/industrial-preview");
  return <IndustrialPreview />;
}
