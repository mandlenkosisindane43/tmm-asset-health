import { requireChatGPTUser } from "../chatgpt-auth";
import ManagementClient from "./management-client";
export const dynamic="force-dynamic";
export default async function ManagementPage(){await requireChatGPTUser("/management");return <ManagementClient/>;}