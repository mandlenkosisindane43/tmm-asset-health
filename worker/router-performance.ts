import pwaApp from "./router-pwa";

interface ExecutionContext { waitUntil(promise: Promise<unknown>): void; passThroughOnException(): void; }
interface ScheduledController { scheduledTime:number; cron:string; noRetry():void; }
interface Env { [key:string]: unknown; }

// Keep the PWA router as the canonical application entry point.  The previous
// performance wrapper imported router-login-recovery directly, bypassing the
// PWA layer and producing different behaviour between the website and the
// installed application.
//
// Performance is intentionally conservative here: no server-side fan-out or
// mass page prewarming.  Those requests previously exhausted the Worker and
// caused Cloudflare Error 1102.  Browser navigation remains normal and every
// link is allowed to reach its real route.
function addNavigationSafety(res:Response):Promise<Response>|Response {
  const ct=res.headers.get("content-type")||"";
  if(!ct.includes("text/html")) return res;
  return (async()=>{
    let body=await res.text();
    const css=`<style id="tmm-nav-safety">#sas-master-nav a,.side nav a,.action,.link,.subnav a,a.btn,button,input[type=submit]{pointer-events:auto!important;touch-action:manipulation}#sas-master-nav,.side nav{position:relative;z-index:20}</style>`;
    if(!body.includes('id="tmm-nav-safety"')&&body.includes("</head>")) body=body.replace("</head>",css+"</head>");
    const h=new Headers(res.headers);h.set("cache-control","private, no-store");h.delete("content-length");
    return new Response(body,{status:res.status,statusText:res.statusText,headers:h});
  })();
}

export default {
  async fetch(req:Request,env:Env,ctx:ExecutionContext):Promise<Response>{
    const res=await pwaApp.fetch(req,env as never,ctx);
    return await addNavigationSafety(res);
  },
  async scheduled(c:ScheduledController,env:Env,ctx:ExecutionContext){
    const app=pwaApp as unknown as {scheduled?:(c:ScheduledController,e:Env,x:ExecutionContext)=>Promise<void>|void};
    if(app.scheduled) return app.scheduled(c,env,ctx);
  }
};
