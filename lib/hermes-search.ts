import { hermesJson } from "./hermes-client";
import { isHermesConversation } from "./hermes-conversations";
import type { HermesSessionRow } from "../components/HermesSidebar";

export type HermesSearchHit = HermesSessionRow & { snippet?: string; role?: string; query: string };
export type HermesSearchMatch = { query: string };

export async function searchHermesSessions(query: string, limit: number, signal: AbortSignal): Promise<HermesSearchHit[]> {
  const text = query.trim();
  if (!text || text.length > 200) throw new Error("搜索关键词需要为 1 到 200 个字符。");
  const data = await hermesJson<{ results: Record<string, unknown>[] }>(`/api/sessions/search?${new URLSearchParams({ q: text, limit: String(Math.min(100, limit)), exclude_sources: "cron" })}`, { signal });
  if (!Array.isArray(data.results)) throw new Error("会话搜索返回了无效结果，请检查 Hermes 版本。");
  const seen = new Set<string>();
  return data.results.flatMap(row => {
    const source = typeof row.source === "string" ? row.source : undefined;
    if (!isHermesConversation({ source })) return [];
    const id = row.id ?? row.session_id;
    if (typeof id !== "string" || !/^[A-Za-z0-9_.-]{1,160}$/.test(id) || seen.has(id)) return [];
    seen.add(id);
    return [{ id, source, query: text, title: typeof row.title === "string" ? row.title : null,
      snippet: typeof row.snippet === "string" ? row.snippet : undefined,
      preview: typeof row.preview === "string" ? row.preview : undefined,
      cwd: typeof row.cwd === "string" ? row.cwd : undefined,
      archived: row.archived === true, pinned: row.pinned === true,
      last_active: typeof row.last_active === "number" ? row.last_active : undefined,
      message_count: typeof row.message_count === "number" ? row.message_count : undefined,
    }];
  });
}

export function matchesHermesSearch(text: string, query: string): boolean {
  const terms = query.toLocaleLowerCase().replace(/["*]/g, " ").trim().split(/\s+/).filter(Boolean);
  return terms.length > 0 && terms.every(term => text.toLocaleLowerCase().includes(term));
}
