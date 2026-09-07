import coreApp from "./router-core-bypass";
import ownerApp from "./router-owner-platform";
import licenceApp from "./router-company-licence-clean";
import telemetryApp from "./router-telemetry-ready";
import classicCompanyAdminApp from "./router-company-admin-demo-ui-v2";
import { handleCompanyAdminV3 } from "./company-admin-v3";

interface ExecutionContext { waitUntil(promise: Promise<unknown>): void; passThroughOnException(): void; }
interface ScheduledController { scheduledTime:number; cron:string; noRetry():void; }
interface Env { DB:D1Database; BUCKET?:R2Bucket; [key:string]:unknown; }

function hasCompanySession(req:Request){
  return /(?:^|;\s*)sas_contractor_v2=/.test(req.headers.get("cookie")||"");
}

export default {
  async fetch(req:Request,env:Env,ctx:ExecutionContext):Promise<Response>{
    const url=new URL(req.url), path=url.pathname;

    // Always enter the full navy/white Company Admin workspace through the
    // normal company login so presentation users never fall into a legacy
    // unauthenticated router chain.
    if(path==="/presentation-full"){
      return new Response(null,{status:302,headers:{location:"/contractor-login","cache-control":"no-store"}});
    }

    if(path==="/owner-login" || path==="/owner" || path.startsWith("/owner/")){
      return ownerApp.fetch(req,env as never,ctx as never);
    }

    if(path==="/company-licence" || path.startsWith("/company-licence/")){
      return licenceApp.fetch(req,env as never,ctx as never);
    }

    if(path==="/telemetry" || path.startsWith("/telemetry/") || path.startsWith("/api/telemetry")){
      return telemetryApp.fetch(req,env as never,ctx as never);
    }

    // The full navy/white Company Admin workspace is only rendered when a
    // contractor session cookie is present. Missing sessions go directly to
    // login instead of the historical heavy fallback chain that caused 1101.
    if(path==="/contractor" && req.method==="GET"){
      if(!hasCompanySession(req)){
        return new Response(null,{status:303,headers:{location:"/contractor-login","cache-control":"no-store"}});
      }
      return classicCompanyAdminApp.fetch(req,env as never,ctx as never);
    }

    // Keep working Company Admin POST/action handlers on the direct lightweight path.
    if(path.startsWith("/company-admin/")){
      const direct=await handleCompanyAdminV3(req,env as never);
      if(direct) return direct;
    }

    const res=await coreApp.fetch(req,env as never,ctx as never);
    return res;
  },
  async scheduled(c:ScheduledController,env:Env,ctx:ExecutionContext){
    const app=coreApp as unknown as {scheduled?:(c:ScheduledController,e:Env,x:ExecutionContext)=>Promise<void>|void};
    if(app.scheduled) return app.scheduled(c,env,ctx);
  }
};
