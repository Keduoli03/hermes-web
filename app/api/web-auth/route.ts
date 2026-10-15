import { NextRequest, NextResponse } from "next/server";
import {
  getAuthRetryAfterMs,
  recordAuthFailure,
  recordAuthSuccess,
  retryAfterSeconds,
} from "@/lib/auth-throttle";
import { hasJsonContentType, isApiRequestAllowed, isLocalWebDevelopment } from "@/lib/request-security";
import {
  createWebSessionToken,
  isValidBasicAuthorization,
  isValidWebPassword,
  isValidWebSessionToken,
  isWebPasswordEnabled,
  isWebAuthEnabled,
  isWebUsernameRequired,
  isValidWebUsername,
  PI_WEB_SESSION_COOKIE,
  PI_WEB_SESSION_MAX_AGE,
} from "@/lib/web-auth";
import { officialLoginStatus, OAUTH_FLOW_COOKIE } from "@/lib/web-oauth";
import { officialSession, revokeOfficialSession, takeLoginFlow } from "@/lib/web-oauth-store.mjs";

export const dynamic = "force-dynamic";

function isSecureRequest(request: Request): boolean {
  return new URL(request.url).protocol === "https:"
    || request.headers.get("x-forwarded-proto")?.split(",", 1)[0]?.trim() === "https";
}

function tooManyAttempts(retryAfterMs: number): NextResponse {
  return NextResponse.json(
    { error: "Too many failed attempts", retryAfterMs },
    {
      status: 429,
      headers: {
        "Cache-Control": "no-store",
        "Retry-After": String(retryAfterSeconds(retryAfterMs)),
      },
    },
  );
}

function clearSessionCookie(response: NextResponse, request: Request): void {
  response.cookies.set({
    name: PI_WEB_SESSION_COOKIE,
    value: "",
    httpOnly: true,
    sameSite: "lax",
    secure: isSecureRequest(request),
    path: "/",
    maxAge: 0,
  });
}

export async function GET(request: NextRequest) {
  if (!isApiRequestAllowed(request)) {
    return NextResponse.json({ error: "Untrusted API request" }, { status: 403 });
  }

  const password = process.env.PI_WEB_PASSWORD;
  const enabled = isWebAuthEnabled(password);
  const authenticated = !enabled && isLocalWebDevelopment(request)
    || isValidBasicAuthorization(request.headers.get("authorization"), password)
    || isValidWebSessionToken(request.cookies.get(PI_WEB_SESSION_COOKIE)?.value, password);
  return NextResponse.json(
    { enabled, authenticated, passwordEnabled: isWebPasswordEnabled(password), ...(!enabled && !isLocalWebDevelopment(request) ? { setupRequired: true } : {}), ...(isWebUsernameRequired() ? { usernameRequired: true } : {}), official: officialLoginStatus(), ...(authenticated ? { account: officialSession(request.cookies.get(PI_WEB_SESSION_COOKIE)?.value)?.userId ?? null } : {}) },
    { headers: { "Cache-Control": "no-store" } },
  );
}

export async function POST(request: NextRequest) {
  if (!isApiRequestAllowed(request)) {
    return NextResponse.json({ error: "Untrusted API request" }, { status: 403 });
  }
  if (!hasJsonContentType(request)) {
    return NextResponse.json({ error: "Content-Type must be application/json" }, { status: 415 });
  }

  const password = process.env.PI_WEB_PASSWORD;
  if (!isWebPasswordEnabled(password)) {
    return NextResponse.json({ error: "Password authentication is disabled" }, { status: 404 });
  }

  const retryAfterMs = getAuthRetryAfterMs();
  if (retryAfterMs > 0) {
    return tooManyAttempts(retryAfterMs);
  }

  const body = await request.json().catch(() => null) as { password?: unknown; username?: unknown } | null;
  if (!body || typeof body.password !== "string" || !isValidWebPassword(body.password, password) || !isValidWebUsername(body.username)) {
    const delayMs = recordAuthFailure();
    console.warn(`[web-auth] Password authentication failed; next attempt blocked for ${delayMs}ms`);
    return NextResponse.json(
      { error: "Invalid password", retryAfterMs: delayMs },
      { status: 401, headers: { "Retry-After": String(retryAfterSeconds(delayMs)) } },
    );
  }

  recordAuthSuccess();
  const response = NextResponse.json({ ok: true });
  response.cookies.set({
    name: PI_WEB_SESSION_COOKIE,
    value: createWebSessionToken(password),
    httpOnly: true,
    sameSite: "lax",
    secure: isSecureRequest(request),
    path: "/",
    maxAge: PI_WEB_SESSION_MAX_AGE,
  });
  return response;
}

export async function DELETE(request: NextRequest) {
  if (!isApiRequestAllowed(request)) {
    return NextResponse.json({ error: "Untrusted API request" }, { status: 403 });
  }

  revokeOfficialSession(request.cookies.get(PI_WEB_SESSION_COOKIE)?.value);
  takeLoginFlow(request.cookies.get(OAUTH_FLOW_COOKIE)?.value);
  const response = NextResponse.json({ ok: true });
  response.cookies.set({ name: OAUTH_FLOW_COOKIE, value: "", httpOnly: true, sameSite: "lax", secure: isSecureRequest(request), path: "/api/web-auth/official", maxAge: 0 });
  clearSessionCookie(response, request);
  return response;
}
