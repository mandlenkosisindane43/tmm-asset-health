import currentApp from "./router-owner-licence-ui";

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

const heroCss = `<style id="sas-owner-hero-ui">
.sas-owner-hero{background:#233553;color:#fff;border-radius:18px;padding:28px 30px;display:flex;align-items:center;justify-content:space-between;gap:28px;margin:0 0 16px;box-shadow:0 8px 22px rgba(15,23,42,.08)}
.sas-owner-hero-copy{min-width:0;max-width:760px}.sas-owner-hero-copy small{display:block;font-size:12px;letter-spacing:.09em;font-weight:900;color:#d7deea;margin-bottom:11px}.sas-owner-hero-copy h2{font-size:30px;line-height:1.45;margin:0 0 8px;color:#fff;font-weight:500}.sas-owner-hero-copy p{font-size:14px;line-height:1.55;color:#e4e9f1;margin:0;max-width:710px}.sas-owner-hero-actions{display:flex;flex-direction:column;gap:10px;align-items:flex-start;min-width:255px}.sas-owner-hero-actions a{display:inline-flex;align-items:center;justify-content:center;background:#fff;color:#08162b;text-decoration:none;border-radius:10px;padding:12px 16px;font-size:15px;font-weight:900;min-width:162px;border:1px solid rgba(255,255,255,.9);box-shadow:0 2px 6px rgba(0,0,0,.04)}.sas-owner-hero-actions a:hover{background:#f7f9fc}
@media(max-width:900px){.sas-owner-hero{align-items:flex-start;flex-direction:column}.sas-owner-hero-actions{min-width:0;flex-direction:row;flex-wrap:wrap}.sas-owner-hero-copy h2{font-size:25px}}
@media(max-width:520px){.sas-owner-hero{padding:21px 18px}.sas-owner-hero-actions{width:100%;display:grid;grid-template-columns:1fr 1fr}.sas-owner-hero-actions a{min-width:0;width:100%}.sas-owner-hero-copy h2{font-size:22px}}
</style>`;

async function addOwnerHero(request: Request, response: Response) {
  const url = new URL(request.url);
  const view = url.searchParams.get("view") || "dashboard";
  if (request.method !== "GET" || url.pathname !== "/owner" || view !== "dashboard") return response;
  const type = response.headers.get("content-type") || "";
  if (!type.includes("text/html") || response.status >= 400) return response;

  const hero = `<section class="sas-owner-hero" aria-label="Owner control">
    <div class="sas-owner-hero-copy">
      <small>REAL SOFTWARE · OWNER CONTROL</small>
      <h2>Manage every mine and contractor from one workspace</h2>
      <p>Company onboarding, subscriptions, licences, users and client performance are brought into the same dashboard style used in the presentation demo.</p>
    </div>
    <div class="sas-owner-hero-actions">
      <a href="/owner?view=companies&type=contractor">Add contractor</a>
      <a href="/owner?view=companies&type=mine">Add mine</a>
    </div>
  </section>`;

  let body = await response.text();
  body = body.replace("</head>", `${heroCss}</head>`);

  const metricsMarker = '<section class="sas-owner-portfolio-metrics"';
  const metricsIndex = body.indexOf(metricsMarker);
  if (metricsIndex !== -1) {
    body = body.slice(0, metricsIndex) + hero + body.slice(metricsIndex);
  } else {
    const contentMarker = '<div class="content">';
    body = body.replace(contentMarker, `${contentMarker}${hero}`);
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
      return await addOwnerHero(request, response);
    } catch (error) {
      console.error("OWNER_HERO_UI_ERROR", error);
      return response;
    }
  },
  async scheduled(controller: ScheduledController, env: Env, ctx: ExecutionContext) {
    return currentApp.scheduled(controller as never, env as never, ctx as never);
  },
};