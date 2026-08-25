import { eq } from "drizzle-orm";
import { getChatGPTUser } from "../../chatgpt-auth";
import { getDb } from "../../../db";
import { softwareUsers } from "../../../db/schema";
import { emailConfigured, sendTmmEmail } from "../../../lib/resend-email";
async function owner(){const user=await getChatGPTUser();if(!user)return null;const[profile]=await getDb().select().from(softwareUsers).where(eq(softwareUsers.email,user.email)).limit(1);return profile?.role==="software_owner"?user:null}
export async function GET(){const user=await owner();if(!user)return Response.json({error:"Owner access required"},{status:403});return Response.json({configured:emailConfigured(),sender:"notifications@sindaneassetsolutions.co.za"})}
export async function POST(){const user=await owner();if(!user)return Response.json({error:"Owner access required"},{status:403});const result=await sendTmmEmail({to:user.email,subject:"TMM Asset Health email connection test",html:`<div style="font-family:Arial,sans-serif;max-width:600px;margin:auto;padding:32px"><h1 style="color:#176b58">Email connection successful</h1><p>TMM Asset Health can now send secure system emails through Sindane Asset Solutions.</p><p><strong>Sender:</strong> notifications@sindaneassetsolutions.co.za</p><p>Track. Prevent. Perform.</p></div>`});return Response.json(result,{status:result.sent?200:503})}
