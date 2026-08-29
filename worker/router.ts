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

const SIDEBAR_LOGO = "data:image/webp;base64,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";

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

  body = body.replace(
    /<div class="logo">[\s\S]*?<\/div><nav>/,
    `<div class="logo"><img src="${SIDEBAR_LOGO}" alt="Sindane Asset Solutions" class="sidebar-brand-image"></div><nav>`,
  );
  body = body.replaceAll('src="/sindane-logo.png"', `src="${SIDEBAR_LOGO}"`);
  body = body.replaceAll('src="/sindane-logo-sidebar.svg"', `src="${SIDEBAR_LOGO}"`);

  body = body.replace(
    ".side{background:linear-gradient(180deg,#071622,#06131e);color:white;min-height:100vh;padding:18px;position:sticky;top:0;height:100vh}",
    ".side{background:linear-gradient(180deg,#08151d,#06131e);color:white;min-height:100vh;padding:10px 14px 14px;position:sticky;top:0;height:100vh;display:flex;flex-direction:column;overflow:hidden}",
  );
  body = body.replace(
    ".logo{text-align:center;padding:4px 8px 22px;border-bottom:1px solid #243541}.logo img{max-width:178px;width:100%;height:105px;object-fit:contain}.tag{font-size:8px;letter-spacing:.25em;color:#e2a900;font-weight:800;margin-top:-8px}",
    ".logo{text-align:center;padding:0 0 10px;margin:0 0 8px;border-bottom:1px solid #243541;flex:0 0 auto}.logo img,.sidebar-brand-image{display:block;width:132px;max-width:132px;height:103px;object-fit:contain;margin:0 auto;background:transparent;border:0;box-shadow:none;padding:0}.tag{display:none}",
  );
  body = body.replace(
    ".side nav{padding-top:18px;display:grid;gap:7px}",
    ".side nav{padding-top:2px;display:grid;gap:3px;overflow-y:auto;overflow-x:hidden;flex:1 1 auto;min-height:0}",
  );
  body = body.replace(
    ".side nav a{display:flex;gap:13px;align-items:center;color:#edf4f2;text-decoration:none;padding:13px 14px;border-radius:8px;font-size:14px}",
    ".side nav a{display:flex;gap:11px;align-items:center;color:#edf4f2;text-decoration:none;padding:10px 11px;border-radius:8px;font-size:13px;flex:0 0 auto}",
  );
  body = body.replace(
    ".userbox{position:absolute;left:18px;right:18px;bottom:24px;border-top:1px solid #2c3a46;padding-top:18px;display:flex;gap:10px;align-items:center}",
    ".userbox{position:static;border-top:1px solid #2c3a46;padding-top:10px;margin-top:8px;display:flex;gap:10px;align-items:center;flex:0 0 auto;min-height:54px}",
  );

  body = body.replace(".app{display:block}", ".app{display:grid;grid-template-columns:182px minmax(760px,1fr);align-items:start}");
  body = body.replace(".side{position:relative;height:auto;min-height:0}", ".side{position:sticky;top:0;height:100vh;min-height:100vh}");
  body = body.replace(".side nav{grid-template-columns:repeat(3,1fr)}", ".side nav{grid-template-columns:1fr}");
  body = body.replace(".side nav a{font-size:0;justify-content:center}", ".side nav a{font-size:12px;justify-content:flex-start;padding:9px 8px}");
  body = body.replace(".side nav a span{font-size:21px}", ".side nav a span{font-size:17px;width:20px}");
  body = body.replace(".userbox{display:none}", ".userbox{display:flex}");
  body = body.replace(".logo img{height:75px}", ".logo img,.sidebar-brand-image{width:120px;max-width:120px;height:94px}");

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

    const authFix = await handleContractorAuthFix(request, env);
    if (authFix) return authFix;

    const reports = await handleContractorReports(request, env);
    if (reports) return reports;

    const adminV3 = await handleCompanyAdminV3(request, env);
    if (adminV3) return polishCompanyAdminWorkspace(request, adminV3);

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