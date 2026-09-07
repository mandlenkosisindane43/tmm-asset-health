import classicApp from "./router-company-admin-demo-ui-v2";
import { handleCompanyAdminV3 } from "./company-admin-v3";
import { navyCompanyTheme } from "./navy-company-theme";

interface ExecutionContext { waitUntil(promise: Promise<unknown>): void; passThroughOnException(): void; }
interface ScheduledController { scheduledTime:number; cron:string; noRetry():void; }
interface Env { DB:D1Database; [key:string]:unknown; }
type Row=Record<string,unknown>;

const SAFE_V3_VIEWS = new Set(["fleet","daily","users","alerts","approvals","reports-admin","documents","setup","settings"]);
const enc=new TextEncoder();

const fullNav = `<nav>
<a data-nav="dashboard" href="/contractor"><span>⌂</span>Dashboard</a>
<a data-nav="breakdowns" href="/contractor?view=breakdowns"><span>⚙</span>Breakdowns</a>
<a data-nav="maintenance" href="/contractor?view=maintenance"><span>▦</span>Maintenance</a>
<a data-nav="production" href="/contractor?view=production"><span>▥</span>Production</a>
<a data-nav="reports-live" href="/contractor?view=reports-live"><span>▤</span>Reports</a>
<a data-nav="fleet" href="/contractor?view=fleet"><span>▣</span>Fleet</a>
<a data-nav="daily" href="/contractor?view=daily"><span>⇧</span>Daily Reports</a>
<a data-nav="users" href="/contractor?view=users"><span>♙</span>Users & Roles</a>
<a data-nav="alerts" href="/contractor?view=alerts"><span>!</span>Alerts</a>
<a data-nav="approvals" href="/contractor?view=approvals"><span>✓</span>Approvals</a>
<a data-nav="reports-admin" href="/contractor?view=reports-admin"><span>▤</span>Reports Centre</a>
<a data-nav="previous" href="/trial-demo"><span>◈</span>Previous Month</a>
<a data-nav="documents" href="/contractor?view=documents"><span>▱</span>Documents</a>
<a data-nav="setup" href="/contractor?view=setup"><span>⚙</span>Company Setup</a>
<a data-nav="licence" href="/company-licence"><span>▧</span>Licence</a>
<a data-nav="telematics" href="/telemetry"><span>⌁</span>Telematics</a>
<a data-nav="settings" href="/contractor?view=settings"><span>⚙</span>Settings</a>
<a data-nav="subscription-request" href="/contractor?view=subscription-request"><span>◇</span>Subscription Request</a>
</nav>`;

