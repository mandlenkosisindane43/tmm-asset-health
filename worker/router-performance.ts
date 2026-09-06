import app from "./router-login-recovery";

interface ExecutionContext { waitUntil(promise: Promise<unknown>): void; passThroughOnException(): void; }
interface ScheduledController { scheduledTime:number; cron:string; noRetry():void; }
interface Env { [key:string]: unknown; }

// router-login-recovery already includes the PWA click-fix and PWA routers.
// Keep this wrapper deliberately light: no mass prewarming, no server-side
// fan-out, and no page cache that can exhaust Cloudflare Worker resources.
async function addNavigationSafety(res:Response):Promise<Response>{
  const ct=res.headers.get("content-type")||"";
  if(!ct.includes("text/html")) return res;
  let body=await res.text();
  const css=`<style id="tmm-nav-safety">#sas-master-nav a,.side nav a,.action,.link,.subnav a,a.btn,button,input[type=submit]{pointer-events:auto!important;touch-action:manipulation}#sas-master-nav,.side nav{position:relative;z-index:20}</style>`;
  if(!body.includes('id="tmm-nav-safety"')&&body.includes("</head>")) body=body.replace("</head>",css+"</head>");
  const h=new Headers(res.headers);h.set("cache-control","private, no-store");h.delete("content-length");
  return new Response(body,{status:res.status,statusText:res.statusText,headers:h});
}

export default {
  async fetch(req:Request,env:Env,ctx:ExecutionContext):Promise<Response>{
    const res=await app.fetch(req,env as never,ctx);
    return addNavigationSafety(res);
  },
  async scheduled(c:ScheduledController,env:Env,ctx:ExecutionContext){
    const wrapped=app as unknown as {scheduled?:(c:ScheduledController,e:Env,x:ExecutionContext)=>Promise<void>|void};
    if(wrapped.scheduled) return wrapped.scheduled(c,env,ctx);
  }
};
