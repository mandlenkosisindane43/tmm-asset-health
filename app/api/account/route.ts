import { eq } from "drizzle-orm";
import { getChatGPTUser } from "../../chatgpt-auth";
import { getDb } from "../../../db";
import { softwareUsers } from "../../../db/schema";
import { ensureCoreSchema } from "../../../db/bootstrap";

export async function GET(){
  await ensureCoreSchema();
  const user=await getChatGPTUser();
  if(!user)return Response.json({error:"Sign in required"},{status:401});
  const [profile]=await getDb().select().from(softwareUsers).where(eq(softwareUsers.email,user.email)).limit(1);
  return Response.json({profile:profile??null});
}

export async function POST(request:Request){
  await ensureCoreSchema();
  const user=await getChatGPTUser();
  if(!user)return Response.json({error:"Sign in required"},{status:401});
  const body=await request.json();
  const fullName=String(body.fullName||"").trim(),businessName=String(body.businessName||"").trim(),phone=String(body.phone||"").trim();
  if(!fullName||!businessName)return Response.json({error:"Name and business are required"},{status:400});
  const now=new Date().toISOString();
  const existing=await getDb().select().from(softwareUsers).where(eq(softwareUsers.email,user.email)).limit(1);
  if(existing.length){
    await getDb().update(softwareUsers).set({fullName,businessName,phone,updatedAt:now}).where(eq(softwareUsers.email,user.email));
  }else{
    await getDb().insert(softwareUsers).values({email:user.email,fullName,businessName,phone,role:"software_owner",status:"active",createdAt:now,updatedAt:now});
  }
  const [profile]=await getDb().select().from(softwareUsers).where(eq(softwareUsers.email,user.email)).limit(1);
  return Response.json({profile},{status:existing.length?200:201});
}
