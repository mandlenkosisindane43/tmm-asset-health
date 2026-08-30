import worker from "./router";
import { handleUserInvitations, type InvitationEnv } from "./user-invitations";
import { handleInviteDelivery } from "./invite-delivery";
import { handleRoleDashboardsV4 } from "./role-dashboards-v4";

interface ExecutionContext {
  waitUntil(promise: Promise<unknown>): void;
  passThroughOnException(): void;
}

interface PolishEnv extends InvitationEnv {
  ASSETS?: Fetcher;
}

export default {
  async fetch(request: Request, env: PolishEnv, ctx: ExecutionContext): Promise<Response> {
    const requestUrl = new URL(request.url);

    // Explicitly serve the approved Sindane sidebar assets from the Workers assets binding.
    if (request.method === "GET" && env.ASSETS && ["/sindane-logo-sidebar.svg", "/sindane-logo.png"].includes(requestUrl.pathname)) {
      return env.ASSETS.fetch(request);
    }

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
