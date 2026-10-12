import { isValidWebSessionToken, isWebPasswordEnabled, PI_WEB_SESSION_COOKIE } from "./web-auth.ts";
import { isApiRequestAllowed } from "./request-security.ts";
import { buildHermesDashboardUrl } from "./hermes-dashboard-client.ts";

function jsonError(message, status, headers = {}) {
  return Response.json({ error: message }, { status, headers: { "Cache-Control": "no-store", ...Object.fromEntries(new Headers(headers)) } });
}

const ALLOWED_METHODS = new Set(["GET", "POST", "PUT", "PATCH", "DELETE"]);

export async function proxyHermesApiRequest(request, segments, fetchImpl = fetch) {
  const cookieHeader = request.headers.get("cookie") ?? "";
  const cookie = cookieHeader.split(";").map((part) => part.trim()).find((part) => part.startsWith(`${PI_WEB_SESSION_COOKIE}=`));
  const webToken = cookie?.slice(PI_WEB_SESSION_COOKIE.length + 1);
  const localWithoutPassword = !isWebPasswordEnabled() && ["localhost", "127.0.0.1", "[::1]"].includes(new URL(request.url).hostname) && isApiRequestAllowed(request);
  if (!localWithoutPassword && !isValidWebSessionToken(webToken)) return jsonError("Authentication required", 401);
  if (!ALLOWED_METHODS.has(request.method)) return jsonError("Method not allowed", 405, { Allow: "GET, POST, PUT, PATCH, DELETE" });
  if (!segments.length || segments.some((segment) => !segment || segment === "." || segment === ".." || !/^[A-Za-z0-9_.-]+$/.test(segment))) {
    return jsonError("Invalid Hermes API path", 400);
  }

  const incoming = new URL(request.url);
  if (segments.length === 1 && segments[0] === "health") {
    const apiKey = process.env.API_SERVER_KEY?.trim();
    if (!apiKey || apiKey.length < 16) return jsonError("Hermes API authentication is not configured", 503);
    try {
      const healthUrl = buildHermesDashboardUrl("/health", "", process.env.HERMES_API_SERVER_URL ?? "http://127.0.0.1:8642");
      const health = await fetchImpl(healthUrl, {
        method: "GET",
        headers: { Accept: "application/json", Authorization: `Bearer ${apiKey}` },
        signal: request.signal,
        cache: "no-store",
        redirect: "error",
      });
      return new Response(health.body, { status: health.status, headers: { "Content-Type": health.headers.get("content-type") ?? "application/json", "Cache-Control": "no-store" } });
    } catch {
      return jsonError("Hermes API server is unavailable", 502);
    }
  }

  if (segments[0] === "api") {
    const dashboardUrl = process.env.HERMES_DASHBOARD_URL ?? "http://127.0.0.1:8648";
    if (segments.length === 2 && segments[1] === "status") {
      try {
        const url = buildHermesDashboardUrl("/api/status", incoming.searchParams.toString(), dashboardUrl);
        const publicStatus = await fetchImpl(url, { method: "GET", headers: { Accept: request.headers.get("accept") ?? "application/json" }, signal: request.signal, cache: "no-store", redirect: "error" });
        return new Response(publicStatus.body, { status: publicStatus.status, headers: { "Content-Type": publicStatus.headers.get("content-type") ?? "application/json", "Cache-Control": "no-store" } });
      } catch {
        return jsonError("Hermes Dashboard is unavailable", 502);
      }
    }
    const dashboardToken = process.env.HERMES_DASHBOARD_SESSION_TOKEN?.trim();
    if (!dashboardToken) return jsonError("Hermes dashboard session authentication is not configured", 503);
    let url;
    try { url = buildHermesDashboardUrl(`/${segments.join("/")}`, incoming.searchParams.toString(), dashboardUrl); }
    catch { return jsonError("Invalid Hermes Dashboard path", 400); }
    const headers = new Headers({ Accept: request.headers.get("accept") ?? "application/json", "X-Hermes-Session-Token": dashboardToken });
    for (const name of ["content-type", "last-event-id", "idempotency-key"]) {
      const value = request.headers.get(name);
      if (value) headers.set(name, value);
    }
    const method = request.method.toUpperCase();
    const body = method === "GET" || !request.body ? undefined : await request.arrayBuffer();
    try {
      const upstream = await fetchImpl(url, { method, headers, ...(body ? { body } : {}), signal: request.signal, cache: "no-store", redirect: "error" });
      const responseHeaders = new Headers();
      for (const name of ["content-type", "cache-control", "last-event-id", "retry-after", "allow"]) {
        const value = upstream.headers.get(name);
        if (value) responseHeaders.set(name, value);
      }
      responseHeaders.set("Cache-Control", "no-store");
      return new Response(upstream.body, { status: upstream.status, statusText: upstream.statusText, headers: responseHeaders });
    } catch (error) {
      if (request.signal.aborted) return new Response(null, { status: 204 });
      console.error("Hermes Dashboard proxy failed:", error instanceof Error ? error.message : "unknown error");
      return jsonError("Hermes Dashboard is unavailable", 502);
    }
  }

  for (const [key] of incoming.searchParams) {
    if (["profile", "model"].includes(key)) return jsonError("Profile and model routing are disabled on this demo", 400);
  }
  const token = process.env.API_SERVER_KEY?.trim();
  if (!token || token.length < 16) return jsonError("Hermes API authentication is not configured", 503);
  let url;
  try {
    url = buildHermesDashboardUrl(`/${segments.join("/")}`, incoming.searchParams.toString(), process.env.HERMES_API_SERVER_URL ?? "http://127.0.0.1:8642");
  } catch {
    return jsonError("Invalid Hermes API path", 400);
  }
  const headers = new Headers({ Accept: request.headers.get("accept") ?? "application/json", Authorization: `Bearer ${token}` });
  for (const name of ["content-type", "last-event-id", "idempotency-key"]) {
    const value = request.headers.get(name);
    if (value) headers.set(name, value);
  }
  const method = request.method.toUpperCase();
  const body = method === "GET" || !request.body ? undefined : await request.arrayBuffer();
  try {
    const upstream = await fetchImpl(url, { method, headers, ...(body ? { body } : {}), signal: request.signal, cache: "no-store", redirect: "error" });
    const responseHeaders = new Headers();
    for (const name of ["content-type", "cache-control", "last-event-id", "retry-after", "allow"]) {
      const value = upstream.headers.get(name);
      if (value) responseHeaders.set(name, value);
    }
    responseHeaders.set("Cache-Control", "no-store");
    if (upstream.headers.has("authorization") || upstream.headers.has("x-api-key")) throw new Error("API credential appeared in upstream response headers");
    return new Response(upstream.body, { status: upstream.status, statusText: upstream.statusText, headers: responseHeaders });
  } catch (error) {
    if (request.signal.aborted) return new Response(null, { status: 204 });
    console.error("Hermes API proxy request failed:", error instanceof Error ? error.message : "unknown error");
    return jsonError("Hermes API is unavailable", 502);
  }
}

