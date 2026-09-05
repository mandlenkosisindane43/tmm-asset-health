import currentApp from "./router-company-admin-demo-ui-v2";

interface ExecutionContext {
  waitUntil(promise: Promise<unknown>): void;
  passThroughOnException(): void;
}
interface ScheduledController {
  scheduledTime: number;
  cron: string;
  noRetry(): void;
}
interface Env {
  DB: D1Database;
  [key: string]: unknown;
}

const LEGACY_VIEWS = new Set([
  "users",
  "alerts",
  "approvals",
  "reports-admin",
  "documents",
  "setup",
  "settings",
]);

const unifiedCss = `
<style id="sas-unified-company-admin-shell">
:root{--sas-navy:#071622;--sas-navy-2:#06131e;--sas-green:#087849;--sas-gold:#e2a900;--sas-bg:#f4f7fb;--sas-line:#dfe5eb;--sas-text:#0f1d36}
body{background:var(--sas-bg)!important;color:var(--sas-text)!important;font-family:Arial,Helvetica,sans-serif!important}
.app{grid-template-columns:255px minmax(0,1fr)!important}
.side{background:linear-gradient(180deg,var(--sas-navy),var(--sas-navy-2))!important;padding:18px!important;box-shadow:8px 0 24px rgba(3,18,30,.08)!important}
.logo{padding:4px 8px 16px!important;border-bottom:1px solid #243541!important}
.logo img{max-width:178px!important;height:92px!important;object-fit:contain!important}
.tag{font-size:8px!important;letter-spacing:.22em!important;color:var(--sas-gold)!important;font-weight:900!important;margin-top:-4px!important}
.side nav{padding-top:16px!important;display:grid!important;gap:7px!important;max-height:calc(100vh - 245px)!important;overflow:auto!important;padding-right:3px!important}
.side nav a{display:flex!important;gap:13px!important;align-items:center!important;color:#edf4f2!important;text-decoration:none!important;padding:12px 13px!important;border-radius:8px!important;font-size:13px!important;line-height:1.2!important}
.side nav a span{width:22px!important;text-align:center!important;font-size:18px!important}
.side nav a.active,.side nav a:hover{background:var(--sas-green)!important;color:#fff!important}
.side nav a.sas-added-link{border:1px solid rgba(255,255,255,.06)!important}
.userbox{left:18px!important;right:18px!important;bottom:18px!important;border-top:1px solid #2c3a46!important;padding-top:14px!important}
.avatar{background:#069354!important;color:#fff!important}
.main{min-width:0!important;background:var(--sas-bg)!important}
.topbar{height:64px!important;background:#fff!important;border-bottom:1px solid #e5e7eb!important;padding:0 24px!important;box-shadow:0 1px 0 rgba(15,23,42,.02)!important}
.topbar:before{content:'TMM Asset Health';font-weight:900;font-size:17px;color:#0f1d36;margin-right:auto}
.topbar>div:first-child{display:none!important}
.topbar .right{gap:10px!important}
.content{padding:22px 24px 38px!important;max-width:1650px!important;margin:auto!important}
.pagehead{align-items:end!important;margin-bottom:16px!important}
.pagehead h1{font-size:28px!important;color:#0f1d36!important;letter-spacing:-.02em!important}
.pagehead p{color:#64748b!important}
.panel,.card,.sideform{border:1px solid var(--sas-line)!important;border-radius:12px!important;box-shadow:0 4px 16px rgba(15,23,42,.035)!important}
.panel h2,.section h2{color:#0f1d36!important}
.btn{border-radius:8px!important}
.btn:not(.gray):not(.blue):not(.red):not(.amber){background:var(--sas-green)!important}
.bigtable th,.mini-table th{background:#f6f8fb!important;color:#55657a!important}
.bigtable td,.mini-table td{border-bottom:1px solid #edf0f3!important}
.field input,.field select,.field textarea{border:1px solid #ccd6e0!important;border-radius:8px!important;padding:10px!important}
.notice{border:1px solid #cae8d7!important}
.foot{background:#071d2c!important}
.sas-workspace-strip{display:flex;justify-content:space-between;gap:12px;align-items:center;background:linear-gradient(120deg,#0a2336,#0c7048);color:#fff;border-radius:12px;padding:14px 16px;margin:0 0 16px}
.sas-workspace-strip div{display:grid;gap:3px}.sas-workspace-strip small{font-size:9px;letter-spacing:.16em;color:#d5e4df;font-weight:800}.sas-workspace-strip b{font-size:15px}.sas-workspace-strip a{background:#fff;color:#0a6f47;text-decoration:none;font-size:11px;font-weight:900;padding:9px 12px;border-radius:8px;white-space:nowrap}
@media(max-width:820px){.app{display:block!important}.side{position:relative!important;height:auto!important;min-height:0!important}.side nav{grid-template-columns:repeat(2,1fr)!important;max-height:none!important}.side nav a{font-size:11px!important;justify-content:flex-start!important}.side nav a span{font-size:17px!important}.userbox{display:none!important}.content{padding:14px!important}.topbar{padding:0 14px!important}.topbar:before{font-size:14px!important}}
@media print{.sas-workspace-strip{display:none!important}}
</style>`;

