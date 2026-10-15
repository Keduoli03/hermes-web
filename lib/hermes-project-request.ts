import { stat } from "node:fs/promises";
import { resolve } from "node:path";
import { homedir } from "node:os";
import { allowFileRoot } from "./file-access";
import { isValidWebSessionToken, isWebAuthEnabled, PI_WEB_SESSION_COOKIE } from "./web-auth";
import { isApiRequestAllowed } from "./request-security";

export function projectRequestDenied(request: Request): Response | null {
  if (!isApiRequestAllowed(request)) return Response.json({ error: "请求来源不允许。" }, { status: 403 });
  const cookie = request.headers.get("cookie")?.split(";").map(item => item.trim()).find(item => item.startsWith(`${PI_WEB_SESSION_COOKIE}=`))?.slice(PI_WEB_SESSION_COOKIE.length + 1);
  const loopback = ["localhost", "127.0.0.1", "[::1]"].includes(new URL(request.url).hostname);
  if (!isValidWebSessionToken(cookie) && (isWebAuthEnabled() || !loopback)) return Response.json({ error: "请先登录。" }, { status: 401 });
  return null;
}

export function projectRpcOptions(signal: AbortSignal) {
  const token = process.env.HERMES_DASHBOARD_SESSION_TOKEN?.trim();
  if (!token) throw new Error("尚未配置 Hermes 管理服务的认证令牌。");
  return { token, dashboardUrl: process.env.HERMES_DASHBOARD_URL ?? "http://127.0.0.1:8648", signal };
}

export const validProjectSessionId = (value: unknown): value is string => typeof value === "string" && /^[A-Za-z0-9_.-]{1,160}$/.test(value);

export async function validateProjectDirectory(value: unknown) {
  if (typeof value !== "string" || !value.trim() || value.length > 4096) throw new Error("请选择有效的项目文件夹。");
  const raw = value.trim();
  const cwd = resolve(raw === "~" ? homedir() : raw.startsWith("~/") ? resolve(homedir(), raw.slice(2)) : raw);
  const info = await stat(cwd).catch(() => null);
  if (!info?.isDirectory()) throw new Error("项目文件夹不存在或无法访问。");
  return cwd;
}

export function grantProjectDirectory(cwd: string) { allowFileRoot(cwd); }
