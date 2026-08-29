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

async function polishCompanyAdminDashboard(request: Request, response: Response) {
  if (request.method !== "GET") return response;
  const url = new URL(request.url);
  if (url.pathname !== "/contractor") return response;
  const view = url.searchParams.get("view") || "dashboard";
  if (view !== "dashboard") return response;

  const contentType = response.headers.get("content-type") || "";
  if (!contentType.includes("text/html")) return response;

  let body = await response.text();

  // Keep the full Add / Import Daily Report workflow in the dedicated
  // Daily Reports module, but remove the large data-entry panel from Home.
  body = body.replace(/<aside class="sideform">[\s\S]*?<\/aside>/, "");

  // Make the dashboard content use the full width after the panel is removed.
  body = body.replace(
    ".dashboard-grid{display:grid;grid-template-columns:minmax(0,1fr) 300px;gap:13px;margin-top:13px}",
    ".dashboard-grid{display:grid;grid-template-columns:minmax(0,1fr);gap:13px;margin-top:13px}",
  );

  // Present the existing PNG company logo as a prominent image, matching
  // the approved sidebar reference while retaining the dark brand panel.
  body = body.replace(
    ".logo{text-align:center;padding:4px 8px 22px;border-bottom:1px solid #243541}.logo img{max-width:178px;width:100%;height:105px;object-fit:contain}.tag{font-size:8px;letter-spacing:.25em;color:#e2a900;font-weight:800;margin-top:-8px}",
    ".logo{text-align:center;padding:2px 4px 18px;border-bottom:1px solid #243541}.logo img{display:block;max-width:205px;width:100%;height:128px;object-fit:contain;margin:0 auto}.tag{font-size:8px;letter-spacing:.22em;color:#e2a900;font-weight:800;margin-top:-10px}",
  );

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
    if (adminV3) return polishCompanyAdminDashboard(request, adminV3);

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