function esc(v:unknown){return String(v??"").replace(/[&<>"']/g,c=>({"&":"&amp;","<":"&lt;",">":"&gt;",'"':"&quot;","'":"&#39;"}[c]||c));}
function getCookie(req:Request){for(const p of (req.headers.get("cookie")||"").split(";")){const i=p.indexOf("=");if(i>-1&&p.slice(0,i).trim()==="sas_contractor_v2")return p.slice(i+1).trim()}return "";}
async function sha256(v:string){return Array.from(new Uint8Array(await crypto.subtle.digest("SHA-256",enc.encode(v))),b=>b.toString(16).padStart(2,"0")).join("");}
async function account(req:Request,env:Env){const token=getCookie(req);if(!token)return null;try{return await env.DB.prepare(`SELECT a.full_name fullName,a.email,a.role,c.name companyName,c.licence_status licenceStatus FROM contractor_sessions s JOIN contractor_accounts a ON a.id=s.account_id AND a.company_id=s.company_id JOIN companies c ON c.id=s.company_id WHERE s.token_hash=? LIMIT 1`).bind(await sha256(token)).first<Row>()}catch{return null}}

function fullSidebar(view:string,a:Row|null){
 const active=view==="reports"?"reports-live":view;
 const nav=fullNav.replace(`data-nav="${active}"`,`data-nav="${active}" class="active"`);
 return `<aside class="side full-admin-side"><div class="logo"><img src="/sindane-logo.png" alt="Sindane Asset Solutions"><div class="tag">TRACK. PREVENT. PERFORM.</div></div>${nav}<div class="companybox"><small>COMPANY ADMIN</small><b>${esc(a?.companyName||"Company Workspace")}</b><span>${esc(a?.licenceStatus||"active")} licence</span></div><div class="userbox full-user"><div><b>${esc(a?.fullName||"Company Admin")}</b><small>${esc(a?.email||"")}</small><span>${esc(a?.role||"company_admin")}</span></div><form method="post" action="/api/contractor/logout"><button type="submit">Sign out</button></form></div></aside>`;
}

const shellFix=`<style id="full-admin-shell-fix">
.app{grid-template-columns:255px minmax(0,1fr)!important}.full-admin-side{display:flex!important;flex-direction:column!important;height:100vh!important;min-height:100vh!important;overflow:hidden!important;padding:18px 14px!important}.full-admin-side .logo{flex:0 0 auto}.full-admin-side nav{flex:1 1 auto!important;min-height:0!important;overflow-y:auto!important;padding:14px 0 12px!important;display:grid!important;gap:4px!important}.full-admin-side nav a{padding:10px 11px!important;font-size:13px!important;border-radius:8px!important}.full-admin-side nav a.active,.full-admin-side nav a:hover{background:#243a5c!important}.full-admin-side .companybox{position:static!important;left:auto!important;bottom:auto!important;width:auto!important;flex:0 0 auto!important;margin-top:8px!important;background:#13233b!important;border:1px solid #2a3b55!important;border-radius:10px!important;padding:10px!important}.full-admin-side .companybox small,.full-admin-side .companybox b,.full-admin-side .companybox span{display:block!important}.full-admin-side .companybox small{font-size:9px!important;color:#9eacc0!important}.full-admin-side .companybox b{font-size:11px!important;margin:4px 0!important}.full-admin-side .companybox span{font-size:9px!important;color:#b9c7d8!important}.full-admin-side .userbox{position:static!important;left:auto!important;right:auto!important;bottom:auto!important;width:auto!important;flex:0 0 auto!important;margin-top:7px!important;padding:10px!important;background:#0d1b31!important;border:1px solid #2a3b55!important;border-radius:10px!important;display:block!important}.full-admin-side .userbox b,.full-admin-side .userbox small,.full-admin-side .userbox span{display:block!important}.full-admin-side .userbox b{font-size:11px!important}.full-admin-side .userbox small{font-size:9px!important;color:#9eacc0!important;margin:3px 0!important;word-break:break-word}.full-admin-side .userbox span{font-size:9px!important;color:#b9c7d8!important;margin-bottom:7px!important}.full-admin-side .userbox form{margin:0!important}.full-admin-side .userbox button{width:100%!important;border:1px solid #40506a!important;background:transparent!important;color:#fff!important;border-radius:7px!important;padding:8px!important;font-size:10px!important;font-weight:800!important;cursor:pointer!important}.topbar{display:none!important}.main{min-width:0!important}.content{padding-top:20px!important}@media(max-width:820px){.full-admin-side{height:auto!important;min-height:0!important}.full-admin-side nav{max-height:none!important;overflow:visible!important}.full-admin-side .companybox,.full-admin-side .userbox{display:block!important}}
</style>`;

async function polish(req:Request,res:Response,env:Env){
  if(req.method!=="GET")return res;
  const ct=res.headers.get("content-type")||"";
  if(!ct.includes("text/html"))return res;
  let body=await res.text();
  const url=new URL(req.url),view=url.searchParams.get("view")||"dashboard";
  const a=await account(req,env);
  body=body.replace(/<aside class="side">[\s\S]*?<\/aside>/,fullSidebar(view,a));
  if(!body.includes('id="tmm-navy-company-theme"')&&body.includes("</head>"))body=body.replace("</head>",navyCompanyTheme+shellFix+"</head>");
  else if(!body.includes('id="full-admin-shell-fix"')&&body.includes("</head>"))body=body.replace("</head>",shellFix+"</head>");
  const h=new Headers(res.headers);h.delete("content-length");h.set("cache-control","private, no-store");
  return new Response(body,{status:res.status,statusText:res.statusText,headers:h});
}

export default {
  async fetch(req:Request,env:Env,ctx:ExecutionContext):Promise<Response>{
    const url=new URL(req.url);
    if(url.pathname==="/contractor"&&req.method==="GET"){
      const view=url.searchParams.get("view")||"dashboard";
      if(SAFE_V3_VIEWS.has(view)){
        const direct=await handleCompanyAdminV3(req,env as never);
        if(direct)return polish(req,direct,env);
      }
    }
    return classicApp.fetch(req,env as never,ctx as never);
  },
  async scheduled(c:ScheduledController,env:Env,ctx:ExecutionContext){
    const app=classicApp as unknown as {scheduled?:(c:ScheduledController,e:Env,x:ExecutionContext)=>Promise<void>|void};
    if(app.scheduled)return app.scheduled(c,env,ctx);
  }
};
