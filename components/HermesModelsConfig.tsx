"use client";

import { useEffect, useState } from "react";
import { hermesJson } from "@/lib/hermes-client";
import { useHermesI18n } from "@/hooks/useHermesI18n";
import { HermesProviderPicker, type ProviderChoice } from "./HermesProviderPicker";
import { HermesBuiltinProviderConfig } from "./HermesBuiltinProviderConfig";
import { ConfigButton, ConfigDetail, ConfigDetailHeader, ConfigDetailHeaderInfo, ConfigDetailTitle, ConfigEmptyState, ConfigField, ConfigFooter, ConfigNotice, ConfigSidebar, ConfigSidebarItem, ConfigSidebarList, ConfigSplitView, ConfigSwitch } from "./SettingsUi";

type Endpoint = { id: string; name: string; base_url: string; model: string; models?: string[]; api_mode?: string; context_length?: number | null; discover_models?: boolean; is_current?: boolean; has_api_key?: boolean; model_details?: { id: string; canonical_model?: string; reasoning_effort?: string }[] };
type Draft = { id: string; name: string; base_url: string; model: string; api_key: string; api_mode: string; context_length: string; models: string[]; discover_models: boolean; make_default: boolean; model_details?: Endpoint["model_details"] };
const empty: Draft = { id: "", name: "", base_url: "", model: "", api_key: "", api_mode: "", context_length: "", models: [], discover_models: true, make_default: false };
const endpointPath = (id: string) => `/api/providers/custom-endpoints/${encodeURIComponent(id)}`;

