import legacyWorker from "./index";
import { handleContractorLiveV2, type ContractorEnvV2 } from "./contractor-live-v2";
import { ownerContractorsFormPage } from "./owner-contractors-server";
import { handleContractorAuthFix } from "./contractor-auth-fix";
import { handleContractorReports } from "./contractor-reports";
import { handleCompanyAdminV3 } from "./company-admin-v3";

interface Env extends ContractorEnvV2 {
  ASSETS: Fetcher;
  IMAGES?: {
    input(stream: ReadableStream): {
      transform(options: Record<string, unknown>): {
        output(options: { format: string; quality: number }): Promise<{ response(): Response }>;
      };
    };
  };
}

interface ExecutionContext {
  waitUntil(promise: Promise<unknown>): void;
  passThroughOnException(): void;
}

const disabledLegacyApis = [
  "/api/machines",
  "/api/events",
  "/api/orders",
  "/api/production",
  "/api/invitations",
  "/api/email",
  "/api/quotations",
];

let sessionCompatibilityReady: Promise<void> | null = null;

async function ensureContractorSessionCompatibility(env: Env) {
  if (sessionCompatibilityReady) return sessionCompatibilityReady;
  sessionCompatibilityReady = (async () => {
    try {
      const info = await env.DB.prepare("PRAGMA table_info(contractor_sessions)").all<Record<string, unknown>>();
      const names = new Set((info.results || []).map((row) => String(row.name || "")));
      if (names.has("user_id") && !names.has("account_id")) {
        await env.DB.prepare("DROP TABLE contractor_sessions").run();
      }
    } catch {
      // Contractor services create compatible session tables when required.
    }
  })().catch((error) => {
    sessionCompatibilityReady = null;
    throw error;
  });
  return sessionCompatibilityReady;
}

async function polishCompanyAdminWorkspace(request: Request, response: Response) {
  if (request.method !== "GET") return response;
  const url = new URL(request.url);
  if (url.pathname !== "/contractor") return response;

  const contentType = response.headers.get("content-type") || "";
  if (!contentType.includes("text/html")) return response;

  const view = url.searchParams.get("view") || "dashboard";
  let body = await response.text();

  // Use the clean dark-background Sindane logo on every Company Admin / role page.
  body = body.replace(
    '<img src="/sindane-logo.png" alt="Sindane Asset Solutions"><div class="tag">TRACK. PREVENT. PERFORM.</div>',
    '<img src="/sindane-logo-sidebar.svg" alt="Sindane Asset Solutions" class="sidebar-brand-image">',
  );

  // Also replace any remaining role-page logo images with the clean brand asset.
  body = body.replaceAll('src="/sindane-logo.png"', 'src="/sindane-logo-sidebar.svg"');

  // Inject final layout overrides: no top spacer, no white logo card, clean sidebar.
  body = body.replace(
    "</style>",
    `.sidebar-brand-image{display:block!important;width:146px!important;max-width:146px!important;height:118px!important;object-fit:contain!important;margin:0 auto!important;background:transparent!important;border:0!important;border-radius:0!important;box-shadow:none!important;padding:0!important}.logo{display:block!important;text-align:center!important;padding:0 0 14px!important;margin:0 0 12px!important;min-height:0!important;height:auto!important;background:transparent!important;border-bottom:1px solid rgba(255,255,255,.10)!important}.logo .tag{display:none!important}html,body{margin:0!important;padding:0!important}.app{margin:0!important;padding:0!important;align-items:start!important;min-height:100vh!important}.side{margin:0!important;top:0!important;align-self:start!important;padding:10px 14px 20px!important;min-height:100vh!important;height:100vh!important;background:linear-gradient(180deg,#08151d 0%,#06131e 100%)!important}.side nav{padding-top:4px!important}.side nav a{padding:11px 12px!important}.rolehero img{background:transparent!important;border:0!important;border-radius:0!important;padding:0!important;object-fit:contain!important}@media(max-width:820px){.app{display:grid!important;grid-template-columns:182px minmax(0,1fr)!important;align-items:start!important}.side{position:sticky!important;top:0!important;height:100vh!important;min-height:100vh!important;padding:8px 10px 16px!important}.side nav{display:grid!important;grid-template-columns:1fr!important;gap:4px!important}.side nav a{font-size:12px!important;justify-content:flex-start!important;padding:10px!important}.side nav a span{font-size:17px!important;width:20px!important}.sidebar-brand-image{width:132px!important;max-width:132px!important;height:106px!important}.logo{padding-bottom:10px!important;margin-bottom:8px!important}.userbox{display:flex!important;left:10px!important;right:10px!important;bottom:14px!important}.main{min-width:0!important}.content{padding:12px!important}.kpis{grid-template-columns:1fr 1fr!important}.row3,.row4,.split{grid-template-columns:1fr!important}.actions{grid-template-columns:1fr 1fr!important}}\n</style>`,
  );

  // Dashboard home stays clean: the full Daily Report form belongs only in Daily Reports.
  if (view === "dashboard") {
    body = body.replace(/<aside class="sideform">[\s\S]*?<\/aside>/, "");
    body = body.replace(
      ".dashboard-grid{display:grid;grid-template-columns:minmax(0,1fr) 300px;gap:13px;margin-top:13px}",
      ".dashboard-grid{display:grid;grid-template-columns:minmax(0,1fr);gap:13px;margin-top:13px}",
    );
  }

  const headers = new Headers(response.headers);
  headers.delete("content-length");
  return new Response(body, { status: response.status, statusText: response.statusText, headers });
}

export default {
  async fetch(request: Request, env: Env, ctx: ExecutionContext): Promise<Response> {
    const pathname = new URL(request.url).pathname;
    const contractorManaged = pathname === "/contractor-health" || pathname === "/owner/contractors" || pathname === "/owner/contractors/create" || pathname === "/contractor-login" || pathname === "/contractor" || pathname.startsWith("/api/contractor/") || pathname.startsWith("/company-admin/") || pathname === "/api/admin/contractors" || pathname === "/contractor-reports" || pathname === "/contractor-reports/settings" || pathname === "/contractor-reports/export";

    if (contractorManaged) await ensureContractorSessionCompatibility(env);

    if (pathname === "/owner/contractors" && request.method === "GET") {
      return ownerContractorsFormPage();
    }

    // Cloudflare-compatible contractor creation/login hashing.
    const authFix = await handleContractorAuthFix(request, env);
    if (authFix) return authFix;

    // Tenant-isolated live reports centre.
    const reports = await handleContractorReports(request, env);
    if (reports) return reports;

    // Redesigned Company Admin / role workspace.
    const adminV3 = await handleCompanyAdminV3(request, env);
    if (adminV3) return polishCompanyAdminWorkspace(request, adminV3);

    // Existing tenant APIs remain available behind the same secure session.
    const contractor = await handleContractorLiveV2(request, env);
    if (contractor) return contractor;

    if (disabledLegacyApis.some((prefix) => pathname === prefix || pathname.startsWith(prefix + "/"))) {
      return Response.json(
        { error: "Legacy operational endpoint disabled. Use the tenant-scoped contractor API." },
        { status: 410, headers: { "cache-control": "no-store" } },
      );
    }

    return legacyWorker.fetch(request, env, ctx);
  },
};