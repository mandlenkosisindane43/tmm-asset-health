const RESEND_ENDPOINT = "https://api.resend.com/emails";
const FROM = "TMM Asset Health <notifications@sindaneassetsolutions.co.za>";
export function emailConfigured() { return Boolean(process.env.RESEND_API_KEY); }
export async function sendTmmEmail(input: {to:string|string[];subject:string;html:string;replyTo?:string}) {
  const apiKey=process.env.RESEND_API_KEY;
  if(!apiKey)return {sent:false,error:"Email service is not configured"};
  const response=await fetch(RESEND_ENDPOINT,{method:"POST",headers:{authorization:`Bearer ${apiKey}`,"content-type":"application/json"},body:JSON.stringify({from:FROM,to:Array.isArray(input.to)?input.to:[input.to],subject:input.subject,html:input.html,reply_to:input.replyTo??"admin@sindaneassetsolutions.co.za"})});
  const result=await response.json().catch(()=>({})) as {id?:string;message?:string};
  if(!response.ok)return {sent:false,error:result.message??"Email provider rejected the request"};
  return {sent:true,id:result.id??null};
}
export function invitationEmail(input:{fullName:string;role:string;invitedBy:string;inviteUrl:string;expiresAt:string}) {
  return `<!doctype html><html><body style="margin:0;background:#f3f6f4;font-family:Arial,sans-serif;color:#17231f"><table width="100%" cellpadding="0" cellspacing="0"><tr><td align="center" style="padding:34px 16px"><table width="600" cellpadding="0" cellspacing="0" style="max-width:600px;background:#fff;border-radius:14px;overflow:hidden"><tr><td style="background:#142b27;padding:26px 32px;color:#fff"><div style="font-size:12px;letter-spacing:2px;color:#d8b174">SINDANE ASSET SOLUTIONS</div><h1 style="margin:8px 0 0;font-size:25px">TMM Asset Health</h1></td></tr><tr><td style="padding:32px"><h2>You have been invited</h2><p>Hello ${input.fullName},</p><p style="line-height:1.65;color:#56645f">You have been invited to TMM Asset Health as <strong>${input.role}</strong>. Your access will be limited to the assigned company workspace and role permissions.</p><p style="margin:28px 0"><a href="${input.inviteUrl}" style="display:inline-block;background:#176b58;color:#fff;text-decoration:none;padding:13px 20px;border-radius:8px;font-weight:bold">Accept invitation</a></p><p style="font-size:12px;color:#71807a">This invitation expires on ${new Date(input.expiresAt).toLocaleDateString("en-ZA")}. If you were not expecting it, ignore this email.</p><hr style="border:0;border-top:1px solid #e1e8e5;margin:26px 0"><p style="font-size:12px;color:#71807a">Invited by ${input.invitedBy}<br>Track. Prevent. Perform.</p></td></tr></table></td></tr></table></body></html>`;
}
