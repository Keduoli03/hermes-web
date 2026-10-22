import { webRequestDenied } from "./web-request-auth.mjs";
import { buildHermesDashboardUrl, isSafeHermesApiSegment } from "./hermes-dashboard-client.ts";
import { discoverHermesModels } from "./hermes-model-discovery.mjs";
import { attachHermesRun, retainHermesRun, resolveHermesRunRequest } from "./hermes-run-store.mjs";
import { resolveHermesConnection, fetchConnectedHermes } from "./hermes-connection.mjs";
import { hermesApiOrigin, hermesApiKey, hermesDashboardOrigin } from "./hermes-server-config.mjs";
import { hermesReadCache, invalidatesHermesMetadata } from "./hermes-read-cache.mjs";

function jsonError(message, status, headers = {}) {
  return Response.json({ error: message }, { status, headers: { "Cache-Control": "no-store", ...Object.fromEntries(new Headers(headers)) } });
}

const ALLOWED_METHODS = new Set(["GET", "POST", "PUT", "PATCH", "DELETE"]);

export async function proxyHermesApiRequest(request, segments, fetchImpl = fetch) {
  const denied = webRequestDenied(request);
  if (denied) return denied;
  if (!ALLOWED_METHODS.has(request.method)) return jsonError("Method not allowed", 405, { Allow: "GET, POST, PUT, PATCH, DELETE" });
  if (!segments.length || segments.some((segment) => !isSafeHermesApiSegment(segment))) {
    return jsonError("Invalid Hermes API path", 400);
  }

  const incoming = new URL(request.url);
  if (segments.length === 1 && segments[0] === "health") {
    const apiKey = hermesApiKey();
    if (!apiKey || apiKey.length < 16) return jsonError("Hermes API authentication is not configured", 503);
    try {
      const healthUrl = buildHermesDashboardUrl("/health", "", hermesApiOrigin());
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
    let dashboardUrl;
    try { dashboardUrl = hermesDashboardOrigin(); }
    catch { return jsonError("Hermes Dashboard connection configuration is invalid", 503); }
    if (segments.length === 2 && segments[1] === "status") {
      try {
        const url = buildHermesDashboardUrl("/api/status", incoming.searchParams.toString(), dashboardUrl);
        const publicStatus = await fetchImpl(url, { method: "GET", headers: { Accept: request.headers.get("accept") ?? "application/json" }, signal: request.signal, cache: "no-store", redirect: "error" });
        return new Response(publicStatus.body, { status: publicStatus.status, headers: { "Content-Type": publicStatus.headers.get("content-type") ?? "application/json", "Cache-Control": "no-store" } });
      } catch {
        return jsonError("Hermes Dashboard is unavailable", 502);
      }
    }
    const requestedProfile = incoming.searchParams.get("profile") ?? undefined;
    let dashboardToken;
    try { dashboardToken = (await resolveHermesConnection({ fetchImpl, profile: requestedProfile })).token; }
    catch (error) { return jsonError(error instanceof Error ? error.message : "Hermes 管理服务无法连接。", 503); }
    const cacheContext = JSON.stringify([dashboardUrl, dashboardToken]);
    const cacheProfile = incoming.searchParams.get("profile") ?? "current";
    if (segments.join("/") === "api/providers/custom-endpoints/discover") {
      if (request.method !== "POST") return jsonError("Method not allowed", 405, { Allow: "POST" });
      try {
        const input = await request.json();
        const dashboard = async (path, payload) => {
          const parsed = new URL(path, "http://hermes.internal");
          const profile = incoming.searchParams.get("profile");
          if (profile && !parsed.searchParams.has("profile")) parsed.searchParams.set("profile", profile);
          const target = buildHermesDashboardUrl(parsed.pathname, parsed.searchParams.toString(), dashboardUrl);
          const response = await fetchConnectedHermes(new URL(target).pathname + new URL(target).search, { fetchImpl, profile: requestedProfile, method: payload ? "POST" : "GET", headers: { "Content-Type": "application/json", Accept: "application/json" }, ...(payload ? { body: JSON.stringify(payload) } : {}), signal: request.signal });
          if (!response.ok) throw new Error("Dashboard read failed");
          return response.json();
        };
        const discoveryRevision = await hermesReadCache.discoveryRevision(cacheContext);
        const result = await discoverHermesModels(input, dashboard, fetchImpl, request.signal);
        if (result.ok && input.id && !input.api_key) await hermesReadCache.rememberDiscovery(cacheContext, cacheProfile, input, result.models, discoveryRevision);
        return Response.json(result, { headers: { "Cache-Control": "no-store" } });
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
      const path = new URL(url).pathname + new URL(url).search;
      const cacheUrl = new URL(url);
      if (request.headers.get("X-Hermes-Refresh") === "1") cacheUrl.searchParams.set("refresh", "1");
      const load = cached => fetchConnectedHermes(path, { fetchImpl, profile: requestedProfile, method, headers, ...(body ? { body } : {}), signal: cached ? AbortSignal.timeout(60000) : request.signal });
      let upstream = method === "GET" ? await hermesReadCache.read(cacheContext, cacheUrl.pathname + cacheUrl.search, load) : await fetchConnectedHermes(path, { fetchImpl, profile: requestedProfile, method, headers, ...(body ? { body } : {}), signal: request.signal });
      if (method !== "GET" && upstream.ok && invalidatesHermesMetadata(new URL(url).pathname)) await hermesReadCache.invalidate(cacheContext, { preserveDiscovery: segments[1] === "model" || segments[1] === "tools" });
      if (method === "GET" && segments.join("/") === "api/providers/custom-endpoints") upstream = await hermesReadCache.augmentEndpoints(cacheContext, cacheProfile, upstream);
      const responseHeaders = new Headers();
      const mediaHeaders = segments.length === 3 && segments[1] === "files" && ["stream", "download"].includes(segments[2])
        ? ["content-range", "accept-ranges", "content-disposition", "x-content-type-options", "etag", "last-modified", ...(!upstream.headers.has("content-encoding") ? ["content-length"] : [])] : [];
      for (const name of ["content-type", "cache-control", "last-event-id", "retry-after", "allow", "x-hermes-cache", "x-hermes-cache-age", ...mediaHeaders]) {
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
  const token = hermesApiKey();
  if (!token || token.length < 16) return jsonError("Hermes API authentication is not configured", 503);
  let url;
  try {
    url = buildHermesDashboardUrl(`/${segments.join("/")}`, incoming.searchParams.toString(), hermesApiOrigin());
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
        const eventsUrl = buildHermesDashboardUrl(`/v1/runs/${created.run_id}/events`, "", hermesApiOrigin());
        try {
          const events = await fetchImpl(eventsUrl, { headers: { Accept: "text/event-stream", Authorization: `Bearer ${token}` }, cache: "no-store", redirect: "error" });
          const input = body ? JSON.parse(new TextDecoder().decode(body)) : {};
          if (events.ok && events.body) await retainHermesRun(events.body, { run_id: created.run_id, session_id: created.session_id || input.session_id || created.run_id, project: false, onExpire: () => fetchImpl(buildHermesDashboardUrl(`/v1/runs/${created.run_id}/stop`, "", hermesApiOrigin()), { method: "POST", headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json" }, body: "{}", redirect: "error" }) });
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

