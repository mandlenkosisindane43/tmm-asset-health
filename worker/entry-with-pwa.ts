import { ensureAccountRoles } from "./account-roles";
import app from "./mobile-install-email";
import pwaApp from "./router-pwa";
import loginApp from "./router-login-recovery";

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
    const path=new URL(req.url).pathname;
     if (path === "/industrial-preview" || path === "/industrial-preview/") {
  return new Response(
    `<!DOCTYPE html>
    <html lang="en">
      <head>
        <meta charset="UTF-8">
        <meta name="viewport" content="width=device-width, initial-scale=1">
        <title>TMM Asset Health — Industrial Preview</title>
      </head>
      <body style="background:#071827;color:white;font-family:Arial;padding:40px">
        <h1 style="color:#f4b83e">TMM Asset Health</h1>
        <h2>Industrial Dashboard Preview</h2>
        <p>The preview Worker is responding successfully.</p>
      </body>
    </html>`,
    {
      headers: {
        "Content-Type": "text/html; charset=utf-8",
        "Cache-Control": "no-store"
      }
    }
  );
}
    // The isolated industrial preview has no database reads or writes.\n    // Avoid global role-schema initialization on its requests; it can exhaust\n    // the Worker subrequest budget and unnecessarily touch the D1 binding.\n    if (path !== "/industrial-preview" && !path.startsWith("/industrial-preview/")) {\n      await ensureAccountRoles(env);\n    }
    if(path==="/contractor-login" || path==="/api/contractor/login") return loginApp.fetch(req,env as never,ctx as never);
    if(PWA_PATHS.has(path)) return pwaApp.fetch(req,env as never,ctx as never);
    return app.fetch(req,env as never,ctx as never);
  },
  async scheduled(c:ScheduledController,env:Env,ctx:ExecutionContext){
    const target=app as unknown as {scheduled?:(c:ScheduledController,e:Env,x:ExecutionContext)=>Promise<void>|void};
    if(target.scheduled) return target.scheduled(c,env,ctx);
  }
};
