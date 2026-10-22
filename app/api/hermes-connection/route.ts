import { projectRequestDenied } from "@/lib/hermes-project-request";
import { invalidateHermesConnection } from "@/lib/hermes-connection.mjs";
import { diagnoseHermesConnections } from "@/lib/hermes-diagnostics.mjs";
export const runtime = "nodejs";
export async function GET(request: Request) {
  const denied = projectRequestDenied(request); if (denied) return denied;
  return Response.json(await diagnoseHermesConnections({ signal: request.signal }), { headers: { "Cache-Control": "no-store" } });
}
export async function POST(request: Request) {
  const denied = projectRequestDenied(request); if (denied) return denied;
  invalidateHermesConnection();
  return GET(request);
}
