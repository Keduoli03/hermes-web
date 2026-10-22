const defaults = { dashboard: "http://127.0.0.1:8648", api: "http://127.0.0.1:8642" };

export class HermesConfigError extends Error {
  constructor(service) {
    super(service === "dashboard" ? "Hermes 管理服务地址必须是完整的 HTTP/HTTPS 源地址。" : "Hermes 聊天服务地址必须是完整的 HTTP/HTTPS 源地址。");
    this.name = "HermesConfigError";
    this.code = `${service}_config_invalid`;
  }
}
function origin(service, value) {
  try {
    const url = new URL(value?.trim() || defaults[service]);
    if (!["http:", "https:"].includes(url.protocol) || url.username || url.password || url.search || url.hash || url.pathname !== "/") throw new Error();
    return url.origin;
  } catch { throw new HermesConfigError(service); }
}
export function hermesDashboardOrigin() { return origin("dashboard", process.env.HERMES_DASHBOARD_URL); }
export function hermesApiOrigin() { return origin("api", process.env.HERMES_API_SERVER_URL); }
export function isLocalHermesDashboard() {
  return ["127.0.0.1", "localhost", "[::1]"].includes(new URL(hermesDashboardOrigin()).hostname);
}
export function configuredHermesToken(profile) {
  const suffix = profile?.trim().replace(/[^A-Za-z0-9_]/g, "_");
  return (suffix && suffix !== "default" ? process.env[`HERMES_DASHBOARD_SESSION_TOKEN_${suffix}`]?.trim() : "") || process.env.HERMES_DASHBOARD_SESSION_TOKEN?.trim() || "";
}
export function hermesApiKey() { return process.env.API_SERVER_KEY?.trim() || ""; }
