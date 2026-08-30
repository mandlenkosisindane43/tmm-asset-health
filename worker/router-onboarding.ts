import currentApp from "./router-pwa";

interface ExecutionContext { waitUntil(promise: Promise<unknown>): void; passThroughOnException(): void; }
interface Env { RESEND_API_KEY?: string; INVITE_FROM_EMAIL?: string; [key:string]: unknown; }

type Onboarding = { to:string; name:string; company?:string; role?:string; source:"owner"|"staff" };

function esc(v:unknown){return String(v??"").replace(/[&<>"']/g,c=>({"&":"&amp;","<":"&lt;",">":"&gt;",'"':"&quot;","'":"&#39;"}[c]||c));}
function txt(v:unknown,max=240){return String(v??"").trim().slice(0,max);}
function lower(v:unknown){return txt(v,240).toLowerCase();}

async function captureOnboarding(req:Request,path:string):Promise<Onboarding|null>{
  if(req.method!=="POST") return null;
  if(path!=="/owner/action" && path!=="/company-admin/users/invite") return null;
  try{
    const f=await req.clone().formData();
    if(path==="/owner/action"){
      if(lower(f.get("action"))!=="create-company") return null;
      const to=lower(f.get("email")),name=txt(f.get("fullName"),120),company=txt(f.get("companyName"),120);
      if(!to.includes("@")) return null;
      return {to,name:name||"Company Administrator",company,role:"Company Administrator",source:"owner"};
    }
    const to=lower(f.get("email")),name=txt(f.get("fullName"),120),role=txt(f.get("role"),80);
    if(!to.includes("@")) return null;
    return {to,name:name||"TMM Asset Health User",role,source:"staff"};
  }catch{return null;}
}

async function sendInstallOnboarding(env:Env,origin:string,o:Onboarding){
  if(!env.RESEND_API_KEY) return;
  const installLink=`${origin}/install-app`;
  const loginLink=`${origin}/contractor-login`;
  const from=txt(env.INVITE_FROM_EMAIL||"TMM Asset Health <admin@sindaneassetsolutions.co.za>",250);
  const companyText=o.company?` for <strong>${esc(o.company)}</strong>`:"";
  const intro=o.source==="owner"
    ?`Your Company Administrator account${companyText} has been created by Sindane Asset Solutions.`
    :`You have been invited to a licensed TMM Asset Health workspace${o.role?` as <strong>${esc(o.role)}</strong>`:""}.`;
  const html=`<!doctype html><html><body style="margin:0;background:#f4f7f6;font-family:Arial,sans-serif;color:#10202b"><div style="max-width:620px;margin:30px auto;background:#fff;border-radius:14px;overflow:hidden;border:1px solid #e1e8e5"><div style="background:#071622;padding:28px;color:#fff"><div style="font-size:22px;font-weight:800">Sindane Asset Solutions</div><div style="font-size:10px;letter-spacing:3px;color:#e4ad17;margin-top:7px">TRACK. PREVENT. PERFORM.</div></div><div style="padding:30px"><h2 style="margin-top:0">Install TMM Asset Health</h2><p>Hello ${esc(o.name)},</p><p>${intro}</p><p>Install the TMM Asset Health contractor/staff app on your computer using the button below. After installation, sign in with your authorised company account. Your dashboard and permissions are selected automatically from your role.</p><p style="margin:28px 0"><a href="${esc(installLink)}" style="background:#11975c;color:#fff;padding:13px 20px;text-decoration:none;border-radius:8px;font-weight:700">Install TMM Asset Health</a></p><p style="font-size:12px;color:#66747d">Install link:<br>${esc(installLink)}</p><p style="font-size:12px;color:#66747d">Direct login:<br>${esc(loginLink)}</p>${o.source==="owner"?`<p style="font-size:12px;color:#66747d">For security, the temporary password is not repeated in this email. Use the password supplied to you separately by Sindane Asset Solutions.</p>`:`<p style="font-size:12px;color:#66747d">First accept the secure invitation email and create your own password. Then use the installed app to sign in.</p>`}</div><div style="padding:18px 30px;background:#f7faf8;font-size:11px;color:#7d898f">TMM Asset Health · Sindane Asset Solutions</div></div></body></html>`;
  const res=await fetch("https://api.resend.com/emails",{method:"POST",headers:{authorization:`Bearer ${env.RESEND_API_KEY}`,"content-type":"application/json"},body:JSON.stringify({from,to:[o.to],subject:"Install TMM Asset Health · Sindane Asset Solutions",html})});
  if(!res.ok){const data=await res.json().catch(()=>({})) as Record<string,unknown>;throw new Error(String(data.message||`Resend HTTP ${res.status}`));}
}

export default{
  async fetch(req:Request,env:Env,ctx:ExecutionContext):Promise<Response>{
    const url=new URL(req.url),path=url.pathname;
    const onboarding=await captureOnboarding(req,path);
    const res=await currentApp.fetch(req,env as never,ctx);
    if(onboarding && (res.status===302||res.status===303)){
      const loc=res.headers.get("location")||"";
      const failed=loc.includes("tone=err")||loc.includes("msg=Invitation+email+failed")||loc.includes("err=");
      if(!failed) ctx.waitUntil(sendInstallOnboarding(env,url.origin,onboarding).catch(e=>console.error("INSTALL_ONBOARDING_EMAIL_ERROR",e)));
    }
    return res;
  }
};
