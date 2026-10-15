import { resolve } from "node:path";
import { projectRequestDenied } from "@/lib/hermes-project-request";
import { fromHermesProjectPath, toHermesProjectPath } from "@/lib/hermes-project-paths";
import { getAllowedFileRoots, isExistingFilePathAllowed } from "@/lib/file-access";

export const runtime = "nodejs";
export async function POST(request: Request) {
  const denied = projectRequestDenied(request); if (denied) return denied;
  try {
    const body = await request.json();
    if (typeof body.path !== "string" || body.path.length > 4096) throw new Error("文件路径无效。");
    const roots = await getAllowedFileRoots();
    let path = resolve(body.path);
    if (!isExistingFilePathAllowed(path, roots)) path = resolve(fromHermesProjectPath(body.path));
    if (!isExistingFilePathAllowed(path, roots)) return Response.json({ error: "文件不在当前允许的项目目录中。" }, { status: 403 });
    return Response.json({ path, nativePath: toHermesProjectPath(path) }, { headers: { "Cache-Control": "no-store" } });
  } catch (error) { return Response.json({ error: error instanceof Error ? error.message : "文件无法访问。" }, { status: 400 }); }
}
