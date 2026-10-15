import { isValidWebSessionToken, isWebAuthEnabled, PI_WEB_SESSION_COOKIE } from "./web-auth.ts";
import { isApiRequestAllowed, isLocalWebDevelopment } from "./request-security.ts";
import { buildHermesDashboardUrl, isSafeHermesApiSegment } from "./hermes-dashboard-client.ts";
import { discoverHermesModels } from "./hermes-model-discovery.mjs";
import { attachHermesRun, retainHermesRun, resolveHermesRunRequest } from "./hermes-run-store.mjs";
import { resolveHermesConnection, fetchConnectedHermes } from "./hermes-connection.mjs";

function jsonError(message, status, headers = {}) {
  return Response.json({ error: message }, { status, headers: { "Cache-Control": "no-store", ...Object.fromEntries(new Headers(headers)) } });
}

const ALLOWED_METHODS = new Set(["GET", "POST", "PUT", "PATCH", "DELETE"]);

export async function proxyHermesApiRequest(request, segments, fetchImpl = fetch) {
  const cookieHeader = request.headers.get("cookie") ?? "";
  const cookie = cookieHeader.split(";").map((part) => part.trim()).find((part) => part.startsWith(`${PI_WEB_SESSION_COOKIE}=`));
  const webToken = cookie?.slice(PI_WEB_SESSION_COOKIE.length + 1);
  const localWithoutPassword = !isWebAuthEnabled() && isLocalWebDevelopment(request) && isApiRequestAllowed(request);
  if (!localWithoutPassword && !isValidWebSessionToken(webToken)) return jsonError("Authentication required", 401);
  if (!ALLOWED_METHODS.has(request.method)) return jsonError("Method not allowed", 405, { Allow: "GET, POST, PUT, PATCH, DELETE" });
  if (!segments.length || segments.some((segment) => !isSafeHermesApiSegment(segment))) {
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
    let dashboardToken;
    try { dashboardToken = (await resolveHermesConnection({ fetchImpl })).token; }
    catch (error) { return jsonError(error instanceof Error ? error.message : "Hermes 管理服务无法连接。", 503); }
    if (segments.join("/") === "api/providers/custom-endpoints/discover") {
      if (request.method !== "POST") return jsonError("Method not allowed", 405, { Allow: "POST" });
      try {
        const input = await request.json();
        const dashboard = async (path, payload) => {
          const parsed = new URL(path, "http://hermes.internal");
          const target = buildHermesDashboardUrl(parsed.pathname, parsed.searchParams.toString(), dashboardUrl);
          const response = await fetchConnectedHermes(new URL(target).pathname + new URL(target).search, { fetchImpl, method: payload ? "POST" : "GET", headers: { "Content-Type": "application/json", Accept: "application/json" }, ...(payload ? { body: JSON.stringify(payload) } : {}), signal: request.signal });
          if (!response.ok) throw new Error("Dashboard read failed");
          return response.json();
        };
        return Response.json(await discoverHermesModels(input, dashboard, fetchImpl, request.signal), { headers: { "Cache-Control": "no-store" } });
      } catch {
        return jsonError("Model discovery is unavailable", 502);
      }
    }
    let url;
    try { url = buildHermesDashboardUrl(`/${segments.join("/")}`, incoming.searchParams.toString(), dashboardUrl); }
    catch { return jsonError("Invalid Hermes Dashboard path", 400); }
    const headers = new Headers({ Accept: request.headers.get("accept") ?? "application/json", "X-Hermes-Session-Token": dashboardToken });
    for (const name of ["content-type", "last-event-id", "idempotency-key", "range", "if-range", "sec-fetch-dest"]) {
      const value = request.headers.get(name);
      if (value) headers.set(name, value);
    }
    const method = request.method.toUpperCase();
    const body = method === "GET" || !request.body ? undefined : await request.arrayBuffer();
    try {
      const upstream = await fetchConnectedHermes(new URL(url).pathname + new URL(url).search, { fetchImpl, method, headers, ...(body ? { body } : {}), signal: request.signal });
      const responseHeaders = new Headers();
      const mediaHeaders = segments.length === 3 && segments[1] === "files" && ["stream", "download"].includes(segments[2])
        ? ["content-range", "accept-ranges", "content-disposition", "x-content-type-options", "etag", "last-modified", ...(!upstream.headers.has("content-encoding") ? ["content-length"] : [])] : [];
      for (const name of ["content-type", "cache-control", "last-event-id", "retry-after", "allow", ...mediaHeaders]) {
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
  const runEvents = segments.length === 4 && segments[0] === "v1" && segments[1] === "runs" && segments[3] === "events" && method === "GET";
  if (runEvents) {
    const cursor = Number(request.headers.get("last-event-id") || 0);
    if (!Number.isSafeInteger(cursor) || cursor < 0) return jsonError("Invalid event cursor", 400);
    const retained = attachHermesRun(segments[2], cursor, request.signal);
    if (retained) return new Response(retained, { headers: { "Content-Type": "text/event-stream", "Cache-Control": "no-store" } });
  }
  try {
    const upstream = await fetchImpl(url, { method, headers, ...(body ? { body } : {}), signal: runEvents ? undefined : request.signal, cache: "no-store", redirect: "error" });
    const responseHeaders = new Headers();
    for (const name of ["content-type", "cache-control", "last-event-id", "retry-after", "allow"]) {
      const value = upstream.headers.get(name);
      if (value) responseHeaders.set(name, value);
    }
    responseHeaders.set("Cache-Control", "no-store");
    if (upstream.headers.has("authorization") || upstream.headers.has("x-api-key")) throw new Error("API credential appeared in upstream response headers");
    if (upstream.ok && runEvents && upstream.body) {
      await retainHermesRun(upstream.body, { run_id: segments[2], project: false });
      return new Response(attachHermesRun(segments[2], 0, request.signal), { headers: { "Content-Type": "text/event-stream", "Cache-Control": "no-store" } });
    }
    if (upstream.ok && method === "POST" && segments.join("/") === "v1/runs") {
      const created = await upstream.clone().json();
      if (typeof created.run_id === "string") {
        const eventsUrl = buildHermesDashboardUrl(`/v1/runs/${created.run_id}/events`, "", process.env.HERMES_API_SERVER_URL ?? "http://127.0.0.1:8642");
        try {
          const events = await fetchImpl(eventsUrl, { headers: { Accept: "text/event-stream", Authorization: `Bearer ${token}` }, cache: "no-store", redirect: "error" });
          const input = body ? JSON.parse(new TextDecoder().decode(body)) : {};
          if (events.ok && events.body) await retainHermesRun(events.body, { run_id: created.run_id, session_id: created.session_id || input.session_id || created.run_id, project: false, onExpire: () => fetchImpl(buildHermesDashboardUrl(`/v1/runs/${created.run_id}/stop`, "", process.env.HERMES_API_SERVER_URL ?? "http://127.0.0.1:8642"), { method: "POST", headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json" }, body: "{}", redirect: "error" }) });
        } catch {
          // Run creation already succeeded. Preserve its id so retry cannot create a duplicate.
        }
      }
    }
    if (upstream.ok && method === "POST" && segments[3] === "approval") {
      try { resolveHermesRunRequest(segments[2], JSON.parse(new TextDecoder().decode(body)).request_id); } catch {}
    }
    return new Response(upstream.body, { status: upstream.status, statusText: upstream.statusText, headers: responseHeaders });
  } catch (error) {
    if (request.signal.aborted) return new Response(null, { status: 204 });
    console.error("Hermes API proxy request failed:", error instanceof Error ? error.message : "unknown error");
    return jsonError("Hermes API is unavailable", 502);
  }
}

