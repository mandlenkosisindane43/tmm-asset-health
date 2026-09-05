import currentApp from "./router-company-admin-unified-shell";

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

function num(value: unknown) {
  const n = Number(value);
  return Number.isFinite(n) ? n : 0;
}

async function count(env: Env, sql: string, binds: unknown[] = []) {
  try {
    const row = await env.DB.prepare(sql).bind(...binds).first<Row>();
    return num(row?.n);
  } catch {
    return 0;
  }
}

const ownerMetricsCss = `<style id="sas-owner-portfolio-metrics-css">
.sas-owner-portfolio-metrics{display:grid;grid-template-columns:repeat(5,minmax(0,1fr));gap:14px;margin:0 0 14px}
.sas-owner-portfolio-card{background:#fff;border:1px solid #d9e1ea;border-radius:14px;padding:18px 18px 17px;min-height:126px;box-shadow:0 5px 18px rgba(15,23,42,.035)}
.sas-owner-portfolio-card small{display:block;color:#61708f;font-size:11px;font-weight:900;letter-spacing:.025em;text-transform:uppercase}
.sas-owner-portfolio-card b{display:block;color:#08162b;font-size:28px;line-height:1;margin:18px 0 14px}
.sas-owner-portfolio-card span{display:block;color:#55657c;font-size:11px;line-height:1.35}
@media(max-width:1200px){.sas-owner-portfolio-metrics{grid-template-columns:repeat(3,minmax(0,1fr))}}
@media(max-width:760px){.sas-owner-portfolio-metrics{grid-template-columns:1fr 1fr}.sas-owner-portfolio-card{min-height:112px}}
@media(max-width:480px){.sas-owner-portfolio-metrics{grid-template-columns:1fr}}
</style>`;

async function addOwnerMetrics(request: Request, env: Env, response: Response) {
  const url = new URL(request.url);
  const view = url.searchParams.get("view") || "dashboard";
  if (request.method !== "GET" || url.pathname !== "/owner" || view !== "dashboard") return response;
  const type = response.headers.get("content-type") || "";
  if (!type.includes("text/html") || response.status >= 400) return response;

  const now = new Date().toISOString();
  const [companies, activeLicences, machines, sites, pendingRequests, pendingCompanies] = await Promise.all([
    count(env, "SELECT COUNT(*) n FROM companies"),
    count(env, "SELECT COUNT(*) n FROM companies WHERE licence_status IN ('active','trial') AND expires_at>=?", [now]),
    count(env, "SELECT COUNT(*) n FROM machines"),
    count(env, "SELECT COUNT(*) n FROM company_sites"),
    count(env, "SELECT COUNT(*) n FROM subscription_requests_v1 WHERE lower(status)='pending'"),
    count(env, "SELECT COUNT(*) n FROM companies WHERE lower(licence_status) IN ('pending','pending_approval','requested')")
  ]);
  const pendingActions = pendingRequests + pendingCompanies;

  const metrics = `<section class="sas-owner-portfolio-metrics" aria-label="Owner portfolio summary">
    <article class="sas-owner-portfolio-card"><small>CLIENT COMPANIES</small><b>${companies}</b><span>Mines and contractors</span></article>
    <article class="sas-owner-portfolio-card"><small>ACTIVE LICENCES</small><b>${activeLicences}</b><span>Activated client access</span></article>
    <article class="sas-owner-portfolio-card"><small>MACHINES MANAGED</small><b>${machines}</b><span>Across registered clients</span></article>
    <article class="sas-owner-portfolio-card"><small>SITES CONNECTED</small><b>${sites}</b><span>Operating locations</span></article>
    <article class="sas-owner-portfolio-card"><small>PENDING ACTIONS</small><b>${pendingActions}</b><span>Approval / licence requests</span></article>
  </section>`;

  let body = await response.text();
  body = body.replace("</head>", `${ownerMetricsCss}</head>`);

  const headingEnd = body.indexOf('</div>', body.indexOf('class="headline"'));
  if (headingEnd !== -1) {
    const insertAt = headingEnd + 6;
    body = body.slice(0, insertAt) + metrics + body.slice(insertAt);
  } else {
    const contentMarker = '<div class="content">';
    body = body.replace(contentMarker, `${contentMarker}${metrics}`);
  }

  const headers = new Headers(response.headers);
  headers.set("cache-control", "private, no-store, max-age=0");
  headers.delete("content-length");
  return new Response(body, { status: response.status, headers });
}

export default {
  async fetch(request: Request, env: Env, ctx: ExecutionContext): Promise<Response> {
    const response = await currentApp.fetch(request, env as never, ctx as never);
    try {
      return await addOwnerMetrics(request, env, response);
    } catch (error) {
      console.error("OWNER_DASHBOARD_METRICS_ERROR", error);
      return response;
    }
  },
  async scheduled(controller: ScheduledController, env: Env, ctx: ExecutionContext) {
    return currentApp.scheduled(controller as never, env as never, ctx as never);
  },
};
