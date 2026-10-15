import { isAbsolute, relative, resolve, sep } from "node:path";

type Mapping = { local: string; remote: string };
function mappings(): Mapping[] {
  const raw = process.env.HERMES_PROJECT_PATH_MAP;
  if (!raw) return [];
  const entries: unknown = JSON.parse(raw);
  if (!Array.isArray(entries)) throw new Error("HERMES_PROJECT_PATH_MAP must be an array");
  return entries.map(entry => {
    if (!entry || typeof entry.local !== "string" || !isAbsolute(entry.local) || typeof entry.remote !== "string" || !/^(\/|[A-Za-z]:[\\/])/.test(entry.remote) || /[\u0000-\u001f]/.test(entry.remote)) throw new Error("Invalid project path mapping");
    return { local: resolve(entry.local), remote: entry.remote.replaceAll("\\", "/").replace(/\/$/, "") || "/" };
  });
}
function childPath(root: string, path: string) {
  const suffix = relative(root, path);
  return suffix === "" || (!isAbsolute(suffix) && suffix !== ".." && !suffix.startsWith(`..${sep}`)) ? suffix : null;
}
export function toHermesProjectPath(local: string): string {
  for (const entry of mappings().sort((a, b) => b.local.length - a.local.length)) {
    const suffix = childPath(entry.local, resolve(local));
    if (suffix !== null) return (entry.remote.replace(/\/$/, "") + (suffix ? "/" + suffix.split(sep).join("/") : "")) || "/";
  }
  if (mappings().length) throw new Error("项目文件夹不在已配置的远程目录映射中。");
  return local;
}
export function fromHermesProjectPath(remote: string): string {
  const normalized = remote.replaceAll("\\", "/").replace(/\/$/, "") || "/";
  for (const entry of mappings().sort((a, b) => b.remote.length - a.remote.length)) {
    const insensitive = /^[A-Za-z]:/.test(entry.remote);
    const root = insensitive ? entry.remote.toLowerCase() : entry.remote;
    const target = insensitive ? normalized.toLowerCase() : normalized;
    if (target === root || target.startsWith(root.replace(/\/$/, "") + "/")) {
      const local = resolve(entry.local, normalized.slice(entry.remote.length).replace(/^\//, ""));
      if (childPath(entry.local, local) === null) throw new Error("远程目录超出映射范围。");
      return local;
    }
  }
  if (mappings().length) throw new Error("会话目录不在已配置的远程目录映射中。");
  return remote;
}
export function mapHermesProjectReferences(text: string, cwd: string): string {
  const remote = toHermesProjectPath(cwd);
  if (remote === cwd) return text;
  const candidates = [...new Set([cwd, cwd.replaceAll("\\", "/"), cwd.replaceAll("/", "\\")])];
  let result = text;
  for (const local of candidates) {
    const escaped = local.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
    result = result.replace(new RegExp(`${escaped}([\\\\/][^\\s\"'\x60<>]*)?(?=$|[\\s\"'\x60),;])`, /^[A-Za-z]:/.test(local) ? "gi" : "g"), (_match, suffix: string | undefined) => remote + (suffix?.replaceAll("\\", "/") ?? ""));
  }
  return result;
}
