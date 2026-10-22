import { createHash } from "node:crypto";
import { hermesDashboardOrigin, isLocalHermesDashboard, configuredHermesToken } from "./hermes-server-config.mjs";
export { hermesDashboardOrigin, isLocalHermesDashboard, configuredHermesToken } from "./hermes-server-config.mjs";

const connections = globalThis.__hermesLocalConnections ??= new Map();
const connectionErrors = {
  dashboard_redirect: "无法自动连接本机 Hermes 管理服务：后端发生登录或地址跳转。请由管理员配置私有 Dashboard；仅使用本机地址不能解除后端的公网认证。",
  handshake_unavailable: "无法自动连接本机 Hermes 管理服务：该实例未提供本机握手，请确认使用私有 Dashboard，且未配置公网访问地址。",
  handshake_invalid: "无法自动连接本机 Hermes 管理服务：本机握手响应无效，请检查管理服务版本和连接地址。",
  dashboard_unreachable: "无法自动连接本机 Hermes 管理服务：连接失败或服务不可用，请检查进程和连接地址。",
  dashboard_auth_rejected: "Hermes 管理服务拒绝了连接认证。请检查服务端连接凭证；Nous 登录模式需要受支持的官方登录连接或独立私有 Dashboard。",
  remote_auth_required: "远程 Hermes 管理服务需要由管理员配置连接认证；同机部署请使用私有 Dashboard 的本机地址。",
};
export class HermesConnectionError extends Error {
  constructor(code) {
    const safeCode = Object.hasOwn(connectionErrors, code) ? code : "dashboard_unreachable";
    super(connectionErrors[safeCode]);
    this.name = "HermesConnectionError";
    this.code = safeCode;
  }
}
function connectionKey(profile) { return hermesDashboardOrigin() + ":" + createHash("sha256").update(configuredHermesToken(profile)).digest("hex"); }
export function cachedHermesToken(profile) {
  const entry = connections.get(connectionKey(profile));
  return entry?.expiresAt > Date.now() ? entry.token : configuredHermesToken(profile);
}
export function invalidateHermesConnection(profile) { connections.delete(connectionKey(profile)); }

async function boundedText(response) {
  if (!response.body) throw new HermesConnectionError("handshake_invalid");
  const reader = response.body.getReader(), decoder = new TextDecoder();
  let size = 0, text = "";
  try {
    while (true) {
      const chunk = await reader.read(); if (chunk.done) break;
      size += chunk.value.length;
      if (size > 2 * 1024 * 1024) throw new HermesConnectionError("handshake_invalid");
      text += decoder.decode(chunk.value, { stream: true });
    }
    return text + decoder.decode();
  } finally { await reader.cancel().catch(() => {}); }
}
async function rejectRedirect(response) {
  if (response.status >= 300 && response.status < 400) {
    await response.body?.cancel().catch(() => {});
    throw new HermesConnectionError("dashboard_redirect");
  }
  return response;
}
/** @param {{profile?: string, refresh?: boolean, fetchImpl?: typeof fetch}} [options] */
export async function resolveHermesConnection({ profile, refresh = false, fetchImpl = fetch } = {}) {
  const origin = hermesDashboardOrigin(), configured = configuredHermesToken(profile), key = connectionKey(profile);
  if (configured) return { origin, token: configured };
  if (!refresh && cachedHermesToken(profile)) return { origin, token: cachedHermesToken(profile) };
  if (!isLocalHermesDashboard()) {
    throw new HermesConnectionError("remote_auth_required");
  }
  const entry = connections.get(key);
  if (entry?.pending) return entry.pending;
  if (entry?.failedUntil > Date.now()) throw new HermesConnectionError(entry.code);
  const pending = Promise.resolve().then(async () => {
    let token = "";
    try {
      const options = { cache: "no-store", redirect: "manual", signal: AbortSignal.timeout(8000) };
      const response = await rejectRedirect(await fetchImpl(origin + "/", { ...options, headers: { Accept: "text/html" } }));
      if (!response.ok) { await response.body?.cancel().catch(() => {});throw new HermesConnectionError(response.status === 401 || response.status === 403 ? "dashboard_auth_rejected" : "dashboard_unreachable"); }
      if (!response.headers.get("content-type")?.includes("text/html")) {await response.body?.cancel().catch(() => {});throw new HermesConnectionError("handshake_unavailable");}
      const html = await boundedText(response);
      const match = /window\.__HERMES_SESSION_TOKEN__\s*=\s*("(?:[^"\\\r\n]|\\.)*")/.exec(html);
      if (!match) throw new HermesConnectionError("handshake_unavailable");
      try {token = JSON.parse(match[1]);} catch {throw new HermesConnectionError("handshake_invalid");}
      if (typeof token !== "string" || token.length < 16 || token.length > 4096 || /[\r\n]/.test(token)) throw new HermesConnectionError("handshake_invalid");
      const check = await rejectRedirect(await fetchImpl(origin + "/api/config/schema", { ...options, headers: { Accept: "application/json", "X-Hermes-Session-Token": token } }));
      try { if (!check.ok) throw new HermesConnectionError(check.status === 401 || check.status === 403 ? "dashboard_auth_rejected" : "dashboard_unreachable"); }
      finally { await check.body?.cancel().catch(() => {}); }
      connections.set(key, { token, expiresAt: Date.now() + 5 * 60 * 1000 });
      if (connections.size > 16) connections.delete(connections.keys().next().value);
      return { origin, token };
    } catch (cause) {
      const error = cause instanceof HermesConnectionError ? cause : new HermesConnectionError("dashboard_unreachable");
      connections.set(key, { failedUntil: Date.now() + 3000, code: error.code });
      throw error;
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
    return fetchImpl(url, { ...options, headers, cache: "no-store", redirect: "manual" }).then(rejectRedirect);
  };
  let response = await send();
  if (response.status === 401 && isLocalHermesDashboard() && !configuredHermesToken(profile) && !(options.body instanceof ReadableStream)) {
    await response.body?.cancel().catch(() => {});
    connection = await resolveHermesConnection({ profile, refresh: true, fetchImpl });
    response = await send();
  }
  return response;
}
