import currentApp from "./lightweight-entry";

interface ExecutionContext { waitUntil(promise: Promise<unknown>): void; passThroughOnException(): void; }
interface ScheduledController { scheduledTime:number; cron:string; noRetry():void; }
interface Env { DB:D1Database; RESEND_API_KEY?:string; [key:string]:unknown; }
type Row=Record<string,unknown>;

const COOKIE="sas_contractor_v2";
const OWNER_COOKIE="sas_owner_v1";
const enc=new TextEncoder();
function esc(v:unknown){return String(v??"").replace(/[&<>"']/g,c=>({"&":"&amp;","<":"&lt;",">":"&gt;",'"':"&quot;","'":"&#39;"}[c]||c));}
function txt(v:unknown,n=250){return String(v??"").trim().slice(0,n);}
function cookie(req:Request,name:string){for(const p of (req.headers.get("cookie")||"").split(";")){const i=p.indexOf("=");if(i>-1&&p.slice(0,i).trim()===name)return p.slice(i+1).trim()}return "";}
async function sha256(v:string){return Array.from(new Uint8Array(await crypto.subtle.digest("SHA-256",enc.encode(v))),b=>b.toString(16).padStart(2,"0")).join("");}
async function first(env:Env,sql:string,binds:unknown[]=[]){try{return await env.DB.prepare(sql).bind(...binds).first<Row>()}catch{return null}}
async function all(env:Env,sql:string,binds:unknown[]=[]){try{return (await env.DB.prepare(sql).bind(...binds).all<Row>()).results||[]}catch{return []}}
function redirect(location:string){return new Response(null,{status:303,headers:{location,"cache-control":"no-store"}});}

async function adminSession(req:Request,env:Env){
  const raw=cookie(req,COOKIE); if(!raw)return null;
  const r=await first(env,`SELECT s.company_id companyId,s.account_id accountId,COALESCE(NULLIF(s.active_role,''),a.role) role,a.full_name fullName,a.email,c.name companyName FROM contractor_sessions s JOIN contractor_accounts a ON a.id=s.account_id AND a.company_id=s.company_id JOIN companies c ON c.id=s.company_id WHERE s.token_hash=? AND datetime(s.expires_at)>datetime('now') AND a.status='active' LIMIT 1`,[await sha256(raw)]);
  if(!r)return null;
  const role=txt(r.role).toLowerCase();
  if(!["company_admin","admin"].includes(role))return null;
  return r;
}

async function sendInstallEmail(req:Request,env:Env){
  const s=await adminSession(req,env);
  if(!s)return redirect("/contractor-login");
  const f=await req.formData();
  const email=txt(f.get("email")).toLowerCase();
  const user=await first(env,"SELECT full_name fullName,email,status FROM contractor_accounts WHERE company_id=? AND lower(email)=? LIMIT 1",[Number(s.companyId),email]);
  if(!user)return redirect("/contractor?view=users&tone=err&msg="+encodeURIComponent("That email is not a user in this company."));
  if(!email.includes("@"))return redirect("/contractor?view=users&tone=err&msg="+encodeURIComponent("Choose a valid user email."));
  const key=txt(env.RESEND_API_KEY,500);
  if(!key)return redirect("/contractor?view=users&tone=err&msg="+encodeURIComponent("Email service is not configured."));
  const origin=new URL(req.url).origin;
  const installLink=`${origin}/install-app`;
  const loginLink=`${origin}/contractor-login`;
  const name=txt(user.fullName)||"TMM Asset Health user";
  const company=txt(s.companyName)||"your company";
  const html=`<!doctype html><html><body style="margin:0;background:#f4f7fb;font-family:Arial,Helvetica,sans-serif;color:#172033"><div style="max-width:650px;margin:24px auto;background:#fff;border:1px solid #dfe6ef;border-radius:16px;overflow:hidden"><div style="background:#0d1b31;color:#fff;padding:24px"><h2 style="margin:0">TMM Asset Health Mobile App</h2><p style="margin:6px 0 0;color:#aebbd0">Sindane Asset Solutions · ${esc(company)}</p></div><div style="padding:26px"><p>Hello <b>${esc(name)}</b>,</p><p>You can install the TMM Asset Health software on your phone and use the same company account you already have.</p><p style="margin:24px 0"><a href="${installLink}" style="display:inline-block;background:#14223a;color:#fff;padding:13px 20px;border-radius:9px;text-decoration:none;font-weight:800">Install TMM Asset Health</a></p><p style="font-size:13px;color:#667085"><b>Android:</b> open the installation page in Chrome and choose Install App / Add to Home Screen.<br><b>iPhone:</b> open it in Safari, tap Share, then Add to Home Screen.</p><p style="margin-top:22px"><a href="${loginLink}" style="color:#174a7e;font-weight:700">Open Company Login</a></p><p style="font-size:12px;color:#7a8698;margin-top:24px">This installation link is generated from the live TMM Asset Health application hosted by Sindane Asset Solutions.</p></div></div></body></html>`;
  try{
    const r=await fetch("https://api.resend.com/emails",{method:"POST",headers:{Authorization:`Bearer ${key}`,"content-type":"application/json"},body:JSON.stringify({from:"Sindane Asset Solutions <admin@sindaneassetsolutions.co.za>",to:[email],subject:`Install TMM Asset Health · ${company}`,html})});
    if(!r.ok){const j=await r.json().catch(()=>({})) as Row;return redirect("/contractor?view=users&tone=err&msg="+encodeURIComponent(`Installation email failed: ${txt(j.message)||`email service returned ${r.status}`}`));}
  }catch(e){return redirect("/contractor?view=users&tone=err&msg="+encodeURIComponent(`Installation email failed: ${e instanceof Error?e.message:String(e)}`));}
  return redirect("/contractor?view=users&msg="+encodeURIComponent(`TMM Asset Health installation link sent to ${email}.`));
}

async function ownerSession(req:Request,env:Env){const raw=cookie(req,OWNER_COOKIE);if(!raw)return null;return first(env,"SELECT csrf_token csrf,expires_at expiresAt FROM owner_sessions_v1 WHERE token_hash=? LIMIT 1",[await sha256(raw)]);}
async function sendOwnerInstallEmail(req:Request,env:Env){const owner=await ownerSession(req,env);if(!owner||new Date(String(owner.expiresAt)).getTime()<Date.now())return redirect("/owner-login");const f=await req.formData();if(String(f.get("csrf")||"")!==String(owner.csrf||""))return new Response("Invalid request token",{status:403});const accountId=Number(f.get("accountId")||0);const user=await first(env,"SELECT a.full_name fullName,a.email,a.status,c.name companyName FROM contractor_accounts a JOIN companies c ON c.id=a.company_id WHERE a.id=? LIMIT 1",[accountId]);if(!user||String(user.status)!=="active")return redirect("/owner?tone=err&msg="+encodeURIComponent("Choose an active company user."));const key=txt(env.RESEND_API_KEY,500);if(!key)return redirect("/owner?tone=err&msg="+encodeURIComponent("Email service is not configured."));const origin=new URL(req.url).origin,email=txt(user.email).toLowerCase(),company=txt(user.companyName),name=txt(user.fullName)||"TMM Asset Health user",installLink=`${origin}/install-app`,loginLink=`${origin}/contractor-login`;const html=`<!doctype html><html><body style="margin:0;background:#f4f7fb;font-family:Arial,Helvetica,sans-serif;color:#172033"><div style="max-width:650px;margin:24px auto;background:#fff;border:1px solid #dfe6ef;border-radius:16px;overflow:hidden"><div style="background:#0d1b31;color:#fff;padding:24px"><h2 style="margin:0">TMM Asset Health Mobile App</h2><p style="margin:6px 0 0;color:#aebbd0">Sindane Asset Solutions · ${esc(company)}</p></div><div style="padding:26px"><p>Hello <b>${esc(name)}</b>,</p><p>The Sindane Platform Owner has sent you the official mobile installation link for TMM Asset Health.</p><p style="margin:24px 0"><a href="${installLink}" style="display:inline-block;background:#14223a;color:#fff;padding:13px 20px;border-radius:9px;text-decoration:none;font-weight:800">Install TMM Asset Health</a></p><p style="font-size:13px;color:#667085"><b>Android:</b> open in Chrome and choose Install App / Add to Home Screen.<br><b>iPhone:</b> open in Safari, tap Share, then Add to Home Screen.</p><p><a href="${loginLink}" style="color:#174a7e;font-weight:700">Open Company Login</a></p></div></div></body></html>`;try{const r=await fetch("https://api.resend.com/emails",{method:"POST",headers:{Authorization:`Bearer ${key}`,"content-type":"application/json"},body:JSON.stringify({from:"Sindane Asset Solutions <admin@sindaneassetsolutions.co.za>",to:[email],subject:`Install TMM Asset Health · ${company}`,html})});if(!r.ok)return redirect("/owner?tone=err&msg="+encodeURIComponent(`Installation email failed (${r.status}).`));}catch(e){return redirect("/owner?tone=err&msg="+encodeURIComponent(`Installation email failed: ${e instanceof Error?e.message:String(e)}`));}return redirect("/owner?msg="+encodeURIComponent(`Mobile installation link sent to ${email}.`));}

async function injectOwnerInstallSender(req:Request,env:Env,res:Response){if(req.method!=="GET")return res;const u=new URL(req.url);if(u.pathname!=="/owner"||u.searchParams.get("view"))return res;const ct=res.headers.get("content-type")||"";if(!ct.includes("text/html"))return res;const owner=await ownerSession(req,env);if(!owner)return res;const users=await all(env,"SELECT a.id,a.full_name fullName,a.email,c.name companyName FROM contractor_accounts a JOIN companies c ON c.id=a.company_id WHERE a.status='active' AND trim(a.email)<>'' ORDER BY c.name,a.full_name");const options=users.map(r=>`<option value="${Number(r.id)}">${esc(r.companyName)} · ${esc(r.fullName||r.email)} · ${esc(r.email)}</option>`).join("");const panel=`<section class="panel section-gap" style="border:2px solid #11975c"><h2>Send Mobile Installation Link</h2><p class="muted">Select any active company user and send the official Android/iPhone installation page from the owner dashboard.</p><form method="post" action="/owner/mobile-install/send" style="display:grid;grid-template-columns:minmax(260px,1fr) auto;gap:10px;align-items:end"><input type="hidden" name="csrf" value="${esc(owner.csrf)}"><label class="field" style="margin:0">Company user<select name="accountId" required><option value="">Choose company user</option>${options}</select></label><button class="btn" type="submit">Send Mobile Installation Link</button></form></section>`;let body=await res.text();body=body.replace('<div class="grid g2 section-gap"><section class="panel"><h2>LATEST INVITATIONS</h2>',panel+'<div class="grid g2 section-gap"><section class="panel"><h2>LATEST INVITATIONS</h2>');const h=new Headers(res.headers);h.delete("content-length");h.set("cache-control","private, no-store");return new Response(body,{status:res.status,statusText:res.statusText,headers:h});}

async function injectInstallSender(req:Request,env:Env,res:Response){
  if(req.method!=="GET")return res;
  const u=new URL(req.url);
  if(u.pathname!=="/contractor"||u.searchParams.get("view")!=="users")return res;
  const ct=res.headers.get("content-type")||""; if(!ct.includes("text/html"))return res;
  const s=await adminSession(req,env); if(!s)return res;
  const users=await all(env,"SELECT full_name fullName,email,status FROM contractor_accounts WHERE company_id=? AND trim(email)<>'' ORDER BY full_name,email",[Number(s.companyId)]);
  const opts=users.map(r=>`<option value="${esc(r.email)}">${esc(r.fullName||r.email)} · ${esc(r.email)} · ${esc(r.status)}</option>`).join("");
  const panel=`<section class="panel" style="margin:0 0 14px"><h2>Send Mobile App Installation Link</h2><p style="font-size:12px;color:#5f6d76;line-height:1.5">Choose a company user and email them the official TMM Asset Health mobile installation page. They install the live app from Cloudflare and sign in with their own account.</p><form method="post" action="/mobile-install/send" style="display:grid;grid-template-columns:minmax(240px,1fr) auto;gap:10px;align-items:end"><label class="field" style="margin:0">Company user<select name="email" required><option value="">Choose user</option>${opts}</select></label><button class="btn" type="submit">Send Installation Link</button></form><p style="font-size:10px;color:#7a8698;margin-top:8px">Installation destination: <b>/install-app</b></p></section>`;
  let body=await res.text();
  const marker='<div class="split">';
  body=body.includes(marker)?body.replace(marker,panel+marker):body.replace('<div class="pagehead">',panel+'<div class="pagehead">');
  const h=new Headers(res.headers);h.delete("content-length");h.set("cache-control","private, no-store");
  return new Response(body,{status:res.status,statusText:res.statusText,headers:h});
}

export default {
  async fetch(req:Request,env:Env,ctx:ExecutionContext):Promise<Response>{
    const u=new URL(req.url);
    if(req.method==="POST"&&u.pathname==="/mobile-install/send")return sendInstallEmail(req,env);
    if(req.method==="POST"&&u.pathname==="/owner/mobile-install/send")return sendOwnerInstallEmail(req,env);
    const res=await currentApp.fetch(req,env as never,ctx as never);
    return injectOwnerInstallSender(req,env,await injectInstallSender(req,env,res));
  },
  async scheduled(c:ScheduledController,env:Env,ctx:ExecutionContext){
    const app=currentApp as unknown as {scheduled?:(c:ScheduledController,e:Env,x:ExecutionContext)=>Promise<void>|void};
    if(app.scheduled)return app.scheduled(c,env,ctx);
  }
};
