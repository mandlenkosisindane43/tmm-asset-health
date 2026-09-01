import worker from "./router";
import { handleUserInvitations, type InvitationEnv } from "./user-invitations";
import { handleInviteDelivery } from "./invite-delivery";
import { handleRoleDashboardsV4 } from "./role-dashboards-v4";
import { handleTenantIsolationAudit } from "./tenant-isolation-audit";
import { decodeSindaneLogoWebp, sindaneLogoDataUri } from "./sindane-logo-data";

interface ExecutionContext {
  waitUntil(promise: Promise<unknown>): void;
  passThroughOnException(): void;
}

interface PolishEnv extends InvitationEnv {
  ASSETS?: Fetcher;
  ADMIN_PASSWORD?: string;
}

type LicenceSession = {
  companyId: number;
  accountId: number;
  companyName: string;
  fullName: string;
  role: string;
  licenceKey: string;
  licenceStatus: string;
  expiresAt: string;
  graceDays: number;
  maxUsers: number;
};

const SESSION_COOKIE = "sas_contractor_v2";
const encoder = new TextEncoder();

function esc(value: unknown) {
  return String(value ?? "").replace(/[&<>"']/g, c => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c] || c));
}

function getCookie(request: Request, name: string) {
  const raw = request.headers.get("cookie") || "";
  for (const part of raw.split(";")) {
    const i = part.indexOf("=");
    if (i > -1 && part.slice(0, i).trim() === name) return part.slice(i + 1).trim();
  }
  return "";
}

async function sha256(value: string) {
  const bytes = new Uint8Array(await crypto.subtle.digest("SHA-256", encoder.encode(value)));
  return Array.from(bytes, b => b.toString(16).padStart(2, "0")).join("");
}

async function currentLicenceSession(request: Request, env: PolishEnv): Promise<LicenceSession | null> {
  const token = getCookie(request, SESSION_COOKIE);
  if (!token) return null;
  try {
    const row = await env.DB.prepare(`SELECT s.company_id AS companyId,s.account_id AS accountId,s.expires_at AS sessionExpires,
      a.full_name AS fullName,COALESCE(NULLIF(s.active_role,''),a.role) AS role,a.status AS accountStatus,
      c.name AS companyName,c.licence_key AS licenceKey,c.licence_status AS licenceStatus,c.expires_at AS expiresAt,
      c.grace_days AS graceDays,c.max_users AS maxUsers
      FROM contractor_sessions s
      JOIN contractor_accounts a ON a.id=s.account_id AND a.company_id=s.company_id
      JOIN companies c ON c.id=s.company_id
      WHERE s.token_hash=? LIMIT 1`).bind(await sha256(token)).first<Record<string, unknown>>();
    if (!row || String(row.accountStatus) !== "active") return null;
    if (new Date(String(row.sessionExpires)).getTime() < Date.now()) return null;
    return {
      companyId: Number(row.companyId),
      accountId: Number(row.accountId),
      companyName: String(row.companyName || ""),
      fullName: String(row.fullName || ""),
      role: String(row.role || ""),
      licenceKey: String(row.licenceKey || ""),
      licenceStatus: String(row.licenceStatus || ""),
      expiresAt: String(row.expiresAt || ""),
      graceDays: Number(row.graceDays || 0),
      maxUsers: Number(row.maxUsers || 0),
    };
  } catch {
    return null;
  }
}

function roleLabel(role: string) {
  return ({ engineer: "Engineer", mechanic: "Mechanic", supervisor: "Supervisor", manager: "Mine Manager", company_admin: "Company Administrator" } as Record<string, string>)[role] || role;
}

function serveBrandLogo() {
  return new Response(decodeSindaneLogoWebp(), {
    status: 200,
    headers: {
      "content-type": "image/webp",
      "cache-control": "no-store",
      "x-content-type-options": "nosniff",
    },
  });
}

function simplePage(title: string, body: string, status = 200) {
  return new Response(`<!doctype html><html><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>${esc(title)} · TMM Asset Health</title><style>
  *{box-sizing:border-box}body{margin:0;background:#f4f7f8;color:#112238;font-family:Arial,Helvetica,sans-serif}.top{background:#061827;color:#fff;padding:14px 22px;display:flex;justify-content:space-between;align-items:center}.top a{color:#fff;text-decoration:none;font-weight:800}.wrap{max-width:980px;margin:24px auto;padding:0 18px}.brand{text-align:center;margin-bottom:18px}.brand img{width:190px;height:145px;object-fit:contain}.card{background:#fff;border:1px solid #dbe4e8;border-radius:14px;padding:22px;margin-bottom:14px}.card h1,.card h2{margin-top:0}.grid{display:grid;grid-template-columns:repeat(3,1fr);gap:12px}.item{background:#f8fafb;border:1px solid #e5ebee;border-radius:10px;padding:14px}.item small{display:block;color:#71808d;font-size:11px;margin-bottom:5px}.item b{font-size:16px}.status{display:inline-block;padding:6px 10px;border-radius:999px;background:#e6f7ed;color:#087948;font-weight:900;text-transform:capitalize}.btn{display:inline-block;border:0;border-radius:9px;background:#11975c;color:#fff;text-decoration:none;padding:11px 15px;font-weight:900;cursor:pointer;margin:5px 6px 0 0}.btn.secondary{background:#0f3158}.notice{padding:13px;border-radius:9px;background:#fff7e8;border:1px solid #f2d28f;color:#74520b}.quote{display:flex;justify-content:space-between;align-items:center;gap:12px;border:1px solid #e3e9ed;border-radius:10px;padding:14px}.muted{color:#6f7d89;font-size:13px}.print-only{display:none}@media(max-width:700px){.grid{grid-template-columns:1fr}.quote{display:block}}@media print{.top,.no-print{display:none!important}.wrap{max-width:none;margin:0;padding:0}.card{border:0;box-shadow:none}.print-only{display:block}}
  </style></head><body><div class="top"><a href="/contractor">← Dashboard</a><b>TMM Asset Health</b></div><div class="wrap"><div class="brand"><img src="${sindaneLogoDataUri()}" alt="Sindane Asset Solutions"></div>${body}</div></body></html>`, {
    status,
    headers: {
      "content-type": "text/html; charset=utf-8",
      "cache-control": "private, no-store",
      "x-frame-options": "DENY",
      "referrer-policy": "same-origin",
      "content-security-policy": "default-src 'self'; style-src 'self' 'unsafe-inline'; script-src 'self' 'unsafe-inline'; img-src 'self' data:; frame-ancestors 'none'; base-uri 'self'",
    },
  });
}

async function licencePage(request: Request, env: PolishEnv) {
  const s = await currentLicenceSession(request, env);
  if (!s) return Response.redirect(new URL("/contractor-login", request.url).toString(), 302);
  const expiry = new Date(s.expiresAt);
  const daysRemaining = Number.isFinite(expiry.getTime()) ? Math.max(0, Math.ceil((expiry.getTime() - Date.now()) / 86400000)) : 0;
  let quotation: Record<string, unknown> | null = null;
  try {
    quotation = await env.DB.prepare(`SELECT id,file_name AS fileName,created_at AS createdAt,category
      FROM contractor_documents
      WHERE company_id=? AND lower(category) IN ('quotation','licence-quotation','license-quotation','subscription-quotation')
      ORDER BY id DESC LIMIT 1`).bind(s.companyId).first<Record<string, unknown>>();
  } catch {
    quotation = null;
  }
  const quoteBlock = quotation
    ? `<div class="quote"><div><b>${esc(quotation.fileName)}</b><div class="muted">Latest subscription/licence quotation · ${esc(String(quotation.createdAt || "").slice(0,10))}</div></div><a class="btn secondary no-print" href="/api/contractor/documents/${Number(quotation.id)}/download">Open quotation</a></div>`
    : `<div class="notice">No subscription/licence quotation has been uploaded for this company yet. The Company Administrator can save the quotation in Documents and it will appear here automatically.</div>`;
  return simplePage("Licence & Subscription", `<section class="card"><h1>Licence & Subscription</h1><p class="muted">Secure licence information for <b>${esc(s.companyName)}</b>. This page only reads the signed-in company's subscription.</p><div class="grid"><div class="item"><small>Company</small><b>${esc(s.companyName)}</b></div><div class="item"><small>Licence status</small><span class="status">${esc(s.licenceStatus)}</span></div><div class="item"><small>Days remaining</small><b>${daysRemaining}</b></div><div class="item"><small>Expiry date</small><b>${esc(s.expiresAt.slice(0,10))}</b></div><div class="item"><small>Grace period</small><b>${s.graceDays} days</b></div><div class="item"><small>Maximum users</small><b>${s.maxUsers}</b></div><div class="item"><small>Licence key</small><b>${esc(s.licenceKey)}</b></div><div class="item"><small>Signed-in user</small><b>${esc(s.fullName)}</b></div><div class="item"><small>Role</small><b>${esc(roleLabel(s.role))}</b></div></div></section><section class="card"><h2>Subscription / Licence Quotation</h2>${quoteBlock}<div class="no-print" style="margin-top:14px"><button class="btn" type="button" onclick="window.print()">🖨 Print Licence Details</button><a class="btn secondary" href="/contractor?view=documents">Open Documents</a></div></section>`);
}

async function settingsPage(request: Request, env: PolishEnv) {
  const s = await currentLicenceSession(request, env);
  if (!s) return Response.redirect(new URL("/contractor-login", request.url).toString(), 302);
  return simplePage("Settings", `<section class="card"><h1>Settings</h1><p class="muted">Signed in as <b>${esc(s.fullName)}</b> · ${esc(roleLabel(s.role))} · ${esc(s.companyName)}</p><div class="grid"><div class="item"><small>Account</small><b>${esc(s.fullName)}</b></div><div class="item"><small>Company</small><b>${esc(s.companyName)}</b></div><div class="item"><small>Role</small><b>${esc(roleLabel(s.role))}</b></div></div><p class="muted" style="margin-top:16px">Company-wide configuration, users, targets and alert rules remain controlled by the Company Administrator.</p></section>`);
}

async function polishRoleDashboard(response: Response) {
  const contentType = response.headers.get("content-type") || "";
  if (!contentType.includes("text/html")) return response;
  let body = await response.text();

  // Embed the logo directly so it cannot become a broken external image.
  body = body.replace(/<div class="brand"><img[^>]*><\/div>/, `<div class="brand"><img src="${sindaneLogoDataUri()}" alt="Sindane Asset Solutions"></div>`);

  // Licence & Subscription is intentionally placed before Settings for every operational role.
  body = body.replace("</nav>", `<a href="/contractor-licence"><span>♢</span>Licence &amp; Subscription</a><a href="/contractor-settings"><span>⚙</span>Settings</a></nav>`);

  // Print exactly what the user is currently viewing on the dashboard.
  body = body.replace('<span class="userdot">', '<button class="printdash" type="button" onclick="window.print()">🖨 Print Dashboard</button><span class="userdot">');
  body = body.replace("</style>", `.printdash{border:1px solid #3b5265;background:#0f3158;color:#fff;border-radius:7px;padding:8px 10px;font-size:11px;font-weight:800;cursor:pointer}.printdash:hover{background:#11975c}@media print{.sidebar,.top,.printdash{display:none!important}.layout{display:block!important}.main{width:100%!important}.content{max-width:none!important;padding:0!important}html,body{background:#fff!important}.panel,.kpi,.smallcard{break-inside:avoid;box-shadow:none!important}.headline{margin-top:0}.security{margin-top:6px}}</style>`);

  const headers = new Headers(response.headers);
  headers.delete("content-length");
  headers.set("content-security-policy", "default-src 'self'; style-src 'self' 'unsafe-inline'; script-src 'self' 'unsafe-inline'; img-src 'self' data:; frame-ancestors 'none'; base-uri 'self'");
  return new Response(body, { status: response.status, statusText: response.statusText, headers });
}

export default {
  async fetch(request: Request, env: PolishEnv, ctx: ExecutionContext): Promise<Response> {
    const requestUrl = new URL(request.url);

    if (request.method === "GET" && ["/sindane-logo-sidebar.svg", "/sindane-logo.png"].includes(requestUrl.pathname)) {
      return serveBrandLogo();
    }

    if (request.method === "GET" && requestUrl.pathname === "/contractor-licence") return licencePage(request, env);
    if (request.method === "GET" && requestUrl.pathname === "/contractor-settings") return settingsPage(request, env);

    const tenantAudit = await handleTenantIsolationAudit(request, env);
    if (tenantAudit) return tenantAudit;

    const delivery = await handleInviteDelivery(request, env);
    if (delivery) return delivery;

    const invitation = await handleUserInvitations(request, env);
    if (invitation) return invitation;

    const roleDashboard = await handleRoleDashboardsV4(request, env);
    if (roleDashboard) return polishRoleDashboard(roleDashboard);

    const response = await worker.fetch(request, env as never, ctx);
    const url = new URL(request.url);

    if (request.method === "GET" && url.pathname === "/contractor-login") {
      const contentType = response.headers.get("content-type") || "";
      if (!contentType.includes("text/html")) return response;

      let body = await response.text();
      body = body.replace(
        `<div class="brand">TMM Asset Health<small>Sindane Asset Solutions</small></div>`,
        `<div class="brand"><img src="${sindaneLogoDataUri()}" alt="Sindane Asset Solutions"><div class="brand-title">TMM Asset Health</div><small>Sindane Asset Solutions</small></div>`,
      );
      body = body.replace(
        `.box{width:min(430px,100%);background:#fff;padding:32px;border-radius:18px}`,
        `.box{width:min(500px,100%);background:#fff;padding:38px 40px;border-radius:20px;box-shadow:0 20px 55px rgba(0,0,0,.22)}`,
      );
      body = body.replace(
        `.brand{font-weight:900;color:#0f3158}.brand small{display:block;color:#64748b;margin-top:4px}`,
        `.brand{text-align:center;font-weight:900;color:#0f3158}.brand img{display:block;width:210px;max-width:86%;height:158px;object-fit:contain;margin:0 auto 4px;border-radius:4px}.brand-title{font-size:23px;line-height:1.2}.brand small{display:block;color:#64748b;margin-top:5px;font-size:14px}`,
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

    body = body.replace(
      "width:132px;max-width:132px;height:103px",
      "width:146px;max-width:146px;height:114px",
    );
    body = body.replace(
      "width:120px;max-width:120px;height:94px",
      "width:132px;max-width:132px;height:103px",
    );
    body = body.replace(
      ".side nav a.active,.side nav a:hover{background:#0a7a49}",
      ".side nav a.active,.side nav a:hover{background:#11975c}",
    );

    // Make quotation an available private document category for Company Admin uploads.
    if (view === "documents") {
      body = body.replace("<option>oem</option>", "<option>oem</option><option value=\"quotation\">quotation / licence</option>");
    }

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
