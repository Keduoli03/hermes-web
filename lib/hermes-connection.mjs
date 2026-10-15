import { createHash } from "node:crypto";

const connections = globalThis.__hermesLocalConnections ??= new Map();
export function hermesDashboardOrigin() {
  const url = new URL(process.env.HERMES_DASHBOARD_URL || "http://127.0.0.1:8648");
  if (!["http:", "https:"].includes(url.protocol) || url.username || url.password || url.search || url.hash || url.pathname !== "/") throw new Error("Hermes 管理服务地址必须是完整的 HTTP/HTTPS 源地址。");
  return url.origin;
}
export function isLocalHermesDashboard() {
  return ["127.0.0.1", "localhost", "[::1]"].includes(new URL(hermesDashboardOrigin()).hostname);
}
export function configuredHermesToken(profile) {
  const suffix = profile?.trim().replace(/[^A-Za-z0-9_]/g, "_");
  return (suffix && suffix !== "default" ? process.env[`HERMES_DASHBOARD_SESSION_TOKEN_${suffix}`]?.trim() : "") || process.env.HERMES_DASHBOARD_SESSION_TOKEN?.trim() || "";
}
function connectionKey(profile) { return hermesDashboardOrigin() + ":" + createHash("sha256").update(configuredHermesToken(profile)).digest("hex"); }
export function cachedHermesToken(profile) {
  const entry = connections.get(connectionKey(profile));
  return entry?.expiresAt > Date.now() ? entry.token : configuredHermesToken(profile);
}
export function invalidateHermesConnection(profile) { connections.delete(connectionKey(profile)); }

async function boundedText(response) {
  if (!response.body) throw new Error("Empty handshake");
  const reader = response.body.getReader(), decoder = new TextDecoder();
  let size = 0, text = "";
  try {
    while (true) {
      const chunk = await reader.read(); if (chunk.done) break;
      size += chunk.value.length;
      if (size > 2 * 1024 * 1024) throw new Error("Handshake too large");
      text += decoder.decode(chunk.value, { stream: true });
    }
    return text + decoder.decode();
  } finally { await reader.cancel().catch(() => {}); }
}
/** @param {{profile?: string, refresh?: boolean, fetchImpl?: typeof fetch}} [options] */
export async function resolveHermesConnection({ profile, refresh = false, fetchImpl = fetch } = {}) {
  const origin = hermesDashboardOrigin(), configured = configuredHermesToken(profile), key = connectionKey(profile);
  if (!refresh && cachedHermesToken(profile)) return { origin, token: cachedHermesToken(profile) };
  if (!isLocalHermesDashboard()) {
    if (configured) return { origin, token: configured };
    throw new Error("远程 Hermes 管理服务需要由管理员配置连接认证；同机部署请使用 127.0.0.1 的管理服务地址。");
  }
  const entry = connections.get(key);
  if (entry?.pending) return entry.pending;
  if (entry?.failedUntil > Date.now()) throw new Error(entry.error);
  const pending = Promise.resolve().then(async () => {
    let token = "";
    try {
      const options = { cache: "no-store", redirect: "error", signal: AbortSignal.timeout(8000) };
      const response = await fetchImpl(origin + "/", { ...options, headers: { Accept: "text/html" } });
      if (!response.ok || !response.headers.get("content-type")?.includes("text/html")) throw new Error("Unavailable handshake");
      const html = await boundedText(response);
      const match = /window\.__HERMES_SESSION_TOKEN__\s*=\s*("(?:[^"\\\r\n]|\\.)*")/.exec(html);
      if (!match) throw new Error("Unavailable handshake");
      token = JSON.parse(match[1]);
      if (typeof token !== "string" || token.length < 16 || token.length > 4096 || /[\r\n]/.test(token)) throw new Error("Invalid handshake");
      const check = await fetchImpl(origin + "/api/config/schema", { ...options, headers: { Accept: "application/json", "X-Hermes-Session-Token": token } });
      try { if (!check.ok) throw new Error("Rejected handshake"); }
      finally { await check.body?.cancel().catch(() => {}); }
      connections.set(key, { token, expiresAt: Date.now() + 5 * 60 * 1000 });
      if (connections.size > 16) connections.delete(connections.keys().next().value);
      return { origin, token };
    } catch {
      const error = "无法自动连接本机 Hermes 管理服务，请确认 Dashboard 已启动、地址正确，并提供官方本机握手。";
      connections.set(key, { failedUntil: Date.now() + 3000, error });
      throw new Error(error);
    }
  });
  connections.set(key, { pending });
  return pending;
}

/** @param {string} path @param {RequestInit & {profile?: string, fetchImpl?: typeof fetch}} [init] */
export async function fetchConnectedHermes(path, { profile, fetchImpl = fetch, ...options } = {}) {
  let connection = await resolveHermesConnection({ profile, fetchImpl });
  const send = () => {
    const url = new URL(path, connection.origin);
    if (!path.startsWith("/api/") || path.startsWith("//") || url.origin !== connection.origin || !url.pathname.startsWith("/api/")) throw new Error("Invalid Hermes management path");
    const headers = new Headers(options.headers);
    headers.set("X-Hermes-Session-Token", connection.token);
    return fetchImpl(url, { ...options, headers, cache: "no-store", redirect: "error" });
  };
  let response = await send();
  if (response.status === 401 && isLocalHermesDashboard() && !(options.body instanceof ReadableStream)) {
    await response.body?.cancel().catch(() => {});
    connection = await resolveHermesConnection({ profile, refresh: true, fetchImpl });
    response = await send();
  }
  return response;
}
