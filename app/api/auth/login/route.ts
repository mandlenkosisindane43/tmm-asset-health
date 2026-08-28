import { ADMIN_COOKIE, createAdminSession } from "../../../chatgpt-auth";

export async function POST(request: Request) {
  const body = await request.json().catch(() => ({})) as { password?: string };
  const token = await createAdminSession(String(body.password || ""));
  if (!token) {
    return Response.json(
      { error: "Incorrect password or ADMIN_PASSWORD is not configured." },
      { status: 401 }
    );
  }
  return new Response(JSON.stringify({ ok: true }), {
    headers: {
      "content-type": "application/json",
      "set-cookie": `${ADMIN_COOKIE}=${token}; Path=/; HttpOnly; Secure; SameSite=Lax; Max-Age=28800`
    }
  });
}
