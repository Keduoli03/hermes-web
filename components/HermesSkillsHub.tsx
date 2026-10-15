"use client";

import { useEffect, useRef, useState } from "react";
import { ArrowLeft, ArrowUpRight, BookOpen, Check, ChevronDown, Code2, Compass, Link2, RefreshCw, Search, Sparkles, Terminal, Wrench } from "lucide-react";
import { useHermesI18n } from "@/hooks/useHermesI18n";
import { useHermesOperation, useHermesResource } from "@/hooks/useHermesResource";
import { hermesJson } from "@/lib/hermes-client";
import { scoped, waitHermesAction } from "@/lib/hermes-advanced";
import { MarkdownBody } from "./MarkdownBody";
import { ConfigButton, ConfigEmptyState, ConfigNotice } from "./SettingsUi";
import { HermesResourceState } from "./HermesResourceState";
import { skillCategory } from "./HermesSkillList";

type HubSkill = { identifier: string; name: string; description?: string; category?: string; source?: string; installed?: boolean; trust_level?: string };
type HubSources = { sources: { id: string; label: string }[]; installed: Record<string, { name: string }> };
type HubPreview = { skill_md: string; name: string; description: string; trust_level: string };
type HubScan = { policy?: string; allowed?: boolean; verdict?: string; summary?: string };

function SkillIcon({ category }: { category?: string }) {
  const Icon = category === "devops" ? Terminal : category === "research" ? Compass : category === "creative" ? Sparkles : /development/.test(category ?? "") ? Code2 : category === "productivity" ? Wrench : BookOpen;
  return <span className="hermes-hub-skill-icon" data-category={category}><Icon size={21} strokeWidth={1.7} aria-hidden="true"/></span>;
}

