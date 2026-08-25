import { desc, eq } from "drizzle-orm";
import { getChatGPTUser } from "../../chatgpt-auth";
import { getDb } from "../../../db";
import { companyInvitations, softwareUsers } from "../../../db/schema";
import { invitationEmail, sendTmmEmail } from "../../../lib/resend-email";

async function ownerEmail(){
  const user=await getChatGPTUser(); if(!user)return null;
  const [profile]=await getDb().select().from(softwareUsers).where(eq(softwareUsers.email,user.email)).limit(1);
  return profile?.role==="software_owner"?user.email:null;
}
export async function GET(){
  const email=await ownerEmail(); if(!email)return Response.json({error:"Owner access required"},{status:403});
  return Response.json({invitations:await getDb().select().from(companyInvitations).orderBy(desc(companyInvitations.id)).limit(100)});
}
export async function POST(request:Request){
  const invitedBy=await ownerEmail(); if(!invitedBy)return Response.json({error:"Owner access required"},{status:403});
  const body=await request.json(); const email=String(body.email||"").trim().toLowerCase(),fullName=String(body.fullName||"").trim(),role=String(body.role||"").trim();
  if(!email||!fullName||!role)return Response.json({error:"Complete all required fields"},{status:400});
  const now=new Date(),expires=new Date(now.getTime()+7*86400000),inviteCode=crypto.randomUUID();
  const [invitation]=await getDb().insert(companyInvitations).values({companyId:Number(body.companyId||1),email,fullName,role,inviteCode,invitedBy,status:"pending",expiresAt:expires.toISOString(),createdAt:now.toISOString()}).returning();
  const origin=new URL(request.url).origin,invitePath=`/?invite=${inviteCode}`;
  const delivery=await sendTmmEmail({to:email,subject:"You are invited to TMM Asset Health",html:invitationEmail({fullName,role,invitedBy,inviteUrl:`${origin}${invitePath}`,expiresAt:expires.toISOString()})});
  return Response.json({invitation,invitePath,delivery},{status:201});
}
