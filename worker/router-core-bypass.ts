import currentApp from "./router-login-recovery";
import { handleCompanyAdminV3 } from "./company-admin-v3";
import { handleContractorReports } from "./contractor-reports";

interface ExecutionContext { waitUntil(promise: Promise<unknown>): void; passThroughOnException(): void; }
interface ScheduledController { scheduledTime:number; cron:string; noRetry():void; }
interface Env { DB:D1Database; BUCKET?:R2Bucket; [key:string]:unknown; }

// These company-admin pages are presentation-critical and already have complete
// handlers in company-admin-v3.  Sending them through the entire historical
// wrapper stack causes many D1/API operations in one Worker invocation and can
// hit Cloudflare's subrequest limit (Error 1101).  Route them directly.
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

export default {
  async fetch(req:Request,env:Env,ctx:ExecutionContext):Promise<Response>{
    const url=new URL(req.url);

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

    // Everything else keeps the currently working feature chain.
    return currentApp.fetch(req,env as never,ctx as never);
  },
  async scheduled(c:ScheduledController,env:Env,ctx:ExecutionContext){
    const app=currentApp as unknown as {scheduled?:(c:ScheduledController,e:Env,x:ExecutionContext)=>Promise<void>|void};
    if(app.scheduled) return app.scheduled(c,env,ctx);
  }
};
