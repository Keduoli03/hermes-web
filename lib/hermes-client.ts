/** Browser requests always go through the authenticated, server-side proxy. */
const errorLabels: Record<string, string> = {
  "Authentication required": "请先配置面板登录密码并登录。",
  "Hermes dashboard session authentication is not configured": "尚未配置 Hermes 管理服务的认证令牌。",
  "Hermes dashboard authentication is not configured": "尚未配置 Hermes 管理服务的认证令牌。",
  "Hermes API authentication is not configured": "尚未配置 Hermes 接口服务的密钥。",
  "Hermes API server is unavailable": "无法连接 Hermes 接口服务，请检查服务地址和运行状态。",
  "Hermes Dashboard is unavailable": "无法连接 Hermes 管理服务，请检查服务地址和运行状态。",
  "Hermes API is unavailable": "Hermes 服务暂时不可用。",
  "YAML must be a mapping": "配置必须为 YAML 键值对象。",
};

export async function hermesApi(path: string, init?: RequestInit): Promise<Response> {
  const headers = new Headers(init?.headers);
  if (init?.body && !headers.has("Content-Type")) headers.set("Content-Type", "application/json");
  const response = await fetch(`/api/hermes${path}`, { ...init, headers, cache: "no-store" });
  if (!response.ok) {
    const body = await response.json().catch(() => ({}));
    const detail = body.error ?? body.message ?? body.detail;
    throw new Error(typeof detail === "string" ? errorLabels[detail] ?? detail : detail ? JSON.stringify(detail) : `Hermes 请求失败（${response.status}）`);
  }
  return response;
}

export async function hermesJson<T>(path: string, init?: RequestInit): Promise<T> {
  const response = await hermesApi(path, init);
  return response.status === 204 ? {} as T : response.json() as Promise<T>;
}
