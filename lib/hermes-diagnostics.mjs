import { fetchConnectedHermes, resolveHermesConnection, HermesConnectionError } from "./hermes-connection.mjs";
import { hermesApiOrigin, hermesApiKey, configuredHermesToken, isLocalHermesDashboard, HermesConfigError } from "./hermes-server-config.mjs";
import { connectHermesRpc } from "./hermes-project-rpc.mjs";

const errors = {
  api_key_missing: "尚未配置 Hermes 接口服务的密钥。",
  api_auth_rejected: "Hermes 聊天服务拒绝了连接认证，请检查服务端接口密钥。",
  api_unavailable: "无法连接 Hermes 聊天服务，请检查服务地址和运行状态。",
  api_response_invalid: "Hermes 聊天服务返回了无效响应，请检查服务地址。",
  api_redirect: "Hermes 聊天服务发生地址跳转，请检查服务端连接配置。",
  project_unavailable: "无法连接 Hermes 项目会话服务，请检查 WebSocket 和聊天功能是否启用。",
  dashboard_unavailable: "无法连接 Hermes 管理服务，请检查服务端连接配置。",
};
function failed(code) { return { connected: false, code, error: errors[code] }; }
function classify(error, fallback) {
  if (error instanceof HermesConnectionError || error instanceof HermesConfigError) return { connected: false, code: error.code, error: error.message };
  return failed(fallback);
}
async function checkJson(response) {
  let reader;
  try {
    if (!response.headers.get("content-type")?.includes("application/json") || !response.body) throw new Error("Invalid response");
    reader = response.body.getReader();
    const decoder = new TextDecoder();
    let text = "", bytes = 0;
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      bytes += value.length;
      if (bytes > 2 * 1024 * 1024) throw new Error("Response too large");
      text += decoder.decode(value, { stream: true });
    }
    const data = JSON.parse(text + decoder.decode());
    if (!data || typeof data !== "object" || Array.isArray(data)) throw new Error("Invalid response");
    return data;
  } finally { if (reader) await reader.cancel().catch(() => {}); else await response.body?.cancel().catch(() => {}); }
}

/** @param {{signal?: AbortSignal, fetchImpl?: typeof fetch, connectRpc?: typeof connectHermesRpc}} [options] */
export async function diagnoseHermesConnections({ signal, fetchImpl = fetch, connectRpc = connectHermesRpc } = {}) {
  const bounded = signal ? AbortSignal.any([signal, AbortSignal.timeout(8000)]) : AbortSignal.timeout(8000);
  const dashboardCheck = async () => {
    try {
      const response = await fetchConnectedHermes("/api/config/schema", { signal: bounded, fetchImpl });
      if (!response.ok) {
        await response.body?.cancel().catch(() => {});
        throw new HermesConnectionError([401, 403].includes(response.status) ? "dashboard_auth_rejected" : "dashboard_unreachable");
      }
      await checkJson(response);
      return { connected: true };
    } catch (error) { return classify(error, "dashboard_unavailable"); }
  };
  const apiCheck = async () => {
    const token = hermesApiKey();
    if (token.length < 16) return failed("api_key_missing");
    try {
      const response = await fetchImpl(hermesApiOrigin() + "/v1/models", {
        headers: { Accept: "application/json", Authorization: `Bearer ${token}` }, signal: bounded, cache: "no-store", redirect: "manual",
      });
      if (!response.ok) {
        await response.body?.cancel().catch(() => {});
        return failed([401, 403].includes(response.status) ? "api_auth_rejected" : response.status >= 300 && response.status < 400 ? "api_redirect" : "api_unavailable");
      }
      try { const data = await checkJson(response); if (!Array.isArray(data.data)) return failed("api_response_invalid"); }
      catch { return failed("api_response_invalid"); }
      return { connected: true };
    } catch (error) { return classify(error, "api_unavailable"); }
  };
  const projectCheck = async () => {
    let client;
    const close = () => client?.close();
    try {
      const connection = await resolveHermesConnection({ fetchImpl });
      client = await connectRpc({ dashboardUrl: connection.origin, token: connection.token, signal: bounded,
        ...(isLocalHermesDashboard() && !configuredHermesToken() ? { reconnect: async () => (await resolveHermesConnection({ refresh: true, fetchImpl })).token } : {}),
      });
      bounded.addEventListener("abort", close, { once: true });
      if (bounded.aborted) throw new Error("Cancelled");
      await client.rpc("gateway.ping", {}, 5000);
      return { connected: true };
    } catch (error) { return classify(error, "project_unavailable"); }
    finally { bounded.removeEventListener("abort", close); close(); }
  };
  const [dashboard, api, project] = await Promise.all([dashboardCheck(), apiCheck(), projectCheck()]);
  let local = false;
  try { local = isLocalHermesDashboard(); } catch { /* The individual probes report configuration errors. */ }
  const failure = [dashboard, api, project].find(item => !item.connected);
  return { connected: !failure, local, automatic: !configuredHermesToken(), dashboard, api, project,
    ...(failure ? { code: failure.code, error: failure.error } : {}),
  };
}
