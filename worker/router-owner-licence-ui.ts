import currentApp from "./router-owner-dashboard-metrics";

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
type Row = Record<string, unknown>;

function num(v: unknown) {
  const n = Number(v);
  return Number.isFinite(n) ? n : 0;
}
async function count(env: Env, sql: string, binds: unknown[] = []) {
  try {
    const r = await env.DB.prepare(sql).bind(...binds).first<Row>();
    return num(r?.n);
  } catch {
    return 0;
  }
}

const css = `<style id="sas-owner-licence-ui">
.sas-licence-summary{display:grid;grid-template-columns:repeat(4,minmax(0,1fr));gap:14px;margin:44px 0 18px}
.sas-licence-card{background:#fff;border:1px solid #d9e1ea;border-radius:14px;padding:20px 18px;min-height:128px;box-shadow:0 4px 16px rgba(15,23,42,.025)}
.sas-licence-card small{display:block;color:#61708f;font-size:11px;font-weight:900;letter-spacing:.025em;text-transform:uppercase}
.sas-licence-card b{display:block;color:#08162b;font-size:29px;line-height:1;margin:19px 0 14px}
.sas-licence-card span{display:block;color:#55657c;font-size:11px}
.sas-licence-control{background:#fff;border:1px solid #d9e1ea;border-radius:14px;padding:25px 20px;display:flex;align-items:center;justify-content:space-between;gap:18px;box-shadow:0 4px 16px rgba(15,23,42,.02)}
.sas-licence-control small{display:block;color:#61708f;font-size:10px;font-weight:900;letter-spacing:.035em;text-transform:uppercase;margin-bottom:10px}
.sas-licence-control h2{font-size:20px;margin:0 0 18px;color:#08162b}
.sas-licence-control p{margin:0;color:#5f6f86;font-size:13px}
.sas-licence-control a{display:inline-flex;align-items:center;justify-content:center;min-width:220px;padding:14px 18px;border:1px solid #cdd7e3;border-radius:10px;text-decoration:none;color:#08162b;background:#fff;font-weight:900;font-size:15px}
.sas-licence-control a:hover{background:#f7f9fc}
@media(max-width:1050px){.sas-licence-summary{grid-template-columns:1fr 1fr}.sas-licence-control{align-items:flex-start;flex-direction:column}}
@media(max-width:620px){.sas-licence-summary{grid-template-columns:1fr}.sas-licence-control a{width:100%;min-width:0}}
</style>`;

async function licenceOverview(request: Request, env: Env, response: Response) {
  const url = new URL(request.url);
  const view = url.searchParams.get("view") || "dashboard";
  if (request.method !== "GET" || url.pathname !== "/owner" || view !== "subscriptions") return response;
  const type = response.headers.get("content-type") || "";
  if (!type.includes("text/html") || response.status >= 400) return response;

  const now = new Date().toISOString();
  const [active, pendingRequests, pendingCompanies, companies, machines] = await Promise.all([
    count(env,"SELECT COUNT(*) n FROM companies WHERE licence_status IN ('active','trial') AND expires_at>=?",[now]),
    count(env,"SELECT COUNT(*) n FROM subscription_requests_v1 WHERE lower(status)='pending'"),
    count(env,"SELECT COUNT(*) n FROM companies WHERE lower(licence_status) IN ('pending','pending_approval','requested')"),
    count(env,"SELECT COUNT(*) n FROM companies"),
    count(env,"SELECT COUNT(*) n FROM machines")
  ]);
  const pending = pendingRequests + pendingCompanies;

  const replacement = `<div class="content">
    <section class="sas-licence-summary" aria-label="Licence summary">
      <article class="sas-licence-card"><small>ACTIVE</small><b>${active}</b><span>Client licences</span></article>
      <article class="sas-licence-card"><small>PENDING</small><b>${pending}</b><span>Awaiting approval</span></article>
      <article class="sas-licence-card"><small>COMPANIES</small><b>${companies}</b><span>Registered clients</span></article>
      <article class="sas-licence-card"><small>MACHINES</small><b>${machines}</b><span>Licensed fleet scope</span></article>
    </section>
    <section class="sas-licence-control">
      <div><small>LICENSING</small><h2>Company licence control</h2><p>Activate and manage company licences after commercial approval. Each company retains an isolated workspace.</p></div>
      <a href="/owner?view=licence-manager">Open licence manager</a>
    </section>
  </div>`;

  let body = await response.text();
  body = body.replace("</head>", `${css}</head>`);
  const start = body.indexOf('<div class="content">');
  const end = body.indexOf('</main>', start);
  if (start !== -1 && end !== -1) body = body.slice(0,start) + replacement + body.slice(end);
  const headers = new Headers(response.headers);
  headers.set("cache-control","private, no-store, max-age=0");
  headers.delete("content-length");
  return new Response(body,{status:response.status,headers});
}

export default {
  async fetch(request: Request, env: Env, ctx: ExecutionContext): Promise<Response> {
    const url = new URL(request.url);
    if (request.method === "GET" && url.pathname === "/owner" && url.searchParams.get("view") === "licence-manager") {
      const forwarded = new URL(request.url);
      forwarded.searchParams.set("view","subscriptions");
      return currentApp.fetch(new Request(forwarded.toString(),request),env as never,ctx as never);
    }
    const response = await currentApp.fetch(request,env as never,ctx as never);
    try { return await licenceOverview(request,env,response); }
    catch (error) { console.error("OWNER_LICENCE_UI_ERROR",error); return response; }
  },
  async scheduled(controller: ScheduledController, env: Env, ctx: ExecutionContext) {
    return currentApp.scheduled(controller as never, env as never, ctx as never);
  }
};