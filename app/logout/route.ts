import { NextRequest, NextResponse } from "next/server";
import { ADMIN_COOKIE } from "../chatgpt-auth";

export async function GET(request: NextRequest) {
  const returnTo = request.nextUrl.searchParams.get("return_to") || "/login";
  const safeReturnTo = returnTo.startsWith("/") && !returnTo.startsWith("//") ? returnTo : "/login";
  const response = NextResponse.redirect(new URL(safeReturnTo, request.url));
  response.cookies.set(ADMIN_COOKIE, "", {
    path: "/",
    httpOnly: true,
    secure: true,
    sameSite: "lax",
    maxAge: 0,
  });
  return response;
}
