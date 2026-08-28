import { ADMIN_COOKIE } from "../chatgpt-auth";

export function GET(request: Request) {
  const url = new URL(request.url);
  const requested = url.searchParams.get("return_to") || "/";
  const returnTo = requested.startsWith("/") && !requested.startsWith("//") ? requested : "/";
  return new Response(null, {
    status: 302,
    headers: {
      location: returnTo,
      "set-cookie": `${ADMIN_COOKIE}=; Path=/; HttpOnly; Secure; SameSite=Lax; Max-Age=0`
    }
  });
}
