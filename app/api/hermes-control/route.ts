import { connectHermesRpc, queryHermesProjectRun, safeProjectError } from "@/lib/hermes-project-rpc.mjs";
import { projectRequestDenied, projectRpcOptions, validProjectSessionId } from "@/lib/hermes-project-request";

export const runtime = "nodejs";
const pluginActions = new Set(["list", "toggle", "install", "update", "remove", "settings"]);
async function execute(request: Request, method: string, params: Record<string, unknown>, runId?: string) {
  try {
    if (method.startsWith("subagent.")) {
      if (!runId || !validProjectSessionId(runId)) return Response.json({ error: "请选择正在运行的项目会话。" }, { status: 400 });
      return Response.json(await queryHermesProjectRun(runId, method, params), { headers: { "Cache-Control": "no-store" } });
    }
    const client = await connectHermesRpc(projectRpcOptions(request.signal));
    try { return Response.json(await client.rpc(method, params, 120000), { headers: { "Cache-Control": "no-store" } }); }
    finally { client.close(); }
  } catch (error) { return Response.json({ error: safeProjectError(error, process.env.HERMES_DASHBOARD_SESSION_TOKEN?.trim()) }, { status: 502 }); }
}
export async function GET(request: Request) {
  const denied = projectRequestDenied(request); if (denied) return denied;
  const url = new URL(request.url), section = url.searchParams.get("module");
  if (section === "plugins") return execute(request, "plugins.manage", { action: "list" });
  if (section === "agents") return execute(request, "delegation.status", {});
  if (section === "subagents") return execute(request, "subagent.list", {}, url.searchParams.get("run_id") ?? undefined);
  return Response.json({ error: "未知模块。" }, { status: 400 });
}
export async function POST(request: Request) {
  const denied = projectRequestDenied(request); if (denied) return denied;
  try {
    const body = await request.json();
    if (!body || typeof body !== "object" || JSON.stringify(body).length > 200000) throw new Error("参数无效。");
    if (body.module === "plugins" && pluginActions.has(body.action)) {
      const params: Record<string, unknown> = { action: body.action };
      for (const field of ["name", "key", "identifier", "catalog_name", "ref"]) if (body[field] !== undefined) {
        if (typeof body[field] !== "string" || !body[field].trim() || body[field].length > 4096) throw new Error("插件参数无效。");
        params[field] = body[field];
      }
      if (body.enable !== undefined) { if (typeof body.enable !== "boolean") throw new Error("启用状态无效。"); params.enable = body.enable; }
      if (body.values !== undefined) { if (!body.values || typeof body.values !== "object" || Array.isArray(body.values)) throw new Error("设置无效。"); params.values = body.values; }
      if (body.action === "install") params.enable = body.enable ?? true;
      if (body.accept_capabilities === true) params.accept_capabilities = true;
      return execute(request, "plugins.manage", params);
    }
    if (body.module === "agents" && body.action === "pause" && typeof body.paused === "boolean") return execute(request, "delegation.pause", { paused: body.paused });
    if (body.module === "subagents" && ["interrupt", "steer", "tail"].includes(body.action) && validProjectSessionId(body.subagent_id)) {
      if (body.action === "steer" && (typeof body.text !== "string" || !body.text.trim() || body.text.length > 100000)) throw new Error("请输入任务指令。");
      return execute(request, `subagent.${body.action}`, { subagent_id: body.subagent_id, ...(body.action === "steer" ? { text: body.text } : {}) }, body.run_id);
    }
    throw new Error("操作无效。");
  } catch (error) { return Response.json({ error: error instanceof Error ? error.message : "参数无效。" }, { status: 400 }); }
}