export function HermesSkillsHub({ profile, onDirtyChange }: { profile: string; onDirtyChange: (dirty: boolean) => void }) {
  const { ht } = useHermesI18n();
  const op = useHermesOperation();
  const [revision, setRevision] = useState(0);
  const [query, setQuery] = useState("");
  const [source, setSource] = useState("all");
  const [filter, setFilter] = useState("all");
  const [results, setResults] = useState<HubSkill[] | null>(null);
  const [selected, setSelected] = useState("");
  const [manual, setManual] = useState("");
  const [scan, setScan] = useState<HubScan | null>(null);
  const cardFocus = useRef<HTMLButtonElement | null>(null);
  const backRef = useRef<HTMLButtonElement | null>(null);
  const catalog = useHermesResource<{ skills: HubSkill[] }>(scoped("/api/skills/hub/official", profile), revision);
  const sources = useHermesResource<HubSources>(scoped("/api/skills/hub/sources", profile), revision);
  const preview = useHermesResource<HubPreview>(selected ? scoped("/api/skills/hub/preview", profile, { identifier: selected }) : null);
  useEffect(() => { onDirtyChange(op.busy); }, [op.busy, onDirtyChange]);
  useEffect(() => { if (selected) backRef.current?.focus(); }, [selected]);

  const list = results ?? catalog.data?.skills ?? [];
  const item = list.find(row => row.identifier === selected);
  const isInstalled = (row: HubSkill) => Boolean(row.installed || sources.data?.installed[row.identifier]);
  const installed = Boolean(item?.installed || sources.data?.installed[selected]);
  const visible = list.filter(row => filter === "all" || (filter === "installed" ? isInstalled(row) : !isInstalled(row)));
  const blocked = scan?.policy === "block" || scan?.allowed === false;

  function sourceName(row: HubSkill) {
    const id = row.source || row.identifier.split("/")[0];
    if (id === "official") return ht("官方技能");
    if (id === "hermes-index") return ht("社区索引");
    if (id === "github") return "GitHub";
    return sources.data?.sources.find(entry => entry.id === id)?.label || id;
  }
  function choose(identifier: string, button?: HTMLButtonElement) {
    if (op.busy) return;
    cardFocus.current = button ?? null;
    setSelected(identifier); setScan(null); op.setError(""); op.setNotice("");
  }
  function back() {
    if (op.busy) return;
    const identifier = selected;
    setSelected("");
    requestAnimationFrame(() => {
      const card = Array.from(document.querySelectorAll<HTMLButtonElement>(".hermes-hub-card")).find(button => button.dataset.identifier === identifier);
      (card ?? cardFocus.current)?.focus();
    });
  }
  async function search() {
    if (!query.trim()) return;
    await op.run(async signal => {
      const data = await hermesJson<{ results: HubSkill[]; timed_out: string[] }>(scoped("/api/skills/hub/search", profile, { q: query.trim(), source }), { signal });
      setResults(data.results); setSelected(""); setFilter("all");
      if (data.timed_out?.length) op.setNotice(ht("部分来源搜索超时，可稍后重试。"));
    });
  }
  async function action(kind: "install" | "uninstall" | "update") {
    if (kind === "uninstall" && !window.confirm(ht("卸载这个技能？"))) return;
    await op.run(async signal => {
      const result = await hermesJson<{ name: string; pid: number }>(scoped(`/api/skills/hub/${kind}`, profile), {
        method: "POST", signal, body: JSON.stringify(kind === "install" ? { identifier: selected } : kind === "uninstall" ? { name: sources.data?.installed[selected]?.name || item?.name || preview.data?.name } : {}),
      });
      op.setNotice(ht("任务已启动，正在等待结果…"));
      await waitHermesAction(result, signal);
      setRevision(value => value + 1); setResults(null); op.setNotice(ht("技能操作已完成"));
    });
  }

  return <div className="hermes-module-content hermes-skills-hub">
    <div className="hermes-hub-controls"><form className="hermes-hub-toolbar" onSubmit={event => { event.preventDefault(); void search(); }}>
      <label className="hermes-hub-search"><Search size={16} aria-hidden="true"/><input aria-label={ht("搜索技能市场")} placeholder={ht("搜索技能名称或用途…")} value={query} disabled={op.busy} onChange={event => setQuery(event.target.value)}/></label>
      <span className="hermes-hub-source"><select aria-label={ht("技能来源")} value={source} disabled={op.busy} onChange={event => setSource(event.target.value)}><option value="all">{ht("全部来源")}</option>{sources.data?.sources.map(row => <option key={row.id} value={row.id}>{sourceName({ source: row.id, identifier: row.id, name: row.label })}</option>)}</select><ChevronDown size={14} aria-hidden="true"/></span>
      <ConfigButton type="submit" disabled={op.busy || !query.trim()}>{ht("搜索")}</ConfigButton>
      <div className="hermes-hub-toolbar-actions"><ConfigButton disabled={op.busy} onClick={() => { setResults(null); setSelected(""); setQuery(""); setFilter("all"); setRevision(value => value + 1); }}>{ht("官方技能")}</ConfigButton>
        <button type="button" className="hermes-hub-icon-button" aria-label={ht("更新已安装技能")} title={ht("更新已安装技能")} disabled={op.busy} onClick={() => void action("update")}><RefreshCw size={16}/></button></div>
    </form>
    <details className="hermes-hub-link" onToggle={event => { if (event.currentTarget.open) event.currentTarget.querySelector("input")?.focus(); }}><summary><Link2 size={14} aria-hidden="true"/>{ht("从链接添加")}</summary><div><input aria-label={ht("技能链接或标识")} placeholder={ht("技能链接或标识")} value={manual} disabled={op.busy} onChange={event => setManual(event.target.value)}/><ConfigButton disabled={op.busy || !manual.trim()} onClick={() => choose(manual.trim())}>{ht("查看技能")}</ConfigButton></div></details></div>
    {op.error && <div role="alert"><ConfigNotice>{op.error}</ConfigNotice></div>}
    {op.notice && <div role="status"><ConfigNotice>{op.notice}</ConfigNotice></div>}
    {selected ? <div className="hermes-hub-detail">
      <div className="hermes-hub-detail-scroll"><div className="hermes-hub-detail-body">
        <button ref={backRef} type="button" className="hermes-hub-back" disabled={op.busy} onClick={back}><ArrowLeft size={16} aria-hidden="true"/>{ht("返回技能市场")}</button>
        <header className="hermes-hub-detail-heading"><SkillIcon category={item?.category}/><h2>{preview.data?.name || item?.name || selected}</h2>{installed && <span className="hermes-hub-installed"><Check size={13}/>{ht("已安装")}</span>}</header>
        {(preview.data?.description || item?.description) && <p className="hermes-hub-description">{preview.data?.description || item?.description}</p>}
        {item && <div className="hermes-hub-detail-meta"><span>{sourceName(item)}</span>{item.category && <span>{ht(skillCategory(item.category))}</span>}</div>}
        {scan && <div role="status"><ConfigNotice>{blocked ? ht("检查未通过，无法安装。") : ht("检查结果已返回，请确认技能内容后安装。")}{scan.summary}</ConfigNotice></div>}
        {preview.error ? <div role="alert"><ConfigNotice>{preview.error}</ConfigNotice></div> : preview.loading ? <p className="hermes-muted" role="status">{ht("正在读取技能…")}</p> : <div className="hermes-hub-document"><MarkdownBody>{preview.data?.skill_md || ht("没有技能说明")}</MarkdownBody></div>}
      </div></div>
      <footer className="hermes-hub-detail-footer"><ConfigButton disabled={op.busy || preview.loading || Boolean(preview.error)} onClick={() => void op.run(async signal => { setScan(await hermesJson(scoped("/api/skills/hub/scan", profile, { identifier: selected }), { signal })); })}>{ht("检查技能")}</ConfigButton>
        <div>{installed && <ConfigButton variant="danger" disabled={op.busy} onClick={() => void action("uninstall")} >{ht("卸载技能")}</ConfigButton>}<ConfigButton disabled={op.busy || preview.loading || Boolean(preview.error) || installed || blocked} variant="primary" onClick={() => void action("install")}>{installed ? ht("已安装") : ht("安装技能")}</ConfigButton></div>
      </footer>
    </div> : results === null && !catalog.data && (catalog.loading || catalog.error) ? <HermesResourceState loading={catalog.loading} error={catalog.error} onRetry={() => setRevision(value => value + 1)}/> : <div className="hermes-hub-browse">
      <div className="hermes-hub-grid-heading"><div><h2>{ht(results === null ? "官方技能" : "搜索结果")}</h2><span>{ht("{count} 个技能", { count: visible.length })}</span></div><div className="hermes-hub-filters" role="group" aria-label={ht("技能安装状态")}>{[["all", "全部"], ["installed", "已安装"], ["available", "未安装"]].map(([id, label]) => <button type="button" key={id} aria-pressed={filter === id} disabled={op.busy} onClick={() => setFilter(id)}>{ht(label)}</button>)}</div></div>
      {visible.length ? <div className="hermes-hub-grid">{visible.map(row => <button type="button" className="hermes-hub-card" key={row.identifier} data-identifier={row.identifier} aria-label={row.name} disabled={op.busy} onClick={event => choose(row.identifier, event.currentTarget)}>
        <div className="hermes-hub-card-heading"><SkillIcon category={row.category}/>{isInstalled(row) && <span className="hermes-hub-installed"><Check size={13}/>{ht("已安装")}</span>}</div>
        <h3>{row.name}</h3><p>{row.description || ht("暂无技能简介")}</p>
        <div className="hermes-hub-card-footer"><span>{sourceName(row)}{row.category && <><span aria-hidden="true"> · </span>{ht(skillCategory(row.category))}</>}</span><ArrowUpRight size={16} aria-hidden="true"/></div>
      </button>)}</div> : <ConfigEmptyState>{ht("没有匹配的技能")}</ConfigEmptyState>}
    </div>}
  </div>;
}
