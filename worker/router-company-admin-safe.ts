import classicApp from "./router-company-admin-demo-ui-v2";
import { handleCompanyAdminV3 } from "./company-admin-v3";
import { navyCompanyTheme } from "./navy-company-theme";

interface ExecutionContext { waitUntil(promise: Promise<unknown>): void; passThroughOnException(): void; }
interface ScheduledController { scheduledTime:number; cron:string; noRetry():void; }
interface Env { DB:D1Database; [key:string]:unknown; }

const SAFE_V3_VIEWS = new Set(["fleet","daily","users","alerts","approvals","reports-admin","documents","setup","settings"]);

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

async function polish(req:Request,res:Response){
  if(req.method!=="GET")return res;
  const ct=res.headers.get("content-type")||"";
  if(!ct.includes("text/html"))return res;
  let body=await res.text();
  const url=new URL(req.url),view=url.searchParams.get("view")||"dashboard";
  body=body.replace(/<nav>[\s\S]*?<\/nav>/,fullNav);
  if(!body.includes('id="tmm-navy-company-theme"')&&body.includes("</head>"))body=body.replace("</head>",navyCompanyTheme+"</head>");
  body=body.replace(`data-nav="${view}"`,`data-nav="${view}" class="active"`);
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
        if(direct)return polish(req,direct);
      }
    }
    return classicApp.fetch(req,env as never,ctx as never);
  },
  async scheduled(c:ScheduledController,env:Env,ctx:ExecutionContext){
    const app=classicApp as unknown as {scheduled?:(c:ScheduledController,e:Env,x:ExecutionContext)=>Promise<void>|void};
    if(app.scheduled)return app.scheduled(c,env,ctx);
  }
};
