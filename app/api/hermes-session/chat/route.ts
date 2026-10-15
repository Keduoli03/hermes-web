import { controlHermesProjectRun, prepareHermesProjectChat, safeProjectError, hermesProjectModelError } from "@/lib/hermes-project-rpc.mjs";
import { projectRequestDenied, projectRpcOptions, validProjectSessionId, validateProjectDirectory, grantProjectDirectory } from "@/lib/hermes-project-request";
import { toHermesProjectPath, mapHermesProjectReferences } from "@/lib/hermes-project-paths";
import { retainHermesRun, attachHermesRun, listHermesRuns, resolveHermesRunRequest } from "@/lib/hermes-run-store.mjs";

export const runtime = "nodejs";
const headers = { "Content-Type": "text/event-stream", "Cache-Control": "no-store", "X-Accel-Buffering": "no" };
export async function GET(request: Request) {
  const denied = projectRequestDenied(request); if (denied) return denied;
  const url = new URL(request.url), id = url.searchParams.get("run_id");
  if (!id) return Response.json({ runs: listHermesRuns() }, { headers: { "Cache-Control": "no-store" } });
  const cursor = Number(request.headers.get("last-event-id") || url.searchParams.get("after") || 0);
  if (!validProjectSessionId(id) || !Number.isSafeInteger(cursor) || cursor < 0) return Response.json({ error: "运行标识无效。" }, { status: 400 });
  const stream = attachHermesRun(id, cursor, request.signal);
  return stream ? new Response(stream, { headers }) : Response.json({ error: "运行恢复记录已过期，请重新打开会话查看已保存结果。" }, { status: 404 });
}
export async function POST(request: Request) {
  const denied = projectRequestDenied(request); if (denied) return denied;
  try {
    const body = await request.json();
    if (!body || typeof body !== "object") return Response.json({ error: "聊天参数无效。" }, { status: 400 });
    if (body.action === "clarify") {
      if (!validProjectSessionId(body.run_id) || !validProjectSessionId(body.request_id) || !body.answers || typeof body.answers !== "object" || Array.isArray(body.answers) || Object.entries(body.answers).length > 50 || Object.entries(body.answers).some(([key, value]) => key.length > 200 || (value !== null && (typeof value !== "string" || value.length > 100000)))) return Response.json({ error: "问题回答无效。" }, { status: 400 });
      const result = await controlHermesProjectRun(body.run_id, "clarify", body.answers, body.request_id);
      resolveHermesRunRequest(body.run_id, body.request_id);
      return Response.json(result);
    }
    if (body.action === "stop" || body.action === "approval") {
      if (!validProjectSessionId(body.run_id) || (body.action === "approval" && (!["once", "deny"].includes(body.choice) || !validProjectSessionId(body.request_id)))) return Response.json({ error: "运行操作无效。" }, { status: 400 });
      const result = await controlHermesProjectRun(body.run_id, body.action, body.choice, body.request_id);
      if (body.action === "approval") resolveHermesRunRequest(body.run_id, body.request_id);
      return Response.json(result);
    }
    if ((body.session_id !== undefined && !validProjectSessionId(body.session_id)) || typeof body.text !== "string" || body.text.length > 1000000 || typeof body.model !== "string" || !body.model.trim() || body.model.length > 512 || (body.provider !== undefined && (typeof body.provider !== "string" || body.provider.length > 200)) || !["auto", "off", "minimal", "low", "medium", "high", "xhigh", "max"].includes(body.thinking)) return Response.json({ error: "聊天参数无效。" }, { status: 400 });
    if (body.images !== undefined && (!Array.isArray(body.images) || body.images.length > 8 || body.images.some((image: { data?: unknown; mimeType?: unknown; filename?: unknown }) => typeof image?.data !== "string" || image.data.length > 16 * 1024 * 1024 || !/^image\/(png|jpeg|webp|gif)$/.test(String(image.mimeType)) || typeof image.filename !== "string" || image.filename.length > 255))) return Response.json({ error: "图片附件无效或过大。" }, { status: 400 });
    if (!body.text.trim() && !body.images?.length) return Response.json({ error: "请输入消息。" }, { status: 400 });
    const modelError = hermesProjectModelError(body);
    if (modelError) return Response.json({ error: modelError }, { status: 400 });
    const cwd = await validateProjectDirectory(body.cwd);
    const lifetime = new AbortController();
    const stream = await prepareHermesProjectChat({ ...body, cwd: toHermesProjectPath(cwd), text: mapHermesProjectReferences(body.text, cwd) }, projectRpcOptions(lifetime.signal));
    const runId = await retainHermesRun(stream, { cwd });
    grantProjectDirectory(cwd);
    return new Response(attachHermesRun(runId, 0, request.signal), { headers });
  } catch (error) { return Response.json({ error: safeProjectError(error, process.env.HERMES_DASHBOARD_SESSION_TOKEN?.trim()) }, { status: 502 }); }
}
