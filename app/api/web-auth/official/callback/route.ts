import { NextRequest, NextResponse } from "next/server";
import { isApiRequestHostAllowed } from "@/lib/request-security";
import { completeOfficialLogin, isOfficialAuthOrigin, officialLoginConfig, OAUTH_FLOW_COOKIE } from "@/lib/web-oauth";
import { PI_WEB_SESSION_COOKIE } from "@/lib/web-auth";
import { takeLoginFlow } from "@/lib/web-oauth-store.mjs";

export const runtime = "nodejs";
export async function GET(request: NextRequest) {
  // Portal redirects here cross-site; state + the HttpOnly flow cookie protect this GET.
  if (!isApiRequestHostAllowed(request)) return NextResponse.json({ error: "Untrusted request" }, { status: 403 });
  let origin: string;
  let secure: boolean;
  try {
    const config = officialLoginConfig();
    origin = config.origin; secure = config.secure;
    if (!isOfficialAuthOrigin(request, origin)) return NextResponse.json({ error: "Use the configured public panel URL" }, { status: 400 });
  } catch { return NextResponse.json({ error: "Official login is not configured correctly" }, { status: 503 }); }
  let response: NextResponse;
  try {
    if (request.nextUrl.searchParams.has("error")) throw new Error("Authorization cancelled");
    const result = await completeOfficialLogin(request.cookies.get(OAUTH_FLOW_COOKIE)?.value, request.nextUrl.searchParams.get("state"), request.nextUrl.searchParams.get("code"));
    response = NextResponse.redirect(new URL(result.destination, origin), 303);
    response.cookies.set({ name: PI_WEB_SESSION_COOKIE, value: result.token, httpOnly: true, secure, sameSite: "lax", path: "/", maxAge: result.maxAge });
  } catch {
    takeLoginFlow(request.cookies.get(OAUTH_FLOW_COOKIE)?.value);
    // Never put provider errors, authorization codes or token data in URLs/logs.
    response = NextResponse.redirect(new URL("/login?auth_error=official", origin), 303);
  }
  response.cookies.set({ name: OAUTH_FLOW_COOKIE, value: "", httpOnly: true, secure, sameSite: "lax", path: "/api/web-auth/official", maxAge: 0 });
  response.headers.set("Cache-Control", "no-store");
  response.headers.set("Referrer-Policy", "no-referrer");
  return response;
}
