import { machineHistory } from "./machine-history-direct";
import app from "./mobile-install-email";
import pwaApp from "./router-pwa";
import loginApp from "./router-login-recovery";
import vinextBase from "./vinext-base";

interface ExecutionContext { waitUntil(promise: Promise<unknown>): void; passThroughOnException(): void; }
interface ScheduledController { scheduledTime:number; cron:string; noRetry():void; }
interface Env { DB:D1Database; [key:string]:unknown; }

const PWA_PATHS = new Set([
  "/install-app",
  "/install-owner-app",
  "/app.webmanifest",
  "/owner-app.webmanifest",
  "/app-icon.svg",
  "/owner-app-icon.svg",
  "/pwa-register.js",
  "/sw.js",
  "/app-start",
  "/contractor-login",
  "/api/contractor/login",
]);

export default {
  async fetch(req:Request,env:Env,ctx:ExecutionContext):Promise<Response>{
    const url=new URL(req.url);
    const path=url.pathname;
    // Route the Machine History navigation to the company-isolated records workspace.
    if(req.method==="GET" && path==="/contractor" && ["machine-history","history"].includes(url.searchParams.get("view")||"")){
      const target=new URL("/fleet-history",url);
      const machine=url.searchParams.get("machine");
      if(machine)target.searchParams.set("machine",machine);
      return Response.redirect(target,302);
    }
    if(path==="/fleet-history") return machineHistory(req,env);
    // Role schema setup is not a per-request responsibility.
    // Role-aware operations invoke ensureAccountRoles only when required.
    // Next.js operations has its own authentication and data access.
    // Bypass the legacy Worker wrapper chain, whose global handlers perform D1 work.
    if(path==="/login" || path==="/api/auth/login" || path==="/logout" || path==="/callback" || path==="/operations" || path.startsWith("/operations/")) return vinextBase.fetch(req,env as never,ctx as never);
    if(path==="/contractor-login" || path==="/api/contractor/login") return loginApp.fetch(req,env as never,ctx as never);
    if(PWA_PATHS.has(path)) return pwaApp.fetch(req,env as never,ctx as never);
    return app.fetch(req,env as never,ctx as never);
  },
  async scheduled(c:ScheduledController,env:Env,ctx:ExecutionContext){
    const target=app as unknown as {scheduled?:(c:ScheduledController,e:Env,x:ExecutionContext)=>Promise<void>|void};
    if(target.scheduled) return target.scheduled(c,env,ctx);
  }
};
