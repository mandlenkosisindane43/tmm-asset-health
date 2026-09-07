import currentApp from "./router-login-recovery";
import { handleCompanyAdminV3 } from "./company-admin-v3";
import { handleContractorReports } from "./contractor-reports";
import { sindaneLogoDataUri } from "./sindane-logo-data";

interface ExecutionContext { waitUntil(promise: Promise<unknown>): void; passThroughOnException(): void; }
interface ScheduledController { scheduledTime:number; cron:string; noRetry():void; }
interface Env { DB:D1Database; BUCKET?:R2Bucket; [key:string]:unknown; }

// These company-admin pages are presentation-critical and already have complete
// handlers in company-admin-v3. Sending them through the entire historical
// wrapper stack causes many D1/API operations in one Worker invocation and can
// hit Cloudflare's subrequest limit (Error 1101). Route them directly.
const DIRECT_VIEWS = new Set([
  "fleet",
  "daily",
  "users",
  "alerts",
  "approvals",
  "setup",
  "settings",
  "documents",
  "reports-admin"
]);

function isDirectCompanyRoute(req:Request,url:URL){
  if(url.pathname.startsWith("/company-admin/")) return true;
  if(url.pathname!=="/contractor") return false;
  const view=url.searchParams.get("view")||"dashboard";
  return DIRECT_VIEWS.has(view);
}

function ownerLoginPage(){
  const logo=sindaneLogoDataUri();
  return `<!doctype html><html><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><meta name="theme-color" content="#061827"><link rel="manifest" href="/owner-app.webmanifest"><link rel="icon" href="/owner-app-icon.svg" type="image/svg+xml"><title>Sindane Platform Owner Login</title><style>*{box-sizing:border-box}html,body{margin:0;min-height:100%;font-family:Arial,Helvetica,sans-serif}body{min-height:100vh;display:grid;place-items:center;padding:24px;background:linear-gradient(145deg,#061827,#0a2132);color:#102035}.card{width:min(470px,100%);background:#fff;border-radius:20px;overflow:hidden;box-shadow:0 22px 70px rgba(0,0,0,.3)}.brand{background:#071a29;text-align:center;padding:24px;border-bottom:4px solid #11975c}.brand img{width:190px;height:120px;object-fit:contain}.brand h1{margin:6px 0 2px;color:#fff;font-size:25px}.brand p{margin:0;color:#e6a600;font-size:10px;font-weight:900;letter-spacing:3px}.body{padding:28px}.body h2{margin:0 0 6px;font-size:24px;color:#0b2036}.body>p{margin:0 0 18px;color:#66778a;font-size:13px;line-height:1.5}.field{display:grid;gap:7px;margin-top:14px;font-size:12px;font-weight:800;color:#263b52}.field input{width:100%;padding:13px 14px;border:1px solid #cbd6e2;border-radius:9px;font-size:15px;outline:none}.field input:focus{border-color:#29496f;box-shadow:0 0 0 3px rgba(41,73,111,.12)}button,.btn{display:block;width:100%;margin-top:20px;border:0;border-radius:10px;padding:14px 16px;background:#10283a;color:#fff;font-size:14px;font-weight:900;cursor:pointer;text-align:center;text-decoration:none}.btn.gray{background:#edf2f5;color:#213648;margin-top:10px}.foot{text-align:center;background:#f4f7f8;padding:13px 20px;font-size:10px;color:#6a7888}</style></head><body><main class="card"><header class="brand"><img src="${logo}" alt="Sindane Asset Solutions"><h1>Sindane Platform Owner</h1><p>TRACK. PREVENT. PERFORM.</p></header><section class="body"><h2>Platform Owner Login</h2><p>Private control area for Sindane Asset Solutions.</p><form method="post" action="/owner-login"><label class="field">Owner email<input type="email" name="email" value="admin@sindaneassetsolutions.co.za" required autocomplete="username"></label><label class="field">Owner password<input type="password" name="password" required autocomplete="current-password"></label><button type="submit">Sign in as Platform Owner</button></form><a class="btn gray" href="/install-owner-app">Install Owner App</a></section><footer class="foot">Sindane Asset Solutions · Secure cloud-connected software</footer></main></body></html>`;
}

export default {
  async fetch(req:Request,env:Env,ctx:ExecutionContext):Promise<Response>{
    const url=new URL(req.url);

    // Lightweight GET route: do not initialise schemas or traverse the legacy
    // router chain just to render the owner login screen. This was the main
    // source of "Too many API requests by single Worker invocation" on /owner-login.
    if(req.method==="GET" && url.pathname==="/owner-login"){
      return new Response(ownerLoginPage(),{status:200,headers:{
        "content-type":"text/html; charset=utf-8",
        "cache-control":"no-store",
        "x-frame-options":"DENY",
        "referrer-policy":"same-origin"
      }});
    }

    // Browsers request /favicon.ico automatically. Serve it without traversing
    // the application/router stack, avoiding needless D1/API work.
    if(req.method==="GET" && url.pathname==="/favicon.ico"){
      return new Response(null,{status:302,headers:{location:"/favicon.svg","cache-control":"public, max-age=86400"}});
    }

    // Core Company Admin pages: one direct handler, no legacy wrapper cascade.
    if(isDirectCompanyRoute(req,url)){
      const direct=await handleCompanyAdminV3(req,env as never);
      if(direct) return direct;
    }

    // Reports Centre has its own complete server handler; bypass wrappers here too.
    if(url.pathname==="/contractor-reports" || url.pathname.startsWith("/contractor-reports/")){
      const reports=await handleContractorReports(req,env as never);
      if(reports) return reports;
    }

    // Everything else keeps the currently working feature chain, including
    // POST /owner-login, which still performs the real credential/session check.
    return currentApp.fetch(req,env as never,ctx as never);
  },
  async scheduled(c:ScheduledController,env:Env,ctx:ExecutionContext){
    const app=currentApp as unknown as {scheduled?:(c:ScheduledController,e:Env,x:ExecutionContext)=>Promise<void>|void};
    if(app.scheduled) return app.scheduled(c,env,ctx);
  }
};