function extraNav(active: string) {
  const items = [
    ["breakdowns", "⚙", "Breakdowns"],
    ["maintenance", "▦", "Maintenance"],
    ["production", "▥", "Production"],
    ["reports-live", "▤", "Management Reports"],
    ["subscription-request", "◇", "Subscription Request"],
  ];
  return items
    .map(([id, icon, label]) => `<a class="sas-added-link ${active === id ? "active" : ""}" href="/contractor?view=${id}"><span>${icon}</span>${label}</a>`)
    .join("");
}

async function unifyLegacyPage(req: Request, response: Response) {
  const url = new URL(req.url);
  if (req.method !== "GET" || url.pathname !== "/contractor") return response;
  const view = url.searchParams.get("view") || "dashboard";
  if (!LEGACY_VIEWS.has(view)) return response;
  const type = response.headers.get("content-type") || "";
  if (!type.includes("text/html")) return response;

  let body = await response.text();
  body = body.replace("<title>", `${unifiedCss}<title>`);
  body = body.replace(">Users</a>", ">Users &amp; Roles</a>");

  const firstNavClose = body.indexOf("</nav>");
  if (firstNavClose !== -1) {
    body = body.slice(0, firstNavClose) + extraNav(view) + body.slice(firstNavClose);
  }

  const contentMarker = '<div class="content">';
  const contentIndex = body.indexOf(contentMarker);
  if (contentIndex !== -1) {
    const strip = `${contentMarker}<div class="sas-workspace-strip"><div><small>COMPANY ADMIN WORKSPACE</small><b>Mine. Contractor. Workshop. One Solution.</b></div><a href="/contractor?view=dashboard">Back to Dashboard</a></div>`;
    body = body.slice(0, contentIndex) + strip + body.slice(contentIndex + contentMarker.length);
  }

  const headers = new Headers(response.headers);
  headers.set("cache-control", "private, no-store");
  headers.delete("content-length");
  return new Response(body, { status: response.status, headers });
}

export default {
  async fetch(req: Request, env: Env, ctx: ExecutionContext): Promise<Response> {
    const response = await currentApp.fetch(req, env as never, ctx as never);
    try {
      return await unifyLegacyPage(req, response);
    } catch (error) {
      console.error("UNIFIED_COMPANY_ADMIN_SHELL_ERROR", error);
      return response;
    }
  },
  async scheduled(controller: ScheduledController, env: Env, ctx: ExecutionContext) {
    return currentApp.scheduled(controller as never, env as never, ctx as never);
  },
};
