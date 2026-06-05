import { NextRequest, NextResponse } from "next/server";

const encoder = new TextEncoder();

function getSecret() {
  return process.env.AUTH_JWT_SECRET || process.env.SESSION_SECRET || process.env.BOT_TOKEN || "";
}

function decodeBase64Url(value: string) {
  const normalized = value.replace(/-/g, "+").replace(/_/g, "/");
  const padded = normalized.padEnd(Math.ceil(normalized.length / 4) * 4, "=");
  return atob(padded);
}

function hexFromBytes(bytes: Uint8Array) {
  return Array.from(bytes, (byte) => byte.toString(16).padStart(2, "0")).join("");
}

async function signPayload(payloadB64: string) {
  const secret = getSecret();
  if (!secret) return null;
  const key = await crypto.subtle.importKey("raw", encoder.encode(secret), { name: "HMAC", hash: "SHA-256" }, false, ["sign"]);
  const signature = await crypto.subtle.sign("HMAC", key, encoder.encode(payloadB64));
  return hexFromBytes(new Uint8Array(signature));
}

async function isAdminToken(token: string) {
  const raw = String(token || "");
  const [payloadB64, signature] = raw.split(".");
  if (!payloadB64 || !signature) return false;

  const expectedSignature = await signPayload(payloadB64);
  if (!expectedSignature || expectedSignature !== signature) return false;

  try {
    const payload = JSON.parse(decodeBase64Url(payloadB64));
    const now = Math.floor(Date.now() / 1000);
    if (payload?.typ !== "access") return false;
    if (!payload?.sub) return false;
    if (Number(payload.exp) <= now) return false;
    return payload.adm === true;
  } catch {
    return false;
  }
}

export async function middleware(request: NextRequest) {
  const accessToken = request.cookies.get("accessToken")?.value;
  const adminAllowed = accessToken ? await isAdminToken(accessToken) : false;

  if (adminAllowed) {
    return NextResponse.next();
  }

  const url = request.nextUrl.clone();
  url.pathname = "/";
  url.search = "";
  return NextResponse.redirect(url);
}

export const config = {
  matcher: ["/admin", "/admin/:path*"]
};
