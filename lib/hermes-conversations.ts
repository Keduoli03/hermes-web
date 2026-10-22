import { hermesJson } from "./hermes-client";
import type { HermesSessionRow } from "../components/HermesSidebar";

export function isHermesConversation(session: { source?: string }): boolean {
  return session.source !== "cron";
}

export function listHermesConversations<T extends HermesSessionRow>(offset = 0): Promise<{ sessions: T[]; total: number }> {
  return hermesJson(`/api/sessions?${new URLSearchParams({ limit: "50", archived: "include", order: "recent", offset: String(offset), exclude_sources: "cron" })}`);
}
