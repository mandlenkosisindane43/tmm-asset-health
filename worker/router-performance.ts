import currentApp from "./router-login-recovery";

interface ExecutionContext { waitUntil(promise: Promise<unknown>): void; passThroughOnException(): void; }
interface ScheduledController { scheduledTime:number; cron:string; noRetry():void; }
interface Env { [key:string]: unknown; }

type CachedPage={status:number;statusText:string;headers:[string,string][];body:string;expires:number};
const PAGE_TTL_MS=30000;
const pageCache=new Map<string,CachedPage>();
const MAX_CACHE=120;
const COOKIE="sas_contractor_v2";

function cookie(req:Request){
  const raw=req.headers.get("cookie")||"";
  for(const part of raw.split(";")){
    const i=part.indexOf("=");
    if(i>0&&part.slice(0,i).trim()===COOKIE)return part.slice(i+1).trim();
  }
  return "";
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
  const style=`<style id="tmm-fast-nav-style">#sas-master-nav a,.side nav a,.action,.link,.subnav a,a.btn,button,input[type=submit]{pointer-events:auto!important;position:relative;z-index:3;touch-action:manipulation;cursor:pointer}#sas-master-nav{position:relative;z-index:10000}</style>`;
  const script=`<script id="tmm-fast-nav-script">(function(){
    var pending=null,controller=null;
    function sameApp(a){try{var u=new URL(a.href,location.href);if(u.origin!==location.origin)return false;if(a.target&&a.target!=='_self')return false;if(a.hasAttribute('download'))return false;return u.pathname==='/contractor'||u.pathname==='/contractor-reports'||u.pathname==='/history'||u.pathname==='/history-library'||u.pathname==='/recycle-bin'||u.pathname==='/security-recovery'||u.pathname==='/condition-monitoring'||u.pathname==='/reliability-workflow'||u.pathname==='/automatic-alert-email'||u.pathname==='/month-end';}catch(_){return false;}}
    function warm(href){
      if(pending===href)return;
      if(controller)controller.abort();
      controller=new AbortController();pending=href;
      fetch(href,{credentials:'same-origin',headers:{'x-tmm-client-prewarm':'1'},signal:controller.signal}).catch(function(){}).finally(function(){pending=null;controller=null;});
    }
    document.querySelectorAll('a[href]').forEach(function(a){
      if(!sameApp(a))return;
      a.style.pointerEvents='auto';
      a.addEventListener('pointerenter',function(){warm(a.href)},{passive:true});
      a.addEventListener('focus',function(){warm(a.href)},{passive:true});
    });
    document.querySelectorAll('button,input[type=submit]').forEach(function(b){if(!b.disabled)b.style.pointerEvents='auto';});
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

export default{
  async fetch(req:Request,env:Env,ctx:ExecutionContext):Promise<Response>{
    const url=new URL(req.url);const method=req.method.toUpperCase();const currentToken=cookie(req);

    if(method!=="GET"&&url.pathname!=="/api/contractor/login")invalidate(currentToken);

    if(pageEligible(url,method)&&currentToken){
      const cached=pageCache.get(key(currentToken,url));
      if(cached&&cached.expires>Date.now())return fromCache(cached);
      if(cached)pageCache.delete(key(currentToken,url));
    }

    // IMPORTANT: only render the page the user actually requested.
    // Do not server-prewarm every module; that caused Cloudflare Error 1102 resource-limit failures.
    const res=await currentApp.fetch(req,env as never,ctx as never);

    if(pageEligible(url,method)&&currentToken)return saveResponse(currentToken,url,res);
    return res;
  },
  async scheduled(c:ScheduledController,env:Env,ctx:ExecutionContext){
    const app=currentApp as unknown as {scheduled?:(c:ScheduledController,e:Env,x:ExecutionContext)=>Promise<void>|void};
    if(app.scheduled)return app.scheduled(c,env,ctx);
  }
};
