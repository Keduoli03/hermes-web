"use client";

import { useEffect, useEffectEvent, useState } from "react";
import { hermesJson } from "@/lib/hermes-client";
import { readMemoryDocument, saveMemoryDocument, type MemoryDocument, type MemoryDocumentKind, type MemoryProfile } from "@/lib/hermes-memory-client";
import { useHermesI18n } from "@/hooks/useHermesI18n";
import { ConfigButton, ConfigNotice } from "./SettingsUi";
import { MarkdownBody } from "./MarkdownBody";

type Card = MemoryDocument & { draft: string; loading: boolean; saving: boolean; editing: boolean; preview: boolean; error: string; notice: string };
const kinds: MemoryDocumentKind[] = ["memory", "user", "soul"];
const titles = { memory: "我的笔记", user: "用户画像", soul: "灵魂" };
const fresh = (): Card => ({ content: "", draft: "", exists: false, loading: true, saving: false, editing: false, preview: false, error: "", notice: "" });

function MemoryIcon({ kind }: { kind: MemoryDocumentKind }) {
  return <svg width="17" height="17" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">{kind === "memory" ? <><path d="M5 3h9l5 5v13H5V3m9 0v5h5M8 12h8M8 16h6" /></> : kind === "user" ? <><circle cx="12" cy="8" r="4" /><path d="M5 21v-2a7 7 0 0 1 14 0v2" /></> : <><circle cx="12" cy="12" r="9" /><path d="M8 14c1 4 7 4 8 0M8 8v1m8-1v1" /></>}</svg>;
}

export function HermesMemoryContent({ onDirtyChange }: { onDirtyChange: (dirty: boolean) => void }) {
  const { ht } = useHermesI18n();
  const [profiles, setProfiles] = useState<MemoryProfile[]>([]);
  const [profileName, setProfileName] = useState("");
  const [cards, setCards] = useState<Record<MemoryDocumentKind, Card>>({ memory: fresh(), user: fresh(), soul: fresh() });
  const [error, setError] = useState("");
  const [revision, setRevision] = useState(0);
  const [profileRevision, setProfileRevision] = useState(0);
  const copy = useEffectEvent((source: string) => ht(source));
  const profile = profiles.find(item => item.name === profileName);
  const dirty = kinds.some(kind => cards[kind].draft !== cards[kind].content);
  const saving = kinds.some(kind => cards[kind].saving);
  const loading = !profile || kinds.some(kind => cards[kind].loading);
  useEffect(() => { onDirtyChange(dirty || saving); }, [dirty, saving, onDirtyChange]);
  useEffect(() => {
    if (!dirty) return;
    const warn = (event: BeforeUnloadEvent) => event.preventDefault();
    window.addEventListener("beforeunload", warn);
    return () => window.removeEventListener("beforeunload", warn);
  }, [dirty]);
  useEffect(() => {
    const controller = new AbortController();
    setError("");
    Promise.all([
      hermesJson<{ profiles: MemoryProfile[] }>("/api/profiles", { signal: controller.signal }),
      hermesJson<{ current?: string; active?: string }>("/api/profiles/active", { signal: controller.signal }),
    ]).then(([list, current]) => {
      if (controller.signal.aborted) return;
      const available = list.profiles.filter(item => item.path && item.name);
      const initial = available.find(item => item.name === current.current) ?? available.find(item => item.is_default) ?? available[0];
      if (!initial) { setError(copy("没有可用的记忆档案。")); return; }
      setProfiles(available); setProfileName(initial.name);
    }).catch(e => { if (!controller.signal.aborted) setError(e.message); });
    return () => controller.abort();
  }, [profileRevision]);
  useEffect(() => {
    if (!profile) return;
    const controller = new AbortController();
    setCards({ memory: fresh(), user: fresh(), soul: fresh() });
    for (const kind of kinds) void readMemoryDocument(profile, kind, controller.signal).then(document => {
      if (!controller.signal.aborted) setCards(previous => ({ ...previous, [kind]: { ...fresh(), ...document, draft: document.content, loading: false } }));
    }).catch(e => { if (!controller.signal.aborted) setCards(previous => ({ ...previous, [kind]: { ...fresh(), loading: false, error: e.message } })); });
    return () => controller.abort();
  }, [profile, revision]);
  function change(kind: MemoryDocumentKind, patch: Partial<Card>) { setCards(previous => ({ ...previous, [kind]: { ...previous[kind], ...patch } })); }
  async function save(kind: MemoryDocumentKind) {
    if (!profile || cards[kind].saving) return;
    const card = cards[kind]; change(kind, { saving: true, error: "", notice: "" });
    try {
      await saveMemoryDocument(profile, kind, card, card.draft);
      change(kind, { content: card.draft, exists: true, editing: false, preview: false, notice: ht("已保存") });
    } catch (e) { change(kind, { error: e instanceof Error ? e.message : String(e) }); }
    finally { change(kind, { saving: false }); }
  }
  return <div className="hermes-memory-page"><div className="hermes-memory-toolbar"><p>{ht("查看和编辑助手记住的内容，以及它的行为与性格。")}</p><ConfigButton disabled={dirty || saving || (loading && !error)} onClick={() => error ? setProfileRevision(value => value + 1) : setRevision(value => value + 1)}>{ht("刷新")}</ConfigButton></div>{error && <div role="alert"><ConfigNotice>{error}</ConfigNotice></div>}<div className="hermes-memory-grid">{kinds.map(kind => {
    const card = cards[kind]; const label = ht(titles[kind]);
    return <section className="hermes-memory-card" key={kind} aria-label={label}><header><span className="hermes-memory-icon" aria-hidden="true"><MemoryIcon kind={kind} /></span><h3>{label}</h3><ConfigButton size="small" variant="ghost" disabled={card.loading || card.saving || (Boolean(card.error) && !card.editing)} onClick={() => change(kind, card.editing ? { preview: !card.preview } : { editing: true, preview: false, notice: "" })}>{card.editing ? card.preview ? ht("继续编辑") : ht("预览") : ht("编辑")}</ConfigButton></header><div className="hermes-memory-card-body">{card.loading ? <p className="hermes-muted">{ht("正在读取记忆…")}</p> : card.editing && !card.preview ? <textarea aria-label={ht("编辑{name}", { name: label })} value={card.draft} disabled={card.saving} onChange={event => change(kind, { draft: event.target.value, notice: "" })} spellCheck={false} /> : (card.editing ? card.draft : card.content) ? <MarkdownBody keepLineBreaks>{card.editing ? card.draft : card.content}</MarkdownBody> : !card.error ? <p className="hermes-muted">{ht("还没有内容，可以点击编辑来添加。")}</p> : null}</div>{card.error && <div role="alert" className="hermes-memory-card-notice">{ht(card.error)}</div>}{card.notice && <div role="status" className="hermes-memory-card-notice">{card.notice}</div>}{card.editing && <footer><span>{card.draft !== card.content ? ht("有未保存的修改") : ""}</span><ConfigButton disabled={card.saving} onClick={() => change(kind, { draft: card.content, editing: false, preview: false, error: "" })}>{ht("取消")}</ConfigButton><ConfigButton variant="primary" disabled={card.saving || card.draft === card.content} onClick={() => void save(kind)}>{card.saving ? ht("保存中…") : ht("保存")}</ConfigButton></footer>}</section>;
  })}</div></div>;
}
