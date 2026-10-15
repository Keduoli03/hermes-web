import { createHash } from "node:crypto";
import { projectRequestDenied, validProjectSessionId } from "@/lib/hermes-project-request";
import { fetchHermesDashboard } from "@/lib/hermes-dashboard-client";
import { configuredHermesToken } from "@/lib/hermes-connection.mjs";
import { loadSessionArtifacts, type ArtifactSession } from "@/lib/hermes-artifacts";
import { artifactVersionKey, listArtifactVersions, readArtifactVersion, saveArtifactVersion, deleteArtifactVersion } from "@/lib/hermes-artifact-versions";

export const runtime = "nodejs";
async function selectedArtifact(sessionId: string | null, artifactId: string | null, signal: AbortSignal) {
  if (!validProjectSessionId(sessionId) || !artifactId || artifactId.length > 1024) throw new Error("产物参数无效。");
  const load = async (path: string) => {
    const url = new URL(path, "http://hermes.internal");
    const response = await fetchHermesDashboard(decodeURIComponent(url.pathname), { query: url.search.slice(1), signal });
    if (!response.ok) throw new Error("产物所属会话无法读取。");
    return response.json();
  };
  const session = await load(`/api/sessions/${encodeURIComponent(sessionId)}`) as ArtifactSession;
  const artifact = (await loadSessionArtifacts({ ...session, id: sessionId }, load)).find(item => item.id === artifactId);
  if (!artifact) throw new Error("产物已不存在或无法访问。");
  const namespace = createHash("sha256").update(JSON.stringify([process.env.HERMES_DASHBOARD_URL, configuredHermesToken()])).digest("hex");
  return { artifact, key: artifactVersionKey(namespace, artifact) };
}
export async function GET(request: Request) {
  const denied = projectRequestDenied(request); if (denied) return denied;
  try {
    const params = new URL(request.url).searchParams;
    const { key } = await selectedArtifact(params.get("session_id"), params.get("artifact_id"), request.signal);
    const id = params.get("version");
    if (!id) return Response.json({ versions: await listArtifactVersions(key) }, { headers: { "Cache-Control": "no-store" } });
    const { bytes } = await readArtifactVersion(key, id);
    return new Response(bytes, { headers: { "Content-Type": "application/octet-stream", "Content-Disposition": `attachment; filename="artifact-${id.slice(0, 12)}"`, "X-Content-Type-Options": "nosniff", "Cache-Control": "no-store" } });
  } catch (error) { return Response.json({ error: error instanceof Error ? error.message : "版本读取失败。" }, { status: 400 }); }
}
export async function POST(request: Request) {
  const denied = projectRequestDenied(request); if (denied) return denied;
  try {
    const body = await request.json();
    const { artifact, key } = await selectedArtifact(body.session_id, body.artifact_id, request.signal);
    let bytes: Uint8Array, contentType: string;
    if (artifact.kind === "code") { bytes = new TextEncoder().encode(artifact.content); contentType = "text/plain;charset=utf-8"; }
    else {
      if (/^(https?:|data:|blob:)/i.test(artifact.source)) throw new Error("外部链接暂不支持保存版本。");
      const response = await fetchHermesDashboard("/api/files/download", { query: new URLSearchParams({ path: artifact.source }).toString(), signal: request.signal });
      if (!response.ok || !response.body) throw new Error("无法读取产物文件。");
      const reader = response.body.getReader(), chunks: Uint8Array[] = []; let size = 0;
      try { while (true) { const chunk = await reader.read(); if (chunk.done) break; size += chunk.value.length; if (size > 32 * 1024 * 1024) throw new Error("产物超过版本存储上限（32 MB）。"); chunks.push(chunk.value); } }
      finally { await reader.cancel(); }
      bytes = new Uint8Array(size); let offset = 0; for (const chunk of chunks) { bytes.set(chunk, offset); offset += chunk.length; }
      contentType = response.headers.get("Content-Type") || "application/octet-stream";
    }
    return Response.json(await saveArtifactVersion(key, bytes, artifact.title, contentType), { headers: { "Cache-Control": "no-store" } });
  } catch (error) { return Response.json({ error: error instanceof Error ? error.message : "版本保存失败。" }, { status: 400 }); }
}
export async function DELETE(request: Request) {
  const denied = projectRequestDenied(request); if (denied) return denied;
  try {
    const body = await request.json();
    const { key } = await selectedArtifact(body.session_id, body.artifact_id, request.signal);
    await deleteArtifactVersion(key, body.version);
    return Response.json({ ok: true });
  } catch (error) { return Response.json({ error: error instanceof Error ? error.message : "版本删除失败。" }, { status: 400 }); }
}
