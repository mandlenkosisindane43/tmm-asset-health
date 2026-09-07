import coreApp from "./router-core-bypass";
import ownerApp from "./router-owner-platform";
import licenceApp from "./router-company-licence-clean";
import telemetryApp from "./router-telemetry-ready";
import classicCompanyAdminApp from "./router-company-admin-demo-ui-v2";
import { handleCompanyAdminV3 } from "./company-admin-v3";

interface ExecutionContext { waitUntil(promise: Promise<unknown>): void; passThroughOnException(): void; }
interface ScheduledController { scheduledTime:number; cron:string; noRetry():void; }
interface Env { DB:D1Database; BUCKET?:R2Bucket; [key:string]:unknown; }

export default {
  async fetch(req:Request,env:Env,ctx:ExecutionContext):Promise<Response>{
    const url=new URL(req.url), path=url.pathname;

    // Presentation-safe alias for the full navy/white Company Admin workspace.
    if(path==="/presentation-full"){
      const target=new URL(req.url);
      target.pathname="/contractor";
      target.search="";
      return classicCompanyAdminApp.fetch(new Request(target.toString(),req),env as never,ctx as never);
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

    // Restore the full navy/white Company Admin workspace with all admin modules
    // visible in the left sidebar, as used in the earlier presentation version.
    if(path==="/contractor" && req.method==="GET"){
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
