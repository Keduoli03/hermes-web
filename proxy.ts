import { NextResponse, type NextRequest } from "next/server";
import { retryAfterSeconds } from "@/lib/auth-throttle";
import {
  isApiRequestAllowed,
  isApiRequestHostAllowed,
} from "@/lib/request-security";
import { authenticateWebRequest } from "@/lib/web-request-auth.mjs";

function tooManyAttempts(retryAfterMs: number): NextResponse {
  return new NextResponse("Too many failed attempts", {
    status: 429,
    headers: {
      "Cache-Control": "no-store",
      "Retry-After": String(retryAfterSeconds(retryAfterMs)),
    },
  });
}

function browserUrl(path: string, request: NextRequest): URL {
  const url = new URL(path, request.url);
  // Host was validated above; keep redirects on the browser's reverse-proxy origin.
  const host = request.headers.get("host");
  if (host) { const authority = new URL(`http://${host}`); url.hostname = authority.hostname; url.port = authority.port; }
  if (request.headers.get("x-forwarded-proto")?.split(",")[0]?.trim() === "https") url.protocol = "https:";
  return url;
}

export function proxy(request: NextRequest) {
  const oauthCallback = request.nextUrl.pathname === "/api/web-auth/official/callback";
  const isApiRequest = request.nextUrl.pathname === "/api"
    || request.nextUrl.pathname.startsWith("/api/");
  const isTrustedRequest = isApiRequest && !oauthCallback
    ? isApiRequestAllowed(request)
    : isApiRequestHostAllowed(request);

  if (!isTrustedRequest) {
    if (!isApiRequest) {
      return new NextResponse("Untrusted request", { status: 403 });
    }
    return NextResponse.json({ error: "Untrusted API request" }, { status: 403 });
  }

  const { authenticated, retryAfterMs, method } = authenticateWebRequest(request, isApiRequest);
  if (retryAfterMs > 0) return tooManyAttempts(retryAfterMs);
  if (method === "development") return NextResponse.next();
  if (request.nextUrl.pathname === "/login") {
    return authenticated
      ? NextResponse.redirect(browserUrl("/", request))
      : NextResponse.next();
  }
  if (["/api/web-auth", "/api/web-auth/official/start", "/api/web-auth/official/callback"].includes(request.nextUrl.pathname)) return NextResponse.next();

  if (!authenticated) {
    if (!isApiRequest) {
      const loginUrl = browserUrl("/login", request);
      if (request.nextUrl.search) {
        loginUrl.searchParams.set("next", `${request.nextUrl.pathname}${request.nextUrl.search}`);
      }
      return NextResponse.redirect(loginUrl);
    }
    return new NextResponse("Authentication required", {
      status: 401,
      headers: {
        "Cache-Control": "no-store",
        "WWW-Authenticate": 'Basic realm="Pi Web", charset="UTF-8"',
      },
    });
  }

  return NextResponse.next();
}

export const config = { matcher: ["/", "/login", "/api/:path*"] };
