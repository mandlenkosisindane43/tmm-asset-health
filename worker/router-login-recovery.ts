import currentApp from "./router-pwa-click-fix";
import { sindaneLogoDataUri } from "./sindane-logo-data";

interface ExecutionContext { waitUntil(promise: Promise<unknown>): void; passThroughOnException(): void; }
interface ScheduledController { scheduledTime:number; cron:string; noRetry():void; }
interface Env { [key:string]: unknown; }

function loginPage(){
  const logo=sindaneLogoDataUri();
  return `<!doctype html><html><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><meta name="theme-color" content="#061827"><link rel="manifest" href="/app.webmanifest"><link rel="icon" href="/app-icon.svg" type="image/svg+xml"><title>TMM Asset Health Login</title><style>*{box-sizing:border-box}html,body{margin:0;min-height:100%;font-family:Arial,Helvetica,sans-serif}body{min-height:100vh;display:grid;place-items:center;padding:24px;background:linear-gradient(145deg,#061827,#0a2132);color:#102035}.card{width:min(460px,100%);background:#fff;border-radius:20px;overflow:hidden;box-shadow:0 22px 70px rgba(0,0,0,.3)}.brand{background:#071a29;text-align:center;padding:24px;border-bottom:4px solid #11975c}.brand img{width:180px;height:115px;object-fit:contain}.brand h1{margin:6px 0 2px;color:#fff;font-size:25px}.brand p{margin:0;color:#e6a600;font-size:10px;font-weight:900;letter-spacing:3px}.body{padding:28px}.body h2{margin:0 0 6px;font-size:24px;color:#0b2036}.body>p{margin:0 0 18px;color:#66778a;font-size:13px;line-height:1.5}.field{display:grid;gap:7px;margin-top:14px;font-size:12px;font-weight:800;color:#263b52}.field input{width:100%;padding:13px 14px;border:1px solid #cbd6e2;border-radius:9px;font-size:15px;outline:none}.field input:focus{border-color:#29496f;box-shadow:0 0 0 3px rgba(41,73,111,.12)}button{width:100%;margin-top:20px;border:0;border-radius:10px;padding:14px 16px;background:#10283a;color:#fff;font-size:14px;font-weight:900;cursor:pointer}.msg{min-height:20px;margin-top:12px;font-size:12px;color:#b42318}.links{display:flex;justify-content:space-between;gap:10px;flex-wrap:wrap;margin-top:18px}.links a{font-size:12px;font-weight:800;color:#183c63;text-decoration:none}.foot{text-align:center;background:#f4f7f8;padding:13px 20px;font-size:10px;color:#6a7888}</style><script src="/pwa-register.js" defer></script></head><body><main class="card"><header class="brand"><img src="${logo}" alt="Sindane Asset Solutions"><h1>TMM Asset Health</h1><p>TRACK. PREVENT. PERFORM.</p></header><section class="body"><h2>Sign in</h2><p>Use your authorised company account to continue to the TMM Asset Health workspace.</p><form id="loginForm"><label class="field">Email<input name="email" type="email" autocomplete="username" required></label><label class="field">Password<input name="password" type="password" autocomplete="current-password" required></label><button id="signInBtn" type="submit">Sign in securely</button><div id="msg" class="msg"></div></form><div class="links"><a href="/install-app">Install App</a><a href="/contractor-demo">Open Demo</a></div></section><footer class="foot">Sindane Asset Solutions · Secure cloud-connected software</footer></main><script>(function(){var f=document.getElementById('loginForm'),m=document.getElementById('msg'),b=document.getElementById('signInBtn');f.addEventListener('submit',async function(e){e.preventDefault();m.textContent='';b.disabled=true;b.textContent='Signing in...';try{var fd=new FormData(f);var r=await fetch('/api/contractor/login',{method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify({email:fd.get('email'),password:fd.get('password')})});var j=await r.json().catch(function(){return {}});if(r.ok){window.location.assign('/contractor');return;}m.textContent=j.error||'Sign in failed. Please check your details.';}catch(_){m.textContent='Could not connect to the login service. Please try again.';}finally{b.disabled=false;b.textContent='Sign in securely';}});})();</script></body></html>`;
}

export default {
  async fetch(req:Request,env:Env,ctx:ExecutionContext){
    const url=new URL(req.url);
    if(req.method==="GET" && url.pathname==="/contractor-login"){
      return new Response(loginPage(),{status:200,headers:{"content-type":"text/html; charset=utf-8","cache-control":"no-store","x-frame-options":"DENY","referrer-policy":"same-origin","content-security-policy":"default-src 'self'; img-src 'self' data:; style-src 'self' 'unsafe-inline'; script-src 'self' 'unsafe-inline'; connect-src 'self'; manifest-src 'self'; frame-ancestors 'none'; base-uri 'self'; form-action 'self'"}});
    }
    return currentApp.fetch(req,env as never,ctx as never);
  },
  async scheduled(c:ScheduledController,env:Env,ctx:ExecutionContext){
    const app=currentApp as unknown as {scheduled?:(c:ScheduledController,e:Env,x:ExecutionContext)=>Promise<void>|void};
    if(app.scheduled)return app.scheduled(c,env,ctx);
  }
};
