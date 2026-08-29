import legacyWorker from "./index";
import { handleContractorLiveV2, type ContractorEnvV2 } from "./contractor-live-v2";
import { ownerContractorsFormPage } from "./owner-contractors-server";
import { handleContractorAuthFix } from "./contractor-auth-fix";
import { handleContractorReports } from "./contractor-reports";

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
      // The v2 service/auth handler will create the table if it does not exist.
    }
  })().catch((error) => {
    sessionCompatibilityReady = null;
    throw error;
  });
  return sessionCompatibilityReady;
}

async function enhanceContractorReports(response: Response) {
  const type = response.headers.get("content-type") || "";
  if (!type.includes("text/html")) return response;

  const source = await response.text();
  const oldReports = `<section id="reports" class="tab"><div class="panel"><h2>Reports</h2><p>Live report exports are the next module. Current data is already stored per contractor and ready for daily, weekly, monthly and Pareto reporting.</p></div></section>`;
  const liveReports = `<section id="reports" class="tab"><div class="panel"><h2>Live Reports</h2><p>Generate reports from your company's secure D1 records. Exports are isolated to this contractor account.</p><div class="cards"><div class="card"><b>Daily Operations</b><p>Production, availability and breakdowns for one day.</p><a href="/contractor-reports?type=daily">Open report →</a></div><div class="card"><b>Weekly Fleet Summary</b><p>Seven-day fleet performance, downtime and tonnes.</p><a href="/contractor-reports?type=weekly">Open report →</a></div><div class="card"><b>Monthly Availability</b><p>Monthly operating hours and availability by machine.</p><a href="/contractor-reports?type=monthly">Open report →</a></div><div class="card"><b>Downtime Pareto</b><p>Rank components causing the most recorded downtime.</p><a href="/contractor-reports?type=pareto">Open report →</a></div><div class="card"><b>Maintenance Status</b><p>Service meter position, overdue units and due-soon machines.</p><a href="/contractor-reports?type=maintenance">Open report →</a></div><div class="card"><b>Production vs Target</b><p>Compare daily actual tonnes against your company target.</p><a href="/contractor-reports?type=production">Open report →</a></div></div><p style="margin-top:14px"><a href="/contractor-reports" style="color:#1267b3;font-weight:800">Open full Reports Centre →</a></p></div></section>`;
  const body = source.includes(oldReports) ? source.replace(oldReports, liveReports) : source;
  const headers = new Headers(response.headers);
  headers.delete("content-length");
  return new Response(body, { status: response.status, statusText: response.statusText, headers });
}

export default {
  async fetch(request: Request, env: Env, ctx: ExecutionContext): Promise<Response> {
    const pathname = new URL(request.url).pathname;
    const contractorManaged = pathname === "/contractor-health" || pathname === "/owner/contractors" || pathname === "/owner/contractors/create" || pathname === "/contractor-login" || pathname === "/contractor" || pathname.startsWith("/api/contractor/") || pathname === "/api/admin/contractors" || pathname === "/contractor-reports" || pathname === "/contractor-reports/settings" || pathname === "/contractor-reports/export";

    if (contractorManaged) await ensureContractorSessionCompatibility(env);

    if (pathname === "/owner/contractors" && request.method === "GET") {
      return ownerContractorsFormPage();
    }

    // Cloudflare-compatible password hashing for account creation and login.
    // This handler uses PBKDF2-SHA256 with 100,000 iterations, the Workers limit.
    const authFix = await handleContractorAuthFix(request, env);
    if (authFix) return authFix;

    const reports = await handleContractorReports(request, env);
    if (reports) return reports;

    const contractor = await handleContractorLiveV2(request, env);
    if (contractor) {
      if (pathname === "/contractor" && request.method === "GET") return enhanceContractorReports(contractor);
      return contractor;
    }

    if (disabledLegacyApis.some((prefix) => pathname === prefix || pathname.startsWith(prefix + "/"))) {
      return Response.json(
        { error: "Legacy operational endpoint disabled. Use the tenant-scoped contractor API." },
        { status: 410, headers: { "cache-control": "no-store" } },
      );
    }

    return legacyWorker.fetch(request, env, ctx);
  },
};