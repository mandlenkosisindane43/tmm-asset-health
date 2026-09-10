import currentApp from "./router-pwa-click-fix";
import { sindaneLogoDataUri } from "./sindane-logo-data";

interface ExecutionContext { waitUntil(promise: Promise<unknown>): void; passThroughOnException(): void; }
interface ScheduledController { scheduledTime:number; cron:string; noRetry():void; }
interface Env { DB:D1Database; [key:string]: unknown; }

const COOKIE="sas_contractor_v2";
const encoder=new TextEncoder();

function clean(v:unknown,max=240){return String(v??"").trim().slice(0,max)}
function email(v:unknown){return clean(v,200).toLowerCase()}
function bytesToHex(bytes:Uint8Array){return Array.from(bytes,b=>b.toString(16).padStart(2,"0")).join("")}
function hexToBytes(value:string){const out=new Uint8Array(Math.floor(value.length/2));for(let i=0;i<out.length;i++)out[i]=parseInt(value.slice(i*2,i*2+2),16);return out}
function b64url(bytes:Uint8Array){let s="";bytes.forEach(b=>s+=String.fromCharCode(b));return btoa(s).replace(/\+/g,"-").replace(/\//g,"_").replace(/=+$/g,"")}
async function sha256(value:string){return bytesToHex(new Uint8Array(await crypto.subtle.digest("SHA-256",encoder.encode(value))))}
async function secureEqual(a:string,b:string){if(a.length!==b.length)return false;let diff=0;for(let i=0;i<a.length;i++)diff|=a.charCodeAt(i)^b.charCodeAt(i);return diff===0}
async function derivePassword(password:string,saltHex:string,iterations:number){const key=await crypto.subtle.importKey("raw",encoder.encode(password),"PBKDF2",false,["deriveBits"]);const bits=await crypto.subtle.deriveBits({name:"PBKDF2",hash:"SHA-256",salt:hexToBytes(saltHex),iterations},key,256);return bytesToHex(new Uint8Array(bits))}
function json(data:unknown,status=200,headers:Record<string,string>={}){return new Response(JSON.stringify(data),{status,headers:{"content-type":"application/json; charset=utf-8","cache-control":"no-store",...headers}})}
function licenceValid(status:string,expiresAt:string,graceDays:number){if(!["active","trial"].includes(status.toLowerCase()))return false;const end=new Date(expiresAt).getTime()+Math.max(0,graceDays)*86400000;return Number.isFinite(end)&&Date.now()<=end}

async function fastLogin(req:Request,env:Env,ctx:ExecutionContext){
  try{
    const contentType=req.headers.get("content-type")||"";
    const browserForm=contentType.includes("application/x-www-form-urlencoded")||contentType.includes("multipart/form-data");
    const body=browserForm ? Object.fromEntries((await req.formData()).entries()) as Record<string,unknown> : await req.json().catch(()=>({})) as Record<string,unknown>;
    const userEmail=email(body.email),password=String(body.password||"");
    const fail=(message:string,status:number)=>browserForm ? new Response(null,{status:303,headers:{location:`/contractor-login?error=${encodeURIComponent(message)}`,"cache-control":"no-store"}}) : json({error:message},status);
    if(!userEmail||!password)return fail("Email and password are required.",400);

    const row=await env.DB.prepare(`SELECT a.id accountId,a.company_id companyId,a.status accountStatus,a.password_hash passwordHash,a.password_salt passwordSalt,c.licence_status licenceStatus,c.expires_at licenceExpires,c.grace_days graceDays FROM contractor_accounts a JOIN companies c ON c.id=a.company_id WHERE lower(a.email)=? LIMIT 1`).bind(userEmail).first<Record<string,unknown>>();
    if(!row||String(row.accountStatus)!=="active")return fail("Invalid email or password.",401);

    const stored=String(row.passwordHash||"");
    const salt=String(row.passwordSalt||"");
    let verified=false;
    if(stored&&salt){
      const h100=await derivePassword(password,salt,100000);
      verified=await secureEqual(h100,stored);
      if(!verified){const h150=await derivePassword(password,salt,150000);verified=await secureEqual(h150,stored)}
    }
    if(!verified)return json({error:"Invalid email or password."},401);
    if(!licenceValid(String(row.licenceStatus||""),String(row.licenceExpires||""),Number(row.graceDays||0)))return fail("Company licence is inactive or expired.",403);

    const token=b64url(crypto.getRandomValues(new Uint8Array(32)));
    const tokenHash=await sha256(token);
    const now=new Date();
    const expires=new Date(Date.now()+12*3600000);
    await env.DB.prepare("INSERT INTO contractor_sessions(token_hash,company_id,account_id,expires_at,created_at) VALUES(?,?,?,?,?)").bind(tokenHash,Number(row.companyId),Number(row.accountId),expires.toISOString(),now.toISOString()).run();
    ctx.waitUntil(env.DB.prepare("DELETE FROM contractor_sessions WHERE expires_at<?").bind(now.toISOString()).run().then(()=>undefined).catch(()=>undefined));
    const cookie=`${COOKIE}=${token}; Path=/; HttpOnly; Secure; SameSite=Lax; Max-Age=43200`;
    return browserForm ? new Response(null,{status:303,headers:{location:"/contractor","set-cookie":cookie,"cache-control":"no-store"}}) : json({ok:true},200,{"set-cookie":cookie});
  }catch(error){
    console.error("FAST_CONTRACTOR_LOGIN_ERROR",error);
    return json({error:"Login service could not complete. Please try again."},500);
  }
}

function loginPage(){
  const logo=sindaneLogoDataUri();
  return `<!doctype html><html><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><meta name="theme-color" content="#061827"><link rel="manifest" href="/app.webmanifest"><link rel="icon" href="/app-icon.svg" type="image/svg+xml"><title>TMM Asset Health Login</title><style>*{box-sizing:border-box}html,body{margin:0;min-height:100%;font-family:Arial,Helvetica,sans-serif}body{min-height:100vh;display:grid;place-items:center;padding:24px;background:linear-gradient(145deg,#061827,#0a2132);color:#102035}.card{width:min(460px,100%);background:#fff;border-radius:20px;overflow:hidden;box-shadow:0 22px 70px rgba(0,0,0,.3)}.brand{background:#071a29;text-align:center;padding:24px;border-bottom:4px solid #11975c}.brand img{width:180px;height:115px;object-fit:contain}.brand h1{margin:6px 0 2px;color:#fff;font-size:25px}.brand p{margin:0;color:#e6a600;font-size:10px;font-weight:900;letter-spacing:3px}.body{padding:28px}.body h2{margin:0 0 6px;font-size:24px;color:#0b2036}.body>p{margin:0 0 18px;color:#66778a;font-size:13px;line-height:1.5}.field{display:grid;gap:7px;margin-top:14px;font-size:12px;font-weight:800;color:#263b52}.field input{width:100%;padding:13px 14px;border:1px solid #cbd6e2;border-radius:9px;font-size:15px;outline:none}.field input:focus{border-color:#29496f;box-shadow:0 0 0 3px rgba(41,73,111,.12)}button{width:100%;margin-top:20px;border:0;border-radius:10px;padding:14px 16px;background:#10283a;color:#fff;font-size:14px;font-weight:900;cursor:pointer}.msg{min-height:20px;margin-top:12px;font-size:12px;color:#b42318}.links{display:flex;justify-content:space-between;gap:10px;flex-wrap:wrap;margin-top:18px}.links a{font-size:12px;font-weight:800;color:#183c63;text-decoration:none}.foot{text-align:center;background:#f4f7f8;padding:13px 20px;font-size:10px;color:#6a7888}</style><script src="/pwa-register.js" defer></script></head><body><main class="card"><header class="brand"><img src="${logo}" alt="Sindane Asset Solutions"><h1>TMM Asset Health</h1><p>TRACK. PREVENT. PERFORM.</p></header><section class="body"><h2>Sign in</h2><p>Use your authorised company account to continue to the TMM Asset Health workspace.</p><form id="loginForm" method="post" action="/contractor-login"><label class="field">Email<input name="email" type="email" autocomplete="username" required></label><label class="field">Password<input name="password" type="password" autocomplete="current-password" required></label><button id="signInBtn" type="submit">Sign in securely</button><div id="msg" class="msg"></div></form><div class="links"><a href="/install-app">Install App</a><a href="/contractor-demo">Open Demo</a></div></section><footer class="foot">Sindane Asset Solutions · Secure cloud-connected software</footer></main><script>(function(){var f=document.getElementById('loginForm'),m=document.getElementById('msg'),b=document.getElementById('signInBtn');f.addEventListener('submit',async function(e){e.preventDefault();m.textContent='';b.disabled=true;b.textContent='Signing in...';var controller=new AbortController();var timer=setTimeout(function(){controller.abort();},12000);try{var fd=new FormData(f);var r=await fetch('/api/contractor/login',{method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify({email:fd.get('email'),password:fd.get('password')}),signal:controller.signal,credentials:'same-origin',cache:'no-store'});var j=await r.json().catch(function(){return {}});if(r.ok){window.location.assign('/contractor');return;}m.textContent=j.error||'Sign in failed. Please check your details.';}catch(err){m.textContent=err&&err.name==='AbortError'?'Login took too long. Please try once more.':'Connection interrupted. Retrying securely...';setTimeout(function(){f.submit();},300);}finally{clearTimeout(timer);b.disabled=false;b.textContent='Sign in securely';}});})();</script></body></html>`;
}

export default {
  async fetch(req:Request,env:Env,ctx:ExecutionContext){
    const url=new URL(req.url);
    if(req.method==="GET"&&url.pathname==="/contractor-login")return new Response(loginPage(),{status:200,headers:{"content-type":"text/html; charset=utf-8","cache-control":"no-store","x-frame-options":"DENY","referrer-policy":"same-origin","content-security-policy":"default-src 'self'; img-src 'self' data:; style-src 'self' 'unsafe-inline'; script-src 'self' 'unsafe-inline'; connect-src 'self'; manifest-src 'self'; frame-ancestors 'none'; base-uri 'self'; form-action 'self'"}});
    if(req.method==="POST"&&(url.pathname==="/api/contractor/login"||url.pathname==="/contractor-login"))return fastLogin(req,env,ctx);
    return currentApp.fetch(req,env as never,ctx as never);
  },
  async scheduled(c:ScheduledController,env:Env,ctx:ExecutionContext){const app=currentApp as unknown as {scheduled?:(c:ScheduledController,e:Env,x:ExecutionContext)=>Promise<void>|void};if(app.scheduled)return app.scheduled(c,env,ctx)}
};
