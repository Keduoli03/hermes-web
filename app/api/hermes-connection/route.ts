import { projectRequestDenied } from "@/lib/hermes-project-request";
import { configuredHermesToken, fetchConnectedHermes, invalidateHermesConnection, isLocalHermesDashboard } from "@/lib/hermes-connection.mjs";
export const runtime = "nodejs";
export async function GET(request: Request) {
  const denied = projectRequestDenied(request); if (denied) return denied;
  try {
    const response = await fetchConnectedHermes("/api/config/schema", { signal: request.signal });
    await response.body?.cancel().catch(() => {});
    if (!response.ok) throw new Error("Hermes 管理服务拒绝了连接认证。");
    return Response.json({ connected: true, local: isLocalHermesDashboard(), automatic: !configuredHermesToken() }, { headers: { "Cache-Control": "no-store" } });
  } catch (error) { return Response.json({ connected: false, error: error instanceof Error ? error.message : "无法连接 Hermes 管理服务。" }, { headers: { "Cache-Control": "no-store" } }); }
}
export async function POST(request: Request) {
  const denied = projectRequestDenied(request); if (denied) return denied;
  invalidateHermesConnection();
  return GET(request);
}
