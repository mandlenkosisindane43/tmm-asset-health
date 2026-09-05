import { cookies } from "next/headers";
import { env } from "cloudflare:workers";
import { redirect } from "next/navigation";

export type ChatGPTUser = {
  displayName: string;
  email: string;
  fullName: string | null;
};

export const ADMIN_COOKIE = "sas_admin_session";
const SIGN_IN_PATH = "/login";
const SIGN_OUT_PATH = "/logout";
const CALLBACK_PATH = "/callback";

function configuredPassword(): string {
  return String((env as unknown as Record<string, unknown>).ADMIN_PASSWORD || "");
}

async function hmac(value: string, secret: string): Promise<string> {
  const key = await crypto.subtle.importKey(
    "raw", new TextEncoder().encode(secret),
    { name: "HMAC", hash: "SHA-256" }, false, ["sign"]
  );
  const bytes = new Uint8Array(await crypto.subtle.sign("HMAC", key, new TextEncoder().encode(value)));
  return btoa(String.fromCharCode(...bytes)).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/g, "");
}

function safeEqual(a: string, b: string): boolean {
  if (a.length !== b.length) return false;
  let difference = 0;
  for (let i = 0; i < a.length; i++) difference |= a.charCodeAt(i) ^ b.charCodeAt(i);
  return difference === 0;
}

export async function createAdminSession(password: string): Promise<string | null> {
  const secret = configuredPassword();
  if (!secret || !safeEqual(await hmac(password, secret), await hmac(secret, secret))) return null;
  const payload = btoa(JSON.stringify({
    email: "admin@sindaneassetsolutions.co.za",
    exp: Date.now() + 8 * 60 * 60 * 1000
  })).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/g, "");
  return `${payload}.${await hmac(payload, secret)}`;
}

async function sessionUser(): Promise<ChatGPTUser | null> {
  const secret = configuredPassword();
  const token = (await cookies()).get(ADMIN_COOKIE)?.value;
  if (!secret || !token) return null;
  const [payload, signature] = token.split(".");
  if (!payload || !signature || !safeEqual(signature, await hmac(payload, secret))) return null;
  try {
    const decoded = JSON.parse(atob(payload.replace(/-/g, "+").replace(/_/g, "/")));
    if (!decoded.email || Number(decoded.exp) < Date.now()) return null;
    return { displayName: "Software Owner", email: decoded.email, fullName: "Mandlenkosi Sindane" };
  } catch { return null; }
}

// Independent Sindane Asset Solutions authentication.
// This intentionally does not trust ChatGPT/OAI headers or Cloudflare Access identity headers.
export async function getChatGPTUser(): Promise<ChatGPTUser | null> {
  return sessionUser();
}

export async function requireChatGPTUser(returnTo: string): Promise<ChatGPTUser> {
  const user = await getChatGPTUser();
  if (user) return user;
  redirect(chatGPTSignInPath(returnTo));
}

export function chatGPTSignInPath(returnTo: string): string {
  const safeReturnTo = safeRelativeReturnPath(returnTo);
  return `${SIGN_IN_PATH}?return_to=${encodeURIComponent(safeReturnTo)}`;
}

export function chatGPTSignOutPath(returnTo = "/"): string {
  const safeReturnTo = safeRelativeReturnPath(returnTo);
  return `${SIGN_OUT_PATH}?return_to=${encodeURIComponent(safeReturnTo)}`;
}

function safeRelativeReturnPath(value: string): string {
  if (!value.startsWith("/") || value.startsWith("//")) return "/";
  try {
    const url = new URL(value, "https://app.local");
    if (url.origin !== "https://app.local") return "/";
    if ([SIGN_IN_PATH, SIGN_OUT_PATH, CALLBACK_PATH].includes(url.pathname)) return "/";
    return `${url.pathname}${url.search}${url.hash}`;
  } catch { return "/"; }
}