export function HermesModelsConfig({ models, model, onModelChange, modelBusy, onDirtyChange }: { models: string[]; model: string; onModelChange: (model: string) => void; modelBusy: boolean; onDirtyChange: (dirty: boolean) => void }) {
  const { ht } = useHermesI18n();
  const [endpoints, setEndpoints] = useState<Endpoint[]>([]);
  const [selected, setSelected] = useState("current");
  const [draft, setDraft] = useState<Draft>(empty);
  const [baseline, setBaseline] = useState(JSON.stringify(empty));
  const [loading, setLoading] = useState(true); const [busy, setBusy] = useState(false);
  const [error, setError] = useState(""); const [notice, setNotice] = useState("");
  const [confirmDelete, setConfirmDelete] = useState(false);
  const [picker, setPicker] = useState(false);
  const [builtin, setBuiltin] = useState<ProviderChoice | null>(null);
  const [builtinDirty, setBuiltinDirty] = useState(false);
  const [revision, setRevision] = useState(0);
  const dirty = selected !== "current" && JSON.stringify(draft) !== baseline;
  useEffect(() => { onDirtyChange(dirty || busy || builtinDirty); }, [dirty, busy, builtinDirty, onDirtyChange]);
  useEffect(() => {
    const controller = new AbortController(); setLoading(true);
    hermesJson<{ endpoints: Endpoint[] }>("/api/providers/custom-endpoints", { signal: controller.signal }).then(data => { if (!controller.signal.aborted) setEndpoints(data.endpoints ?? []); }).catch(e => { if (!controller.signal.aborted) setError(e.message); }).finally(() => { if (!controller.signal.aborted) setLoading(false); });
    return () => controller.abort();
  }, [revision]);
  function choose(id: string, choice?: ProviderChoice) {
    if (busy || ((dirty || builtinDirty) && !window.confirm(ht("放弃未保存的修改？")))) return false;
    const item = endpoints.find(endpoint => endpoint.id === id);
    const next: Draft = item ? { ...empty, id: item.id, name: item.name, base_url: item.base_url, model: item.model, api_mode: item.api_mode ?? "", context_length: item.context_length == null ? "" : String(item.context_length), models: item.models ?? [], discover_models: item.discover_models !== false, model_details: item.model_details } : { ...empty };
    setBuiltin(choice ?? null); setBuiltinDirty(false); setSelected(id); setDraft(next); setBaseline(JSON.stringify(next)); setError(""); setNotice(""); setConfirmDelete(false); return true;
  }
  function change<K extends keyof Draft>(key: K, value: Draft[K]) { setDraft(previous => ({ ...previous, [key]: value })); setNotice(""); }
  function payload() {
    return { ...draft, api_key: draft.api_key.trim() || undefined, context_length: draft.context_length ? Number(draft.context_length) : null, models: [...new Set([...draft.models, draft.model].filter(Boolean))] };
  }
  async function run(action: () => Promise<void>) {
    setBusy(true); setError(""); setNotice("");
    try { await action(); } catch (e) { setError(e instanceof Error ? e.message : String(e)); } finally { setBusy(false); }
  }
  const ready = draft.name.trim() && /^https?:\/\//.test(draft.base_url) && draft.model.trim() && (!draft.context_length || (Number.isInteger(Number(draft.context_length)) && Number(draft.context_length) > 0));
  const currentEndpoint = endpoints.find(endpoint => endpoint.id === selected);
  return <div className="hermes-models-config">{error && <div role="alert"><ConfigNotice>{error}</ConfigNotice></div>}{notice && <div role="status"><ConfigNotice>{notice}</ConfigNotice></div>}<ConfigSplitView><ConfigSidebar><ConfigSidebarList><ConfigSidebarItem active={selected === "current"} onClick={() => choose("current")}>{ht("当前模型")}</ConfigSidebarItem>{endpoints.map(endpoint => <ConfigSidebarItem key={endpoint.id} active={selected === endpoint.id} onClick={() => choose(endpoint.id)}><span>{endpoint.name}</span>{endpoint.is_current && <small>{ht("默认")}</small>}</ConfigSidebarItem>)}{builtin && <ConfigSidebarItem active={true}>{builtin.provider.name}</ConfigSidebarItem>}</ConfigSidebarList><ConfigButton disabled={busy || loading} onClick={() => setPicker(true)}>{ht("＋ 添加提供商")}</ConfigButton></ConfigSidebar><ConfigDetail>{builtin ? <HermesBuiltinProviderConfig key={builtin.oauth?.id ?? builtin.provider.slug} choice={builtin} modelBusy={modelBusy} onDirtyChange={setBuiltinDirty} onModelChange={onModelChange}/> : selected === "current" ? <div className="hermes-form"><ConfigDetailTitle>{ht("当前模型")}</ConfigDetailTitle><label className="hermes-preference-row"><div><strong>{ht("对话模型")}</strong><p>{ht("用于这次对话的 Hermes 模型。")}</p></div><select aria-label={ht("当前模型")} value={model} disabled={modelBusy} onChange={event => onModelChange(event.target.value)}>{[...new Set([model, ...models, ...endpoints.flatMap(endpoint => endpoint.models ?? [endpoint.model])])].filter(Boolean).map(id => <option key={id} value={id}>{id}</option>)}</select></label>{modelBusy && <ConfigNotice>{ht("对话运行时暂不能切换模型。")}</ConfigNotice>}{!endpoints.length && !loading && <ConfigEmptyState>{ht("添加提供商，连接自定义接口并选择模型。")}</ConfigEmptyState>}</div> : <div className="hermes-form"><ConfigDetailHeader><ConfigDetailHeaderInfo><ConfigDetailTitle>{selected === "new" ? ht("添加提供商") : draft.name}</ConfigDetailTitle></ConfigDetailHeaderInfo>{selected !== "new" && <ConfigButton variant="danger" disabled={busy} onClick={() => setConfirmDelete(true)}>{ht("删除")}</ConfigButton>}</ConfigDetailHeader>
      <ConfigField label={ht("提供商名称")}><input aria-label={ht("提供商名称")} disabled={busy} value={draft.name} placeholder={ht("OpenAI / Ollama / 自定义服务")} onChange={event => change("name", event.target.value)} /></ConfigField>
      <ConfigField label={ht("接口地址")}><input aria-label={ht("接口地址")} type="url" disabled={busy} value={draft.base_url} placeholder="https://api.example.com/v1" onChange={event => change("base_url", event.target.value)} /></ConfigField>
      <ConfigField label={ht("接口协议")}><select aria-label={ht("接口协议")} disabled={busy} value={draft.api_mode} onChange={event => change("api_mode", event.target.value)}><option value="">{ht("自动检测")}</option><option value="chat_completions">OpenAI Chat Completions</option><option value="codex_responses">OpenAI Responses</option><option value="anthropic_messages">Anthropic Messages</option></select></ConfigField>
      <ConfigField label={ht("接口密钥")}><input aria-label={ht("提供商接口密钥")} type="password" autoComplete="new-password" disabled={busy} value={draft.api_key} placeholder={draft.id ? ht("留空保留已保存的密钥") : ht("本地服务可留空")} onChange={event => change("api_key", event.target.value)} /></ConfigField>
      <ConfigField label={ht("模型")}><div className="hermes-model-discovery"><input aria-label={ht("模型 ID")} list="hermes-provider-models" disabled={busy} value={draft.model} placeholder="gpt-… / claude-…" onChange={event => change("model", event.target.value)} /><datalist id="hermes-provider-models">{draft.models.map(id => <option key={id} value={id} />)}</datalist><ConfigButton disabled={busy || !draft.base_url.trim()} onClick={() => void run(async () => {
        const result = await hermesJson<{ ok: boolean; reachable: boolean; models?: string[]; resolved_base_url?: string; model_details?: Endpoint["model_details"] }>("/api/providers/custom-endpoints/validate", { method: "POST", body: JSON.stringify(payload()) });
        if (!result.ok) { setError(result.reachable ? ht("接口未返回可用模型，请检查密钥、地址和协议；也可以手动填写模型 ID。") : ht("无法连接该接口，请检查地址和网络。")); return; }
        setDraft(previous => ({ ...previous, models: result.models ?? [], model_details: result.model_details, base_url: result.resolved_base_url ?? previous.base_url, model: previous.model || result.models?.[0] || "" })); setNotice(ht("模型列表已获取"));
      })}>{busy ? ht("获取中…") : ht("获取模型")}</ConfigButton></div></ConfigField>
      {draft.models.length > 0 && <ConfigField label={ht("可用模型")}><select aria-label={ht("选择模型")} disabled={busy} value={draft.model} onChange={event => change("model", event.target.value)}>{!draft.models.includes(draft.model) && <option value={draft.model}>{draft.model || ht("请选择")}</option>}{draft.models.map(id => <option key={id} value={id}>{id}</option>)}</select></ConfigField>}
      <ConfigField label={ht("上下文窗口")}><input aria-label={ht("上下文窗口")} type="number" min={1} step={1} disabled={busy} value={draft.context_length} placeholder={ht("留空使用模型检测值")} onChange={event => change("context_length", event.target.value)} /></ConfigField>
      <div className="hermes-preference-row"><div><strong>{ht("自动发现模型")}</strong><p>{ht("自动读取这个接口提供的模型列表。")}</p></div><ConfigSwitch label={ht("自动发现模型")} checked={draft.discover_models} disabled={busy} onChange={value => change("discover_models", value)} /></div>
      <div className="hermes-preference-row"><div><strong>{ht("保存后设为默认提供商")}</strong><p>{ht("保存时将此提供商和模型用于之后的新对话。")}</p></div><ConfigSwitch label={ht("保存后设为默认提供商")} checked={draft.make_default} disabled={busy || modelBusy} onChange={value => change("make_default", value)} /></div>
      {confirmDelete && <ConfigNotice><p>{ht("确认删除这个提供商？")}</p><ConfigButton disabled={busy} onClick={() => setConfirmDelete(false)}>{ht("取消")}</ConfigButton><ConfigButton variant="danger" disabled={busy} onClick={() => void run(async () => { await hermesJson(endpointPath(draft.id), { method: "DELETE" }); setSelected("current"); setDraft(empty); setBaseline(JSON.stringify(empty)); setRevision(value => value + 1); setNotice(ht("提供商已删除")); })}>{ht("确认删除")}</ConfigButton></ConfigNotice>}
      <ConfigFooter status={dirty ? ht("有未保存的修改") : currentEndpoint?.is_current ? ht("默认提供商") : ""}>{selected !== "new" && <ConfigButton disabled={busy || dirty || modelBusy || currentEndpoint?.is_current} onClick={() => void run(async () => { await hermesJson(`${endpointPath(draft.id)}/activate`, { method: "POST", body: "{}" }); onModelChange(draft.model); setRevision(value => value + 1); setNotice(ht("默认提供商已切换")); })}>{ht("设为默认")}</ConfigButton>}<ConfigButton variant="primary" disabled={busy || !ready || (modelBusy && draft.make_default) || (!dirty && selected !== "new")} onClick={() => void run(async () => { const result = await hermesJson<{ id: string }>("/api/providers/custom-endpoints", { method: "POST", body: JSON.stringify(payload()) }); const saved = { ...draft, id: result.id, api_key: "", make_default: false }; setDraft(saved); setBaseline(JSON.stringify(saved)); setSelected(result.id); setRevision(value => value + 1); if (draft.make_default) onModelChange(draft.model); setNotice(ht("提供商已保存")); })}>{busy ? ht("保存中…") : ht("保存提供商")}</ConfigButton></ConfigFooter>
    </div>}</ConfigDetail></ConfigSplitView>{picker && <HermesProviderPicker onClose={() => setPicker(false)} onCustom={() => {if (choose("new")) setPicker(false);}} onChoose={choice => {if (choose("builtin", choice)) setPicker(false);}}/>}</div>;
}
