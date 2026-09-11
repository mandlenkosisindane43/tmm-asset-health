import app from "./mobile-install-email";
import pwaApp from "./router-pwa";
import loginApp from "./router-login-recovery";

interface ExecutionContext { waitUntil(promise: Promise<unknown>): void; passThroughOnException(): void; }
interface ScheduledController { scheduledTime:number; cron:string; noRetry():void; }
interface Env { [key:string]:unknown; }

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
    const path=new URL(req.url).pathname;
    if(path==="/contractor-login" || path==="/api/contractor/login") return loginApp.fetch(req,env as never,ctx as never);
    if(PWA_PATHS.has(path)) return pwaApp.fetch(req,env as never,ctx as never);
    return app.fetch(req,env as never,ctx as never);
  },
  async scheduled(c:ScheduledController,env:Env,ctx:ExecutionContext){
    const target=app as unknown as {scheduled?:(c:ScheduledController,e:Env,x:ExecutionContext)=>Promise<void>|void};
    if(target.scheduled) return target.scheduled(c,env,ctx);
  }
};
