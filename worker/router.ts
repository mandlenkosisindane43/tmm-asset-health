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
    if (adminV3) return adminV3;

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