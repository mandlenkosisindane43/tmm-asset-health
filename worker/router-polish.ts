import worker from "./router";
import { handleUserInvitations, type InvitationEnv } from "./user-invitations";
import { handleInviteDelivery } from "./invite-delivery";
import { handleRoleDashboardsV4 } from "./role-dashboards-v4";
import { handleTenantIsolationAudit } from "./tenant-isolation-audit";

interface ExecutionContext {
  waitUntil(promise: Promise<unknown>): void;
  passThroughOnException(): void;
}

interface PolishEnv extends InvitationEnv {
  ASSETS?: Fetcher;
  ADMIN_PASSWORD?: string;
}

export default {
  async fetch(request: Request, env: PolishEnv, ctx: ExecutionContext): Promise<Response> {
    const requestUrl = new URL(request.url);

    // Explicitly serve the approved Sindane sidebar assets from the Workers assets binding.
    if (request.method === "GET" && env.ASSETS && ["/sindane-logo-sidebar.svg", "/sindane-logo.png"].includes(requestUrl.pathname)) {
      return env.ASSETS.fetch(request);
    }

    // Owner-only Alpha/Beta security lab for proving D1 tenant separation.
    const tenantAudit = await handleTenantIsolationAudit(request, env);
    if (tenantAudit) return tenantAudit;

    const delivery = await handleInviteDelivery(request, env);
    if (delivery) return delivery;

    // Public acceptance page and authenticated invitation sender run before the base router.
    const invitation = await handleUserInvitations(request, env);
    if (invitation) return invitation;

    // Engineer, Supervisor, Mechanic and Manager land on the v4 tenant-scoped dashboards.
    // The handler returns null for Company Admin/Owner sessions so the existing admin workspace remains unchanged.
    const roleDashboard = await handleRoleDashboardsV4(request, env);
    if (roleDashboard) return roleDashboard;

    const response = await worker.fetch(request, env as never, ctx);
    const url = new URL(request.url);

    // Make the contractor login easier to read and use the real Sindane Asset Solutions logo.
    if (request.method === "GET" && url.pathname === "/contractor-login") {
      const contentType = response.headers.get("content-type") || "";
      if (!contentType.includes("text/html")) return response;

      let body = await response.text();
      body = body.replace(
        `<div class="brand">TMM Asset Health<small>Sindane Asset Solutions</small></div>`,
        `<div class="brand"><img src="/sindane-logo-sidebar.svg" alt="Sindane Asset Solutions"><div class="brand-title">TMM Asset Health</div><small>Sindane Asset Solutions</small></div>`,
      );
      body = body.replace(
        `.box{width:min(430px,100%);background:#fff;padding:32px;border-radius:18px}`,
        `.box{width:min(500px,100%);background:#fff;padding:38px 40px;border-radius:20px;box-shadow:0 20px 55px rgba(0,0,0,.22)}`,
      );
      body = body.replace(
        `.brand{font-weight:900;color:#0f3158}.brand small{display:block;color:#64748b;margin-top:4px}`,
        `.brand{text-align:center;font-weight:900;color:#0f3158}.brand img{display:block;width:190px;max-width:80%;height:145px;object-fit:contain;margin:0 auto 6px}.brand-title{font-size:23px;line-height:1.2}.brand small{display:block;color:#64748b;margin-top:5px;font-size:14px}`,
      );
      body = body.replace(
        `.tag{margin:20px 0 6px;color:#1267b3;font-size:11px;font-weight:900}`,
        `.tag{margin:22px 0 7px;color:#b77c00;font-size:13px;font-weight:900;letter-spacing:.04em}`,
      );
      body = body.replace(
        `.box h1{margin:0 0 8px}`,
        `.box h1{margin:0 0 9px;font-size:30px;line-height:1.15}`,
      );
      body = body.replace(
        `.box p{color:#64748b;font-size:13px;line-height:1.5}`,
        `.box p{color:#526171;font-size:16px;line-height:1.55}`,
      );
      body = body.replace(
        `.field{display:grid;gap:7px;margin-top:15px;font-size:12px;font-weight:800}`,
        `.field{display:grid;gap:8px;margin-top:18px;font-size:15px;font-weight:800;color:#24354a}`,
      );
      body = body.replace(
        `.field input{padding:13px;border:1px solid #cbd5e1;border-radius:9px;font-size:15px}`,
        `.field input{padding:15px 14px;border:1px solid #b9c6d4;border-radius:10px;font-size:17px;min-height:50px;outline:none}.field input:focus{border-color:#11975c;box-shadow:0 0 0 3px rgba(17,151,92,.12)}`,
      );
      body = body.replace(
        `.btn{width:100%;margin-top:20px;border:0;background:#1267b3;color:#fff;padding:13px;border-radius:9px;font-weight:900}`,
        `.btn{width:100%;margin-top:23px;border:0;background:#11975c;color:#fff;padding:15px 14px;border-radius:10px;font-size:16px;font-weight:900;cursor:pointer}.btn:hover{background:#0c814d}`,
      );
      body = body.replace(
        `.msg{min-height:20px;color:#b91c1c;font-size:12px;margin-top:12px}.demo{margin-top:18px;font-size:12px}.demo a{color:#1267b3;font-weight:800}`,
        `.msg{min-height:22px;color:#b91c1c;font-size:14px;line-height:1.45;margin-top:13px}.demo{margin-top:20px;font-size:14px;text-align:center}.demo a{color:#087548;font-weight:800}`,
      );

      const headers = new Headers(response.headers);
      headers.delete("content-length");
      return new Response(body, {
        status: response.status,
        statusText: response.statusText,
        headers,
      });
    }

    if (request.method !== "GET" || url.pathname !== "/contractor") return response;
    const contentType = response.headers.get("content-type") || "";
    if (!contentType.includes("text/html")) return response;

    let body = await response.text();
    const view = url.searchParams.get("view") || "dashboard";

    // Slightly larger company logo on desktop.
    body = body.replace(
      "width:132px;max-width:132px;height:103px",
      "width:146px;max-width:146px;height:114px",
    );

    // Slightly larger company logo on narrow/mobile sidebar.
    body = body.replace(
      "width:120px;max-width:120px;height:94px",
      "width:132px;max-width:132px;height:103px",
    );

    // Lighter active/hover rounded menu tile while preserving brand green.
    body = body.replace(
      ".side nav a.active,.side nav a:hover{background:#0a7a49}",
      ".side nav a.active,.side nav a:hover{background:#11975c}",
    );

    // Commercial invite flow: admin selects name/email/role; recipient creates their own password.
    if (view === "users") {
      body = body.replace(
        /<section class="panel"><h2>Invite user<\/h2><form method="post" action="\/company-admin\/users\/add">[\s\S]*?<button class="btn" type="submit">Invite \/ Create User<\/button><\/form><\/section>/,
        `<section class="panel"><h2>Invite user</h2><p style="font-size:12px;color:#5f6d76;line-height:1.5;margin-top:-4px">Send a secure branded invitation by email. The user will choose their own password and the link will expire after 48 hours.</p><form method="post" action="/company-admin/users/invite"><label class="field">Full name<input name="fullName" required></label><label class="field">Email<input name="email" type="email" required></label><label class="field">Role<select name="role"><option value="engineer">Engineer</option><option value="mechanic">Mechanic</option><option value="supervisor">Supervisor</option><option value="manager">Manager</option><option value="company_admin">Company Admin</option></select></label><button class="btn" type="submit">Send Invitation Email</button><a href="/invite-delivery" style="display:block;text-align:center;margin-top:10px;padding:11px 14px;border:1px solid #b9d9c7;border-radius:8px;color:#087548;text-decoration:none;font-size:12px;font-weight:800;background:#f4fbf7">Check Invitation Delivery</a><small style="display:block;color:#6b7780;margin-top:9px;line-height:1.4">The account is created only after the recipient accepts the invitation and sets a password.</small></form></section>`,
      );
    }

    const headers = new Headers(response.headers);
    headers.delete("content-length");
    return new Response(body, {
      status: response.status,
      statusText: response.statusText,
      headers,
    });
  },
};
