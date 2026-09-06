import currentApp from "./router-login-recovery";

interface ExecutionContext { waitUntil(promise: Promise<unknown>): void; passThroughOnException(): void; }
interface ScheduledController { scheduledTime:number; cron:string; noRetry():void; }
interface Env { [key:string]: unknown; }

type CachedPage={status:number;statusText:string;headers:[string,string][];body:string;expires:number};
const PAGE_TTL_MS=45000;
const pageCache=new Map<string,CachedPage>();
const MAX_CACHE=320;
const COOKIE="sas_contractor_v2";

const PRIMARY_PREWARM_URLS=[
  "/contractor?view=dashboard",
  "/contractor?view=breakdowns",
  "/contractor?view=maintenance",
  "/contractor?view=fleet",
  "/contractor?view=production",
  "/contractor?view=daily",
  "/contractor?view=users",
  "/contractor?view=alerts",
  "/contractor?view=telemetry",
  "/contractor?view=settings",
  "/contractor?view=setup",
  "/contractor?view=documents"
];
const SECONDARY_PREWARM_URLS=[
  "/contractor-reports",
  "/history",
  "/recycle-bin",
  "/security-recovery",
  "/condition-monitoring",
  "/reliability-workflow",
  "/automatic-alert-email",
  "/month-end"
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
  const h=new Headers(c.headers);h.set("x-tmm-page-cache","hit");h.set("cache-control","private, no-store");h.delete("content-length");
  return new Response(c.body,{status:c.status,statusText:c.statusText,headers:h});
}

function injectNavigationUx(body:string){
  if(body.includes("id=\"tmm-fast-nav-style\""))return body;
  const style=`<style id="tmm-fast-nav-style">#sas-master-nav a,.side nav a,.action,.link,.subnav a,a.btn,button,input[type=submit]{pointer-events:auto!important;position:relative;z-index:2;touch-action:manipulation}#sas-master-nav{position:relative;z-index:10000}.tmm-nav-loading{cursor:progress!important;opacity:.82!important}</style>`;
  const script=`<script id="tmm-fast-nav-script">(function(){
    var warming=new Set();
    function sameApp(a){try{var u=new URL(a.href,location.href);if(u.origin!==location.origin)return false;if(a.target&&a.target!=='_self')return false;if(a.hasAttribute('download'))return false;return u.pathname==='/contractor'||u.pathname==='/contractor-reports'||u.pathname==='/history'||u.pathname==='/history-library'||u.pathname==='/recycle-bin'||u.pathname==='/security-recovery'||u.pathname==='/condition-monitoring'||u.pathname==='/reliability-workflow'||u.pathname==='/automatic-alert-email'||u.pathname==='/month-end';}catch(_){return false;}}
    function warm(href){if(warming.has(href))return;warming.add(href);fetch(href,{credentials:'same-origin',headers:{'x-tmm-client-prewarm':'1'}}).catch(function(){}).finally(function(){setTimeout(function(){warming.delete(href)},30000)});}
    function wire(root){(root||document).querySelectorAll('a[href]').forEach(function(a){if(!sameApp(a))return;a.style.pointerEvents='auto';a.addEventListener('pointerenter',function(){warm(a.href)},{passive:true});a.addEventListener('touchstart',function(){warm(a.href)},{passive:true});});(root||document).querySelectorAll('button,input[type=submit]').forEach(function(b){if(!b.disabled)b.style.pointerEvents='auto';});}
    wire(document);
    var first=['/contractor?view=dashboard','/contractor?view=breakdowns','/contractor?view=maintenance','/contractor?view=fleet','/contractor?view=production','/contractor?view=daily','/contractor?view=users','/contractor?view=alerts','/contractor?view=telemetry','/contractor?view=settings'];
    setTimeout(function(){first.forEach(warm)},100);
    window.addEventListener('pageshow',function(){wire(document)});
  })();</script>`;
  if(body.includes("</head>"))body=body.replace("</head>",style+"</head>");
  if(body.includes("</body>"))body=body.replace("</body>",script+"</body>");
  return body;
}

async function saveResponse(token:string,url:URL,res:Response){
  if(!token||!pageEligible(url,"GET")||res.status!==200)return res;
  const ct=res.headers.get("content-type")||"";if(!ct.includes("text/html"))return res;
  const body=injectNavigationUx(await res.text());
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
    const body=injectNavigationUx(await res.text());const stored:[string,string][]=[];res.headers.forEach((v,k)=>stored.push([k,v]));
    pageCache.set(key(token,target),{status:res.status,statusText:res.statusText,headers:stored,body,expires:Date.now()+PAGE_TTL_MS});
  }catch(e){console.error("TMM_PREWARM_ERROR",path,e)}
}
async function prewarm(req:Request,token:string,env:Env,ctx:ExecutionContext){
  if(!token)return;
  // Prepare all high-use company modules together so Fleet/Breakdowns/Production/etc are ready at the same time.
  await Promise.all(PRIMARY_PREWARM_URLS.map(p=>renderAndStore(p,req,token,env,ctx)));
  prune();
  // Lower-use pages are prepared after the main presentation/navigation views are ready.
  await Promise.all(SECONDARY_PREWARM_URLS.map(p=>renderAndStore(p,req,token,env,ctx)));
  prune();
}

export default{
  async fetch(req:Request,env:Env,ctx:ExecutionContext):Promise<Response>{
    const url=new URL(req.url);const method=req.method.toUpperCase();const currentToken=cookie(req);

    if(method!=="GET"&&url.pathname!=="/api/contractor/login")invalidate(currentToken);

    if(pageEligible(url,method)&&currentToken){
      const cached=pageCache.get(key(currentToken,url));
      if(cached&&cached.expires>Date.now()){
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
