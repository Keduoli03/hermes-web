import { bindHermesProject, safeProjectError } from "@/lib/hermes-project-rpc.mjs";
import { projectRequestDenied, projectRpcOptions, validProjectSessionId, validateProjectDirectory, grantProjectDirectory } from "@/lib/hermes-project-request";
import { toHermesProjectPath, fromHermesProjectPath } from "@/lib/hermes-project-paths";

export const runtime = "nodejs";
export async function POST(request: Request) {
  const denied = projectRequestDenied(request); if (denied) return denied;
  try {
    const body = await request.json();
    if (!body || typeof body !== "object") return Response.json({ error: "项目参数无效。" }, { status: 400 });
    if (body.session_id !== undefined && !validProjectSessionId(body.session_id)) return Response.json({ error: "会话 ID 无效。" }, { status: 400 });
    const cwd = await validateProjectDirectory(body.cwd);
    const result = await bindHermesProject({ session_id: body.session_id, cwd: toHermesProjectPath(cwd) }, await projectRpcOptions(request.signal));
    const confirmed = await validateProjectDirectory(fromHermesProjectPath(result.cwd));
    if (process.platform === "win32" ? confirmed.toLowerCase() !== cwd.toLowerCase() : confirmed !== cwd) throw new Error("Hermes 返回了不同的文件夹，请检查管理服务是否运行在本机。");
    grantProjectDirectory(confirmed);
    return Response.json({ cwd: confirmed, branch: result.branch, mapped: Boolean(process.env.HERMES_PROJECT_PATH_MAP) }, { headers: { "Cache-Control": "no-store" } });
  } catch (error) { return Response.json({ error: safeProjectError(error, process.env.HERMES_DASHBOARD_SESSION_TOKEN?.trim()) }, { status: 502 }); }
}
