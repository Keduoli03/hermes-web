import { hermesApi, hermesJson } from "./hermes-client";

export type MemoryProfile = { name: string; path: string; is_default?: boolean; display_name?: string };
export type MemoryDocumentKind = "memory" | "user" | "soul";
export type MemoryDocument = { content: string; exists: boolean };

function documentPath(profile: MemoryProfile, kind: MemoryDocumentKind): string {
  const separator = profile.path.includes("\\") ? "\\" : "/";
  return `${profile.path.replace(/[\\/]+$/, "")}${separator}memories${separator}${kind === "memory" ? "MEMORY.md" : "USER.md"}`;
}

export async function readMemoryDocument(profile: MemoryProfile, kind: MemoryDocumentKind, signal?: AbortSignal): Promise<MemoryDocument> {
  if (kind === "soul") return hermesJson<MemoryDocument>(`/api/profiles/${encodeURIComponent(profile.name)}/soul`, { signal });
  const query = new URLSearchParams({ path: documentPath(profile, kind), profile: profile.name });
  // Missing documents can be created; other failures must never become an empty draft.
  const response = await fetch(`/api/hermes/api/fs/read-text?${query}`, { signal, cache: "no-store" });
  if (response.status === 404) return { content: "", exists: false };
  if (!response.ok) throw new Error("无法读取记忆内容，请检查服务连接和文件权限。");
  const document = await response.json() as { text?: string; binary?: boolean; truncated?: boolean };
  if (document.binary || document.truncated) throw new Error("文件内容无法完整读取，暂不能编辑，避免覆盖原文件。");
  if (typeof document.text !== "string") throw new Error("记忆服务返回了无效内容。");
  return { content: document.text, exists: true };
}

export async function saveMemoryDocument(profile: MemoryProfile, kind: MemoryDocumentKind, baseline: MemoryDocument, content: string): Promise<void> {
  const latest = await readMemoryDocument(profile, kind);
  if (latest.exists !== baseline.exists || latest.content !== baseline.content) throw new Error("内容已被其他会话修改。你的草稿已保留，请重新读取后合并修改。");
  if (kind === "soul") {
    await hermesApi(`/api/profiles/${encodeURIComponent(profile.name)}/soul`, { method: "PUT", body: JSON.stringify({ content }) });
  } else {
    await hermesApi(`/api/fs/write-text?${new URLSearchParams({ profile: profile.name })}`, { method: "POST", body: JSON.stringify({ path: documentPath(profile, kind), content }) });
  }
}
