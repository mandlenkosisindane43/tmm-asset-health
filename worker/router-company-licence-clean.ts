import currentApp from "./router-company-licence";

interface ExecutionContext { waitUntil(promise: Promise<unknown>): void; passThroughOnException(): void; }
interface ScheduledController { scheduledTime:number; cron:string; noRetry():void; }
interface Env { DB:D1Database; [key:string]:unknown; }

function cleanCertificate(body:string){
  // Remove the entire signature/authorization block so no empty signature space remains.
  body = body.replace(/<div class="footer"><div class="signature">[\s\S]*?<\/div><div class="seal">/i,'<div class="footer" style="justify-content:flex-end"><div class="seal">');
  body = body.replace(/\.signature\{[^}]*\}/g,"");
  return body;
}

export default {
  async fetch(req:Request,env:Env,ctx:ExecutionContext){
    const res=await currentApp.fetch(req,env as never,ctx as never);
    const url=new URL(req.url);
    if(req.method!=="GET"||url.pathname!=="/company-licence/certificate")return res;
    const ct=res.headers.get("content-type")||"";
    if(!ct.includes("text/html"))return res;
    let body=await res.text();
    body=cleanCertificate(body);
    const h=new Headers(res.headers);h.delete("content-length");h.set("cache-control","private, no-store");
    return new Response(body,{status:res.status,statusText:res.statusText,headers:h});
  },
  async scheduled(c:ScheduledController,env:Env,ctx:ExecutionContext){
    const app=currentApp as unknown as {scheduled?:(c:ScheduledController,e:Env,x:ExecutionContext)=>Promise<void>|void};
    if(app.scheduled)return app.scheduled(c,env,ctx);
  }
};
