import { createHash } from "node:crypto";
import { projectRequestDenied } from "@/lib/hermes-project-request";
import { fetchHermesDashboard } from "@/lib/hermes-dashboard-client";
import { configuredHermesToken } from "@/lib/hermes-connection.mjs";
import { loadArtifactSessions, loadSessionArtifacts, type HermesArtifact } from "@/lib/hermes-artifacts";
import { indexedSessionArtifacts } from "@/lib/hermes-artifact-index";

export const runtime = "nodejs";

export async function GET(request: Request) {
  const denied = projectRequestDenied(request);
  if (denied) return denied;
  const headers = { "Cache-Control": "no-store" };
  try {
    const namespace = createHash("sha256").update(JSON.stringify([process.env.HERMES_DASHBOARD_URL ?? "http://127.0.0.1:8648", configuredHermesToken()])).digest("hex");
    const load = async (path: string) => {
      const url = new URL(path, "http://hermes.local");
      const response = await fetchHermesDashboard(decodeURIComponent(url.pathname), { query: url.search.slice(1), signal: AbortSignal.timeout(60_000) });
      if (!response.ok) throw new Error("Hermes read failed");
      return response.json();
    };
    // Revalidate the live session list before returning cached content; deleted sessions disappear.
    const sessions = await loadArtifactSessions(load);
    const results: HermesArtifact[][] = new Array(sessions.length);
    let next = 0, failed = 0;
    const force = new URL(request.url).searchParams.get("refresh") === "1";
    await Promise.all(Array.from({ length: Math.min(3, sessions.length) }, async () => {
      while (next < sessions.length) {
        const index = next++;
        const session = sessions[index];
        try { results[index] = await indexedSessionArtifacts({ namespace, session, force, load: () => loadSessionArtifacts(session, load) }); }
        catch { failed++; results[index] = []; }
      }
    }));
    return Response.json({ sessions, artifacts: results.flat(), failed }, { headers });
  } catch {
    return Response.json({ error: "无法读取会话产物，请检查 Hermes 服务后重试。" }, { status: 502, headers });
  }
}
