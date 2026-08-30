import currentApp from "./router-pwa";

interface ExecutionContext { waitUntil(promise: Promise<unknown>): void; passThroughOnException(): void; }
interface Env {
  DB: D1Database;
  RESEND_API_KEY?: string;
  INVITE_FROM_EMAIL?: string;
  [key:string]: unknown;
}

type Row = Record<string, unknown>;
const OWNER_COOKIE = "sas_owner_v1";
const enc = new TextEncoder();

function esc(v:unknown){return String(v??"").replace(/[&<>"']/g,c=>({"&":"&amp;","<":"&lt;",">":"&gt;",'"':"&quot;","'":"&#39;"}[c]||c));}
function txt(v:unknown,max=240){return String(v??"").trim().slice(0,max);}
function lower(v:unknown){return txt(v,240).toLowerCase();}
function num(v:unknown,f=0){const n=Number(v);return Number.isFinite(n)?n:f;}
function bytesToHex(bytes:Uint8Array){return Array.from(bytes,b=>b.toString(16).padStart(2,"0")).join("");}
async function sha256(v:string){return bytesToHex(new Uint8Array(await crypto.subtle.digest("SHA-256",enc.encode(v))));}
async function secureEqual(a:string,b:string){const [x,y]=await Promise.all([sha256(a),sha256(b)]);let d=x.length^y.length;for(let i=0;i<Math.min(x.length,y.length);i++)d|=x.charCodeAt(i)^y.charCodeAt(i);return d===0;}
function getCookie(req:Request,name:string){for(const p of (req.headers.get("cookie")||"").split(";")){const i=p.indexOf("=");if(i>-1&&p.slice(0,i).trim()===name)return p.slice(i+1).trim();}return "";}
function redirect(location:string){return new Response(null,{status:303,headers:{location,"cache-control":"no-store"}});}

async function ensureInvitationSchema(env:Env){
  await env.DB.prepare(`CREATE TABLE IF NOT EXISTS user_invitations_v3 (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    company_id INTEGER NOT NULL,
    email TEXT NOT NULL,
    full_name TEXT NOT NULL,
    role TEXT NOT NULL,
    token_hash TEXT NOT NULL UNIQUE,
    status TEXT NOT NULL DEFAULT 'pending',
    created_by INTEGER NOT NULL,
    created_at TEXT NOT NULL,
    expires_at TEXT NOT NULL,
    accepted_at TEXT,
    provider_message_id TEXT
  )`).run();
  await env.DB.prepare(`CREATE INDEX IF NOT EXISTS idx_user_invitations_company_email ON user_invitations_v3(company_id,email,status)`).run();
}

async function validateOwner(req:Request,env:Env,csrf:string){
  const token=getCookie(req,OWNER_COOKIE);
  if(!token)return false;
  const row=await env.DB.prepare("SELECT csrf_token AS csrf,expires_at AS expiresAt FROM owner_sessions_v1 WHERE token_hash=? LIMIT 1").bind(await sha256(token)).first<Row>();
  if(!row||new Date(String(row.expiresAt)).getTime()<Date.now())return false;
  return secureEqual(String(row.csrf||""),csrf);
}

async function sendOwnerAdminInvite(env:Env,input:{to:string;name:string;company:string;link:string}){
  if(!env.RESEND_API_KEY)throw new Error("Invitation email service is not configured. RESEND_API_KEY is required.");
  const from=txt(env.INVITE_FROM_EMAIL||"TMM Asset Health <admin@sindaneassetsolutions.co.za>",250);
  const html=`<!doctype html><html><body style="margin:0;background:#f4f7f6;font-family:Arial,sans-serif;color:#10202b"><div style="max-width:620px;margin:30px auto;background:#fff;border-radius:14px;overflow:hidden;border:1px solid #e1e8e5"><div style="background:#071622;padding:28px;color:#fff"><div style="font-size:22px;font-weight:800">Sindane Asset Solutions</div><div style="font-size:10px;letter-spacing:3px;color:#e4ad17;margin-top:7px">TRACK. PREVENT. PERFORM.</div></div><div style="padding:30px"><h2 style="margin-top:0">You're invited as Company Administrator</h2><p>Hello ${esc(input.name)},</p><p>Sindane Asset Solutions has created the licensed TMM Asset Health workspace for <strong>${esc(input.company)}</strong> and invited you as its <strong>Company Administrator</strong>.</p><p><strong>No password has been created for you.</strong> For security, you must accept this invitation and create your own password.</p><p style="margin:28px 0"><a href="${esc(input.link)}" style="background:#11975c;color:#fff;padding:13px 20px;text-decoration:none;border-radius:8px;font-weight:700">Accept Invitation & Create Password</a></p><p>After activation, TMM Asset Health will give you the installer link. Install the app on your computer and log in with your email address and the password you created.</p><p style="font-size:12px;color:#66747d">This secure invitation expires in 48 hours and can only be used once.</p><p style="font-size:12px;color:#66747d">If the button does not work, copy this link into your browser:<br>${esc(input.link)}</p></div><div style="padding:18px 30px;background:#f7faf8;font-size:11px;color:#7d898f">TMM Asset Health · Sindane Asset Solutions</div></div></body></html>`;
  const res=await fetch("https://api.resend.com/emails",{method:"POST",headers:{authorization:`Bearer ${env.RESEND_API_KEY}`,"content-type":"application/json"},body:JSON.stringify({from,to:[input.to],subject:`${input.company} · Activate your TMM Asset Health administrator account`,html})});
  const data=await res.json().catch(()=>({})) as Row;
  if(!res.ok)throw new Error(String(data.message||`Email provider returned ${res.status}`));
  return String(data.id||"");
}

async function createCompanyInvitation(req:Request,env:Env,f:FormData){
  const csrf=String(f.get("csrf")||"");
  if(!(await validateOwner(req,env,csrf)))return new Response("Invalid or expired owner session",{status:403});
  if(!env.RESEND_API_KEY)return redirect(`/owner?view=companies&tone=err&msg=${encodeURIComponent("Invitation email is not configured. Add RESEND_API_KEY before creating a contractor.")}`);

  const companyName=txt(f.get("companyName"),120);
  const fullName=txt(f.get("fullName"),120);
  const email=lower(f.get("email"));
  const days=Math.max(1,Math.min(3650,num(f.get("licenceDays"),180)));
  const maxUsers=Math.max(1,Math.min(10000,num(f.get("maxUsers"),10)));
  const status=["active","trial"].includes(lower(f.get("status")))?lower(f.get("status")):"active";
  if(!companyName||!fullName||!email.includes("@"))return redirect(`/owner?view=companies&tone=err&msg=${encodeURIComponent("Enter a company name, administrator name and valid administrator email.")}`);

  await ensureInvitationSchema(env);
  const existingAccount=await env.DB.prepare("SELECT id FROM contractor_accounts WHERE lower(email)=? LIMIT 1").bind(email).first();
  if(existingAccount)return redirect(`/owner?view=companies&tone=err&msg=${encodeURIComponent("That administrator email already has an active TMM Asset Health account.")}`);
  const existingPending=await env.DB.prepare("SELECT id FROM user_invitations_v3 WHERE lower(email)=? AND status='pending' AND datetime(expires_at)>datetime('now') LIMIT 1").bind(email).first();
  if(existingPending)return redirect(`/owner?view=companies&tone=err&msg=${encodeURIComponent("That email already has a pending invitation. Wait for acceptance or let the current invitation expire.")}`);

  const now=new Date();
  const expiresAt=new Date(now.getTime()+days*86400000).toISOString();
  const licenceKey="SAS-"+bytesToHex(crypto.getRandomValues(new Uint8Array(12))).toUpperCase();
  const companyInsert=await env.DB.prepare("INSERT INTO companies(name,licence_key,licence_status,expires_at,grace_days,max_users,created_at) VALUES(?,?,?,?,?,?,?)").bind(companyName,licenceKey,status,expiresAt,0,maxUsers,now.toISOString()).run();
  const companyId=Number(companyInsert.meta?.last_row_id||0);
  if(!companyId)return redirect(`/owner?view=companies&tone=err&msg=${encodeURIComponent("The contractor company could not be created.")}`);

  const token=`${crypto.randomUUID()}${crypto.randomUUID().replace(/-/g,"")}`;
  const tokenHash=await sha256(token);
  const inviteExpires=new Date(now.getTime()+48*60*60*1000).toISOString();
  let inviteId=0;
  try{
    const inserted=await env.DB.prepare("INSERT INTO user_invitations_v3(company_id,email,full_name,role,token_hash,status,created_by,created_at,expires_at) VALUES(?,?,?,?,?,'pending',0,?,?)").bind(companyId,email,fullName,"company_admin",tokenHash,now.toISOString(),inviteExpires).run();
    inviteId=Number(inserted.meta?.last_row_id||0);
    const link=`${new URL(req.url).origin}/accept-invite?token=${encodeURIComponent(token)}`;
    const providerId=await sendOwnerAdminInvite(env,{to:email,name:fullName,company:companyName,link});
    if(inviteId)await env.DB.prepare("UPDATE user_invitations_v3 SET provider_message_id=? WHERE id=?").bind(providerId,inviteId).run();
  }catch(error){
    if(inviteId)await env.DB.prepare("DELETE FROM user_invitations_v3 WHERE id=?").bind(inviteId).run().catch(()=>{});
    await env.DB.prepare("DELETE FROM companies WHERE id=?").bind(companyId).run().catch(()=>{});
    return redirect(`/owner?view=companies&tone=err&msg=${encodeURIComponent(`Company Admin invitation failed: ${error instanceof Error?error.message:String(error)}`)}`);
  }
  return redirect(`/owner?view=companies&msg=${encodeURIComponent(`Contractor created. Secure activation invitation sent to ${email}. The Company Admin must accept it and create their own password.`)}`);
}

async function rewriteOwnerCompanyPage(res:Response){
  const ct=res.headers.get("content-type")||"";
  if(!ct.includes("text/html"))return res;
  let out=await res.text();
  out=out.replace(/<label class="field">Temporary administrator password[\s\S]*?<\/label>/,`<div class="notice"><b>Secure activation:</b> The Company Admin will receive an email invitation and create their own password. You do not create or know their password.</div>`);
  out=out.replace(/>Create Contractor<\/button>/,">Create Contractor & Send Invitation</button>");
  out=out.replace("Creating a contractor here creates the first Company Administrator only; that administrator then invites Engineer, Supervisor, Mechanic and Manager users.","Creating a contractor sends the first Company Administrator a secure activation invitation. After creating their own password and installing TMM Asset Health, that administrator can invite Engineer, Supervisor, Mechanic and Manager users. Every invited user creates their own password.");
  const h=new Headers(res.headers);h.set("cache-control","private, no-store");
  return new Response(out,{status:res.status,statusText:res.statusText,headers:h});
}

async function rewriteAcceptPage(res:Response,method:string){
  const ct=res.headers.get("content-type")||"";
  if(!ct.includes("text/html"))return res;
  let out=await res.text();
  if(method==="GET"){
    out=out.replace("<p>Create your own password to activate your account.</p>","<p>Create your own password to activate your account. After activation, install TMM Asset Health and log in with the password you create here.</p>");
  }else{
    const install=`<div class="meta"><b>Next step:</b> Install TMM Asset Health on this computer, then log in with your email and the password you just created.</div><a class="link" href="/install-app">Install TMM Asset Health →</a><br>`;
    out=out.replace('<a class="link" href="/contractor-login">Continue to login →</a>',install+'<a class="link" href="/contractor-login">Already installed? Go to login →</a>');
    out=out.replace('<a class="link" href="/contractor-login">Sign in to TMM Asset Health</a>',install+'<a class="link" href="/contractor-login">Already installed? Sign in →</a>');
  }
  const h=new Headers(res.headers);h.set("cache-control","private, no-store");
  return new Response(out,{status:res.status,statusText:res.statusText,headers:h});
}

export default{
  async fetch(req:Request,env:Env,ctx:ExecutionContext):Promise<Response>{
    const url=new URL(req.url);
    const path=url.pathname;

    if(path==="/owner/action"&&req.method==="POST"){
      const f=await req.clone().formData().catch(()=>null);
      if(f&&lower(f.get("action"))==="create-company")return createCompanyInvitation(req,env,f);
    }

    const res=await currentApp.fetch(req,env as never,ctx);
    if(path==="/owner"&&req.method==="GET"&&url.searchParams.get("view")==="companies")return rewriteOwnerCompanyPage(res);
    if(path==="/accept-invite")return rewriteAcceptPage(res,req.method);
    return res;
  }
};
