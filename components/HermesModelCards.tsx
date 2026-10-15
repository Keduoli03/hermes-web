"use client";

import { useState } from "react";
import { Check, Pencil, Plus, RefreshCw, Search, Star } from "lucide-react";
import { useHermesI18n } from "@/hooks/useHermesI18n";
import { ConfigButton, ConfigEmptyState } from "./SettingsUi";
import { ModelSelector } from "./ModelSelector";
import { ProviderIcon } from "./ProviderIcon";

export type HermesModelCard = { id: string; name: string; models: string[]; baseUrl?: string; custom: boolean; defaultModel?: string; isDefault?: boolean; connected?: boolean };

export function HermesModelCards({ cards, model, provider, busy, modelBusy, loading, onSwitch, onDefault, onEdit, onRefresh, onAdd }: {
  cards: HermesModelCard[]; model: string; provider?: string; busy: boolean; modelBusy: boolean; loading: boolean;
  onSwitch: (model: string, provider: string) => void;
  onDefault: (card: HermesModelCard, model: string) => void;
  onEdit: (card: HermesModelCard) => void;
  onRefresh: (card?: HermesModelCard) => void;
  onAdd: () => void;
}) {
  const { ht } = useHermesI18n();
  const [query, setQuery] = useState("");
  const [selection, setSelection] = useState<Record<string, string>>({});
  const normalized = query.trim().toLowerCase();
  const visible = cards.filter(card => `${card.name} ${card.id} ${card.models.join(" ")}`.toLowerCase().includes(normalized));
  const ownsModel = (card: HermesModelCard) => provider ? card.id.replace(/^custom:/, "").toLowerCase() === provider.replace(/^custom:/, "").toLowerCase() : cards.filter(row => row.models.includes(model)).length === 1 && card.models.includes(model);
  function switchModel(card: HermesModelCard, id: string) { setSelection(previous => ({ ...previous, [card.id]: id })); onSwitch(id, card.id); }
  return <div className="hermes-model-overview">
    <div className="hermes-model-cards-toolbar"><label className="hermes-model-card-search"><Search size={16} aria-hidden="true"/><input aria-label={ht("搜索提供商或模型")} placeholder={ht("搜索提供商或模型…")} value={query} onChange={event => setQuery(event.target.value)}/></label><ConfigButton disabled={busy || loading} onClick={() => onRefresh()}><RefreshCw size={14} aria-hidden="true"/>{ht("刷新模型")}</ConfigButton><ConfigButton aria-label={ht("＋ 添加提供商")} variant="primary" disabled={busy || loading} onClick={onAdd}><Plus size={15} aria-hidden="true"/>{ht("添加提供商")}</ConfigButton></div>
    <div className="hermes-model-overview-scroll"><div className="hermes-model-current"><span>{ht("当前对话")}</span><strong title={model}>{model}</strong>{modelBusy && <span>{ht("对话运行时暂不能切换模型。")}</span>}</div>
      {loading && !cards.length ? <p className="hermes-muted" role="status">{ht("正在读取提供商目录…")}</p> : <div className="hermes-model-card-grid">{visible.map(card => {
        const active = ownsModel(card) && card.models.includes(model);
        const chosen = active ? model : selection[card.id] || card.defaultModel || card.models[0] || "";
        return <section key={card.id} className="hermes-model-card" aria-label={card.name}>
          <header><ProviderIcon id={card.custom ? "custom" : card.id === "openai-api" ? "openai" : card.id} size={24}/><h3>{card.name}</h3><div className="hermes-model-card-badges">{active && <span className="is-current"><Check size={12} aria-hidden="true"/>{ht("当前对话")}</span>}{card.isDefault && <span>{ht("默认")}</span>}<span>{ht(card.custom ? "自定义" : "内置")}</span></div></header>
          <dl><div><dt>{ht("提供商")}</dt><dd title={card.id}>{card.id}</dd></div>{card.baseUrl && <div><dt>{ht("接口地址")}</dt><dd title={card.baseUrl}>{card.baseUrl}</dd></div>}<div><dt>{ht("模型列表")}</dt><dd>{ht("{count} 个模型", { count: card.models.length })}</dd></div></dl>
          <div className="hermes-model-card-select"><span>{ht("对话模型")}</span><ModelSelector variant="field" placement="auto" maxMenuHeight={320} isAutoSelection={!active} ariaLabel={ht("{name} 的模型", { name: card.name })} emptyLabel={ht("暂无可用模型")} selectedLabel={chosen || ht("请选择")} value={chosen ? { provider: card.id, modelId: chosen } : null} options={card.models.map(id => ({ provider: card.id, modelId: id, name: id }))} disabled={busy || modelBusy || !card.models.length || card.connected === false} onChange={(_, id) => switchModel(card, id)}/></div>
          <div className="hermes-model-card-models" aria-label={ht("{name} 的模型列表", { name: card.name })}>{card.models.map(id => <button key={id} type="button" title={id} aria-pressed={active && model === id} disabled={busy || modelBusy || card.connected === false} onClick={() => switchModel(card, id)}>{id}</button>)}{!card.models.length && <p>{ht("连接后获取模型，或在编辑中填写模型 ID。")}</p>}</div>
          <footer><ConfigButton variant="ghost" size="small" disabled={busy || modelBusy || !chosen || card.connected === false || (card.isDefault && card.defaultModel === chosen)} onClick={() => onDefault(card, chosen)}><Star size={14} aria-hidden="true"/>{ht(card.isDefault && card.defaultModel === chosen ? "当前默认" : "设为默认")}</ConfigButton><div><button type="button" disabled={busy} title={ht("刷新模型")} aria-label={ht("刷新 {name} 的模型", { name: card.name })} onClick={() => onRefresh(card)}><RefreshCw size={15}/></button><button type="button" disabled={busy} title={ht("编辑提供商")} aria-label={ht("编辑 {name}", { name: card.name })} onClick={() => onEdit(card)}><Pencil size={15}/></button></div></footer>
        </section>;
      })}</div>}
      {!loading && !visible.length && <ConfigEmptyState>{ht(cards.length ? "没有匹配的提供商" : "添加提供商，连接自定义接口并选择模型。")}</ConfigEmptyState>}
    </div>
  </div>;
}
