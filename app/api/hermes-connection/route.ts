import { projectRequestDenied } from "@/lib/hermes-project-request";
import { configuredHermesToken, fetchConnectedHermes, HermesConnectionError, invalidateHermesConnection, isLocalHermesDashboard } from "@/lib/hermes-connection.mjs";
export const runtime = "nodejs";
export async function GET(request: Request) {
  const denied = projectRequestDenied(request); if (denied) return denied;
  try {
    const response = await fetchConnectedHermes("/api/config/schema", { signal: request.signal });
    await response.body?.cancel().catch(() => {});
    if (!response.ok) throw new HermesConnectionError(response.status === 401 || response.status === 403 ? "dashboard_auth_rejected" : "dashboard_unreachable");
    return Response.json({ connected: true, local: isLocalHermesDashboard(), automatic: !configuredHermesToken() }, { headers: { "Cache-Control": "no-store" } });
  } catch (error) { return Response.json({ connected: false, code: error instanceof HermesConnectionError ? error.code : "connection_failed", error: error instanceof HermesConnectionError ? error.message : "无法连接 Hermes 管理服务，请检查服务端连接配置。" }, { headers: { "Cache-Control": "no-store" } }); }
}
export async function POST(request: Request) {
  const denied = projectRequestDenied(request); if (denied) return denied;
  invalidateHermesConnection();
  return GET(request);
}
