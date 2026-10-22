import { getAuthRetryAfterMs, recordAuthFailure, retryAfterSeconds } from "./auth-throttle.ts";
import { isApiRequestAllowed, isLocalWebDevelopment } from "./request-security.ts";
import { isValidBasicAuthorization, isValidWebSessionToken, isWebAuthEnabled, PI_WEB_SESSION_COOKIE } from "./web-auth.ts";

/** @param {Request} request */
export function webSessionCookie(request) {
  return request.headers.get("cookie")?.split(";").map(part => part.trim())
    .find(part => part.startsWith(`${PI_WEB_SESSION_COOKIE}=`))?.slice(PI_WEB_SESSION_COOKIE.length + 1);
}

/** @param {Request} request */
export function authenticateWebRequest(request, allowBasic = true) {
  if (isValidWebSessionToken(webSessionCookie(request))) return { authenticated: true, retryAfterMs: 0, method: "cookie" };
  if (!isWebAuthEnabled() && isLocalWebDevelopment(request)) return { authenticated: true, retryAfterMs: 0, method: "development" };
  const authorization = allowBasic ? request.headers.get("authorization") : null;
  if (authorization && /^Basic\s/i.test(authorization)) {
    const retryAfterMs = getAuthRetryAfterMs();
    if (retryAfterMs > 0) return { authenticated: false, retryAfterMs, method: null };
    const authenticated = isValidBasicAuthorization(authorization);
    if (!authenticated) recordAuthFailure();
    return { authenticated, retryAfterMs: 0, method: authenticated ? "basic" : null };
  }
  return { authenticated: false, retryAfterMs: 0, method: null };
}

/** @param {Request} request */
export function webRequestDenied(request) {
  if (!isApiRequestAllowed(request)) return Response.json({ error: "Untrusted API request" }, { status: 403 });
  const auth = authenticateWebRequest(request);
  if (auth.authenticated) return null;
  return Response.json({ error: auth.retryAfterMs ? "Too many failed attempts" : "Authentication required" }, {
    status: auth.retryAfterMs ? 429 : 401,
    headers: { "Cache-Control": "no-store", ...(auth.retryAfterMs ? { "Retry-After": String(retryAfterSeconds(auth.retryAfterMs)) } : {}) },
  });
}
