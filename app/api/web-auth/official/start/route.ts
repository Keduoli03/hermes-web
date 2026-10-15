import { NextRequest, NextResponse } from "next/server";
import { isApiRequestAllowed } from "@/lib/request-security";
import { isOfficialAuthOrigin, officialLoginConfig, OAUTH_FLOW_COOKIE, startOfficialLogin } from "@/lib/web-oauth";

export const runtime = "nodejs";
export async function GET(request: NextRequest) {
  if (!isApiRequestAllowed(request)) return NextResponse.json({ error: "Untrusted request" }, { status: 403 });
  try {
    const config = officialLoginConfig();
    if (!isOfficialAuthOrigin(request, config.origin)) return NextResponse.json({ error: "Use the configured public panel URL" }, { status: 400 });
    const login = startOfficialLogin(request.nextUrl.searchParams.get("next"));
    const response = NextResponse.redirect(login.url, 303);
    response.headers.set("Cache-Control", "no-store");
    response.headers.set("Referrer-Policy", "no-referrer");
    response.cookies.set({ name: OAUTH_FLOW_COOKIE, value: login.cookie, httpOnly: true, secure: login.secure, sameSite: "lax", path: "/api/web-auth/official", maxAge: 600 });
    return response;
  } catch {
    return NextResponse.json({ error: "Official login is not configured correctly" }, { status: 503 });
  }
}
