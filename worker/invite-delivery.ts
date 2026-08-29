export interface InviteDeliveryEnv {
  DB: D1Database;
  RESEND_API_KEY?: string;
}

const COOKIE = "sas_contractor_v2";
const enc = new TextEncoder();

function esc(v: unknown) {
  return String(v ?? "").replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c] || c));
}
function getCookie(request: Request) {
  const raw = request.headers.get("cookie") || "";
  for (const part of raw.split(";")) {
    const i = part.indexOf("=");
    if (i > -1 && part.slice(0, i).trim() === COOKIE) return part.slice(i + 1).trim();
  }
  return "";
}
function bytesToHex(bytes: Uint8Array) { return Array.from(bytes, (b) => b.toString(16).padStart(2, "0")).join(""); }
async function sha256(value: string) { return bytesToHex(new Uint8Array(await crypto.subtle.digest("SHA-256", enc.encode(value)))); }
function redirect(location: string) { return new Response(null, { status: 303, headers: { location, "cache-control": "no-store" } }); }
function roleName(role: string) {
  return ({ company_admin: "Company Administrator", engineer: "Engineer", mechanic: "Mechanic", supervisor: "Supervisor", manager: "Manager", admin: "Administrator" } as Record<string,string>)[role] || role.replace(/_/g, " ");
}

async function getSession(request: Request, env: InviteDeliveryEnv) {
  const token = getCookie(request);
  if (!token) return null;
  const row = await env.DB.prepare(`SELECT s.company_id AS companyId,a.role,a.status AS accountStatus,c.name AS companyName,s.expires_at AS sessionExpires FROM contractor_sessions s JOIN contractor_accounts a ON a.id=s.account_id AND a.company_id=s.company_id JOIN companies c ON c.id=s.company_id WHERE s.token_hash=? LIMIT 1`).bind(await sha256(token)).first<Record<string, unknown>>();
  if (!row || String(row.accountStatus) !== "active" || new Date(String(row.sessionExpires)).getTime() < Date.now()) return null;
  return { companyId: Number(row.companyId), role: String(row.role), companyName: String(row.companyName) };
}

async function providerEvent(apiKey: string | undefined, providerId: string) {
  if (!apiKey || !providerId) return { event: providerId ? "unknown" : "not-submitted", detail: "" };
  try {
    const res = await fetch(`https://api.resend.com/emails/${encodeURIComponent(providerId)}`, {
      headers: { authorization: `Bearer ${apiKey}`, accept: "application/json" },
    });
    const data = await res.json().catch(() => ({})) as Record<string, unknown>;
    if (!res.ok) return { event: "provider-check-failed", detail: String(data.message || data.name || `HTTP ${res.status}`) };
    return { event: String(data.last_event || "sent"), detail: "" };
  } catch (e) {
    return { event: "provider-check-failed", detail: e instanceof Error ? e.message : "Unknown provider error" };
  }
}

function tone(event: string) {
  const e = event.toLowerCase();
  if (["delivered", "opened", "clicked"].includes(e)) return "good";
  if (["bounced", "suppressed", "failed", "complained", "provider-check-failed"].includes(e)) return "bad";
  return "warn";
}

export async function handleInviteDelivery(request: Request, env: InviteDeliveryEnv): Promise<Response | null> {
  const url = new URL(request.url);
  if (url.pathname !== "/invite-delivery") return null;
  if (request.method !== "GET") return new Response("Method not allowed", { status: 405 });

  const s = await getSession(request, env);
  if (!s) return redirect("/contractor-login");
  if (!["company_admin", "admin"].includes(s.role)) return new Response("Access denied", { status: 403 });

  const rows = (await env.DB.prepare(`SELECT id,email,full_name AS fullName,role,status,created_at AS createdAt,expires_at AS expiresAt,provider_message_id AS providerId FROM user_invitations_v3 WHERE company_id=? ORDER BY id DESC LIMIT 20`).bind(s.companyId).all<Record<string, unknown>>()).results || [];
  const enriched = await Promise.all(rows.map(async (r) => {
    const providerId = String(r.providerId || "");
    const p = await providerEvent(env.RESEND_API_KEY, providerId);
    return { ...r, providerEvent: p.event, providerDetail: p.detail };
  }));

  const body = `<!doctype html><html><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>Invitation Delivery | TMM Asset Health</title><style>
  *{box-sizing:border-box}body{margin:0;background:#f4f7f9;color:#10202b;font-family:Arial,Helvetica,sans-serif}.top{background:#071622;color:#fff;padding:20px 24px}.top b{font-size:20px}.top small{display:block;color:#d5dde2;margin-top:4px}.wrap{max-width:1100px;margin:24px auto;padding:0 16px}.card{background:#fff;border:1px solid #dfe7eb;border-radius:14px;padding:20px;box-shadow:0 5px 20px rgba(8,28,41,.04)}h1{font-size:25px;margin:0 0 7px}p{color:#5b6872;line-height:1.5}.btn{display:inline-block;background:#11975c;color:#fff;text-decoration:none;padding:10px 14px;border-radius:8px;font-weight:800;font-size:13px;margin-bottom:18px}.note{background:#eef7f2;border:1px solid #cfe6d8;border-radius:9px;padding:12px;margin:12px 0 18px;font-size:12px;color:#385548}table{width:100%;border-collapse:collapse;font-size:12px}th,td{padding:11px 9px;border-bottom:1px solid #e7ecef;text-align:left;vertical-align:top}th{background:#f8fafb;color:#58656f}.pill{display:inline-block;border-radius:999px;padding:5px 9px;font-weight:800;text-transform:capitalize}.good{background:#e5f6ec;color:#087044}.warn{background:#fff3d8;color:#9b6500}.bad{background:#fde7e7;color:#b31616}.muted{font-size:10px;color:#7b8790;margin-top:4px}@media(max-width:760px){table{font-size:10px}.hide-sm{display:none}}</style></head><body><div class="top"><b>TMM Asset Health</b><small>${esc(s.companyName)} · Invitation Delivery</small></div><div class="wrap"><a class="btn" href="/contractor?view=users">← Back to Users</a><div class="card"><h1>Invitation delivery status</h1><p>This page asks Resend for the latest delivery event for each invitation.</p><div class="note"><strong>Delivered</strong> means the receiving mail server accepted the message. If it is not visible in the inbox, check Spam/Junk, Promotions, or search for “TMM Asset Health” / “Sindane Asset Solutions”.</div><table><thead><tr><th>Name</th><th>Email</th><th>Role</th><th>Invite</th><th>Resend event</th><th class="hide-sm">Created</th></tr></thead><tbody>${enriched.length ? enriched.map((r) => `<tr><td>${esc(r.fullName)}</td><td>${esc(r.email)}</td><td>${esc(roleName(String(r.role)))}</td><td>${esc(r.status)}</td><td><span class="pill ${tone(String(r.providerEvent))}">${esc(r.providerEvent)}</span>${r.providerDetail ? `<div class="muted">${esc(r.providerDetail)}</div>` : ""}</td><td class="hide-sm">${esc(String(r.createdAt).replace("T"," ").slice(0,19))}</td></tr>`).join("") : `<tr><td colspan="6">No invitations found for this company.</td></tr>`}</tbody></table></div></div></body></html>`;

  return new Response(body, { headers: { "content-type": "text/html; charset=utf-8", "cache-control": "private, no-store", "x-frame-options": "DENY" } });
}
