import coreApp from "./router-core-bypass";
import ownerApp from "./router-owner-platform";
import licenceApp from "./router-company-licence-clean";
import telemetryApp from "./router-telemetry-ready";
import { handleCompanyAdminV3 } from "./company-admin-v3";
import { navyCompanyTheme } from "./navy-company-theme";

interface ExecutionContext { waitUntil(promise: Promise<unknown>): void; passThroughOnException(): void; }
interface ScheduledController { scheduledTime:number; cron:string; noRetry():void; }
interface Env { DB:D1Database; BUCKET?:R2Bucket; [key:string]:unknown; }

const DIRECT_ADMIN_VIEWS = new Set(["dashboard","fleet","daily","users","alerts","approvals","setup","settings","documents","reports-admin"]);

const mainNav = `<nav>
<a data-nav="dashboard" href="/contractor"><span>⌂</span>Dashboard</a>
<a data-nav="fleet" href="/contractor?view=fleet"><span>▣</span>Fleet</a>
<a data-nav="daily" href="/contractor?view=daily"><span>▤</span>Daily Reports</a>
<a data-nav="breakdowns" href="/contractor?view=breakdowns"><span>⚙</span>Breakdowns</a>
<a data-nav="maintenance" href="/contractor?view=maintenance"><span>◷</span>Maintenance</a>
<a data-nav="production" href="/contractor?view=production"><span>▤</span>Production</a>
<a data-nav="reports" href="/contractor-reports"><span>▥</span>Reports</a>
<a data-nav="licence" href="/company-licence"><span>▧</span>Licence</a>
<a data-nav="previous" href="/trial-demo"><span>◈</span>Previous Month</a>
<a data-nav="telematics" href="/telemetry"><span>⌁</span>Telematics</a>
<a data-nav="settings" href="/contractor?view=settings"><span>⚙</span>Settings</a>
</nav>`;

function settingsHub(){
  return `<section class="panel settings-hub" style="margin-bottom:14px"><div class="head"><div><small>ADMIN TOOLS</small><h2 style="margin:4px 0">More controls</h2></div></div><p style="color:#667085;font-size:12px">Less-used administration tools are grouped here to keep the main sidebar fast and simple.</p><div style="display:grid;grid-template-columns:repeat(3,minmax(0,1fr));gap:10px;margin-top:12px">
  <a class="btn alt" href="/contractor?view=users">Users & Roles</a>
  <a class="btn alt" href="/contractor?view=alerts">Alerts & Contacts</a>
  <a class="btn alt" href="/contractor?view=setup">Company Setup</a>
  <a class="btn alt" href="/contractor?view=documents">Documents</a>
  <a class="btn alt" href="/contractor?view=approvals">Approvals</a>
  <a class="btn alt" href="/select-role">Switch Role</a>
  </div></section>`;
}

async function polishAdminNavigation(req:Request,res:Response){
  if(req.method!=="GET") return res;
  const ct=res.headers.get("content-type")||"";
  if(!ct.includes("text/html")) return res;
  const url=new URL(req.url);
  if(url.pathname!=="/contractor") return res;
  let body=await res.text();
  body=body.replace(/<nav>[\s\S]*?<\/nav>/,mainNav);
  if(!body.includes('id="tmm-navy-company-theme"') && body.includes("</head>")) body=body.replace("</head>",navyCompanyTheme+"</head>");
  const view=url.searchParams.get("view")||"dashboard";
  const active=view==="reports-admin"?"reports":view;
  body=body.replace(`data-nav="${active}"`,`data-nav="${active}" class="active"`);
  if(view==="settings" && !body.includes("ADMIN TOOLS")){
    body=body.replace('<div class="content">','<div class="content">'+settingsHub());
  }
  const h=new Headers(res.headers);h.delete("content-length");h.set("cache-control","private, no-store");
  return new Response(body,{status:res.status,statusText:res.statusText,headers:h});
}

export default {
  async fetch(req:Request,env:Env,ctx:ExecutionContext):Promise<Response>{
    const url=new URL(req.url), path=url.pathname;

    // Stable presentation alias for the approved navy/white demo dashboard.
    if(path==="/presentation"){
      return new Response(null,{status:302,headers:{location:"/contractor-demo","cache-control":"no-store"}});
    }

    if(path==="/owner-login" || path==="/owner" || path.startsWith("/owner/")){
      return ownerApp.fetch(req,env as never,ctx as never);
    }

    if(path==="/company-licence" || path.startsWith("/company-licence/")){
      return licenceApp.fetch(req,env as never,ctx as never);
    }

    if(path==="/telemetry" || path.startsWith("/telemetry/") || path.startsWith("/api/telemetry")){
      return telemetryApp.fetch(req,env as never,ctx as never);
    }

    if(path==="/contractor" && req.method==="GET"){
      const view=url.searchParams.get("view")||"dashboard";
      if(DIRECT_ADMIN_VIEWS.has(view)){
        const direct=await handleCompanyAdminV3(req,env as never);
        if(direct) return polishAdminNavigation(req,direct);
      }
    }
    if(path.startsWith("/company-admin/")){
      const direct=await handleCompanyAdminV3(req,env as never);
      if(direct) return direct;
    }

    const res=await coreApp.fetch(req,env as never,ctx as never);
    return polishAdminNavigation(req,res);
  },
  async scheduled(c:ScheduledController,env:Env,ctx:ExecutionContext){
    const app=coreApp as unknown as {scheduled?:(c:ScheduledController,e:Env,x:ExecutionContext)=>Promise<void>|void};
    if(app.scheduled) return app.scheduled(c,env,ctx);
  }
};
