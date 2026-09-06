import currentApp from "./router-login-recovery";

interface ExecutionContext { waitUntil(promise: Promise<unknown>): void; passThroughOnException(): void; }
interface ScheduledController { scheduledTime:number; cron:string; noRetry():void; }
interface Env { [key:string]: unknown; }

type CachedPage={status:number;statusText:string;headers:[string,string][];body:string;expires:number};
const PAGE_TTL_MS=12000;
const pageCache=new Map<string,CachedPage>();
const MAX_CACHE=240;
const COOKIE="sas_contractor_v2";

const PREWARM_URLS=[
  "/contractor?view=dashboard",
  "/contractor?view=fleet",
  "/contractor?view=breakdowns",
  "/contractor?view=maintenance",
  "/contractor?view=production",
  "/contractor?view=daily",
  "/contractor?view=users",
  "/contractor?view=alerts",
  "/contractor?view=telemetry",
  "/contractor?view=settings",
  "/contractor?view=setup",
  "/contractor?view=documents",
  "/contractor-reports",
  "/history",
  "/recycle-bin",
  "/security-recovery"
];

function cookie(req:Request){
  const raw=req.headers.get("cookie")||"";
  for(const part of raw.split(";")){
    const i=part.indexOf("=");
    if(i>0&&part.slice(0,i).trim()===COOKIE)return part.slice(i+1).trim();
  }
  return "";
}
function tokenFromSetCookie(value:string){
  const m=value.match(/(?:^|[,;]\s*)sas_contractor_v2=([^;]+)/i);
  return m?m[1].trim():"";
}
function pageEligible(url:URL,method:string){
  if(method!=="GET")return false;
  if(url.searchParams.has("msg")||url.searchParams.has("tone"))return false;
  return url.pathname==="/contractor"||url.pathname==="/contractor-reports"||url.pathname==="/history"||url.pathname==="/history-library"||url.pathname==="/recycle-bin"||url.pathname==="/security-recovery"||url.pathname==="/condition-monitoring"||url.pathname==="/reliability-workflow"||url.pathname==="/automatic-alert-email"||url.pathname==="/month-end";
}
function key(token:string,url:URL){return token+"|"+url.pathname+url.search}
function prune(){
  const now=Date.now();
  for(const [k,v] of pageCache)if(v.expires<=now)pageCache.delete(k);
  while(pageCache.size>MAX_CACHE){const first=pageCache.keys().next().value;if(!first)break;pageCache.delete(first)}
}
function invalidate(token:string){if(!token)return;for(const k of pageCache.keys())if(k.startsWith(token+"|"))pageCache.delete(k)}
function fromCache(c:CachedPage){
  const h=new Headers(c.headers);h.set("x-tmm-page-cache","hit");h.set("cache-control","private, no-store");
  return new Response(c.body,{status:c.status,statusText:c.statusText,headers:h});
}
async function saveResponse(token:string,url:URL,res:Response){
  if(!token||!pageEligible(url,"GET")||res.status!==200)return res;
  const ct=res.headers.get("content-type")||"";if(!ct.includes("text/html"))return res;
  const body=await res.text();
  const headers:Array<[string,string]>=[];res.headers.forEach((v,k)=>headers.push([k,v]));
  pageCache.set(key(token,url),{status:res.status,statusText:res.statusText,headers,body,expires:Date.now()+PAGE_TTL_MS});
  prune();
  const h=new Headers(res.headers);h.set("x-tmm-page-cache","miss");h.delete("content-length");
  return new Response(body,{status:res.status,statusText:res.statusText,headers:h});
}
async function renderAndStore(path:string,baseReq:Request,token:string,env:Env,ctx:ExecutionContext){
  try{
    const target=new URL(path,baseReq.url);
    const existing=pageCache.get(key(token,target));if(existing&&existing.expires>Date.now())return;
    const headers=new Headers(baseReq.headers);headers.set("cookie",`${COOKIE}=${token}`);headers.set("x-tmm-prewarm","1");
    const req=new Request(target.toString(),{method:"GET",headers});
    const res=await currentApp.fetch(req,env as never,ctx as never);
    if(res.status!==200)return;
    const ct=res.headers.get("content-type")||"";if(!ct.includes("text/html"))return;
    const body=await res.text();const stored:[string,string][]=[];res.headers.forEach((v,k)=>stored.push([k,v]));
    pageCache.set(key(token,target),{status:res.status,statusText:res.statusText,headers:stored,body,expires:Date.now()+PAGE_TTL_MS});
  }catch(e){console.error("TMM_PREWARM_ERROR",path,e)}
}
async function prewarm(req:Request,token:string,env:Env,ctx:ExecutionContext){
  if(!token)return;
  // Small batches prevent one navigation from creating a large D1 burst.
  for(let i=0;i<PREWARM_URLS.length;i+=4){
    await Promise.all(PREWARM_URLS.slice(i,i+4).map(p=>renderAndStore(p,req,token,env,ctx)));
  }
  prune();
}

export default{
  async fetch(req:Request,env:Env,ctx:ExecutionContext):Promise<Response>{
    const url=new URL(req.url);const method=req.method.toUpperCase();const currentToken=cookie(req);

    if(method!=="GET"&&url.pathname!=="/api/contractor/login")invalidate(currentToken);

    if(pageEligible(url,method)&&currentToken){
      const cached=pageCache.get(key(currentToken,url));
      if(cached&&cached.expires>Date.now()){
        // Refresh in the background so repeated navigation remains fast without a long stale window.
        ctx.waitUntil(renderAndStore(url.pathname+url.search,req,currentToken,env,ctx));
        return fromCache(cached);
      }
      if(cached)pageCache.delete(key(currentToken,url));
    }

    const res=await currentApp.fetch(req,env as never,ctx as never);

    if(method==="POST"&&url.pathname==="/api/contractor/login"&&res.ok){
      const token=tokenFromSetCookie(res.headers.get("set-cookie")||"");
      if(token){invalidate(token);ctx.waitUntil(prewarm(req,token,env,ctx));}
      return res;
    }

    if(pageEligible(url,method)&&currentToken){
      const stored=await saveResponse(currentToken,url,res);
      // Once any company page opens, prepare the rest of the navigation in the background.
      ctx.waitUntil(prewarm(req,currentToken,env,ctx));
      return stored;
    }
    return res;
  },
  async scheduled(c:ScheduledController,env:Env,ctx:ExecutionContext){
    const app=currentApp as unknown as {scheduled?:(c:ScheduledController,e:Env,x:ExecutionContext)=>Promise<void>|void};
    if(app.scheduled)return app.scheduled(c,env,ctx);
  }
};
