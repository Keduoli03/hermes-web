import { isValidWebSessionToken, isWebAuthEnabled, PI_WEB_SESSION_COOKIE } from "@/lib/web-auth";
import { isApiRequestAllowed } from "@/lib/request-security";
import { buildHermesDashboardUrl, isSafeHermesApiSegment, getHermesProfileSessionToken } from "@/lib/hermes-dashboard-client";

function jsonError(message: string, status: number, headers: HeadersInit = {}): Response {
  return Response.json({ error: message }, { status, headers: { "Cache-Control": "no-store", ...Object.fromEntries(new Headers(headers)) } });
}

const ALLOWED_METHODS = new Set(["GET", "POST", "PUT", "PATCH", "DELETE"]);

export async function proxyHermesApiRequest(
  request: Request,
  segments: string[],
  fetchImpl: typeof fetch = fetch,
): Promise<Response> {
  const cookieHeader = request.headers.get("cookie") ?? "";
  const cookie = cookieHeader.split(";").map((part) => part.trim()).find((part) => part.startsWith(`${PI_WEB_SESSION_COOKIE}=`));
  const webToken = cookie?.slice(PI_WEB_SESSION_COOKIE.length + 1);
  const localWithoutPassword = !isWebAuthEnabled() && ["localhost", "127.0.0.1", "[::1]"].includes(new URL(request.url).hostname) && isApiRequestAllowed(request);
  if (!localWithoutPassword && !isValidWebSessionToken(webToken)) {
    return jsonError("Authentication required", 401);
  }

  if (!ALLOWED_METHODS.has(request.method)) {
    return jsonError("Method not allowed", 405, { Allow: "GET, POST, PUT, PATCH, DELETE" });
  }

  if (!segments.length || segments.some((segment) => !isSafeHermesApiSegment(segment))) {
    return jsonError("Invalid Hermes API path", 400);
  }

  const path = `/${segments.join("/")}`;
  const incoming = new URL(request.url);
  const profile = incoming.searchParams.get("profile");
  let url: string;
  try {
    url = buildHermesDashboardUrl(path, incoming.searchParams.toString());
  } catch {
    return jsonError("Invalid Hermes API path", 400);
  }

  const sessionToken = getHermesProfileSessionToken(profile);
  if (!sessionToken) {
    return jsonError("Hermes dashboard authentication is not configured", 503);
  }

  const headers = new Headers({
    Accept: request.headers.get("accept") ?? "application/json",
    "X-Hermes-Session-Token": sessionToken,
  });
  for (const name of ["content-type", "last-event-id", "idempotency-key", "range", "if-range", "sec-fetch-dest"]) {
    const value = request.headers.get(name);
    if (value) headers.set(name, value);
  }
  const method = request.method.toUpperCase();
  const body = method === "GET" || !request.body ? undefined : await request.arrayBuffer();
  try {
    const upstream = await fetchImpl(url, {
      method,
      headers,
      ...(body ? { body } : {}),
      signal: request.signal,
      cache: "no-store",
      redirect: "error",
    });
    const responseHeaders = new Headers();
    const mediaHeaders = segments.length === 3 && segments[0] === "api" && segments[1] === "files" && ["stream", "download"].includes(segments[2])
      ? ["content-range", "accept-ranges", "content-disposition", "x-content-type-options", "etag", "last-modified", ...(!upstream.headers.has("content-encoding") ? ["content-length"] : [])] : [];
    for (const name of ["content-type", "cache-control", "last-event-id", "retry-after", "allow", ...mediaHeaders]) {
      const value = upstream.headers.get(name);
      if (value) responseHeaders.set(name, value);
    }
    responseHeaders.set("Cache-Control", "no-store");
    responseHeaders.delete("X-Hermes-Session-Token");
    return new Response(upstream.body, {
      status: upstream.status,
      statusText: upstream.statusText,
      headers: responseHeaders,
    });
  } catch (error) {
    if (request.signal.aborted) return new Response(null, { status: 204 });
    console.error("Hermes API proxy request failed:", error instanceof Error ? error.message : "unknown error");
    return jsonError("Hermes API is unavailable", 502);
  }
}
