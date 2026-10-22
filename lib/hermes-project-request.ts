import { stat } from "node:fs/promises";
import { resolve } from "node:path";
import { homedir } from "node:os";
import { allowFileRoot } from "./file-access";
import { webRequestDenied } from "./web-request-auth.mjs";
import { resolveHermesConnection, isLocalHermesDashboard } from "./hermes-connection.mjs";

export const projectRequestDenied = webRequestDenied;

export async function projectRpcOptions(signal: AbortSignal) {
  const connection = await resolveHermesConnection();
  return { token: connection.token, dashboardUrl: connection.origin, signal, ...(isLocalHermesDashboard() ? { reconnect: async () => (await resolveHermesConnection({ refresh: true })).token } : {}) };
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
