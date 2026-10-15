"use client";

import { useEffect, useState } from "react";
import { ArrowLeft, ChevronDown, CircleAlert, CircleCheck, Plus } from "lucide-react";
import { hermesJson } from "@/lib/hermes-client";
import { useHermesI18n } from "@/hooks/useHermesI18n";
import { HermesProviderPicker, type HermesProvider, type HermesOAuthProvider, type ProviderChoice } from "./HermesProviderPicker";
import { HermesBuiltinProviderConfig } from "./HermesBuiltinProviderConfig";
import { HermesModelCards, type HermesModelCard } from "./HermesModelCards";
import { ConfigButton, ConfigDetail, ConfigDetailHeader, ConfigDetailHeaderInfo, ConfigDetailTitle, ConfigField, ConfigFooter, ConfigNotice, ConfigSplitView, ConfigSwitch } from "./SettingsUi";

type Endpoint = { id: string; name: string; base_url: string; model: string; models?: string[]; api_mode?: string; context_length?: number | null; discover_models?: boolean; is_current?: boolean; has_api_key?: boolean; model_details?: { id: string; canonical_model?: string; reasoning_effort?: string }[] };
type Draft = { id: string; name: string; base_url: string; model: string; api_key: string; api_mode: string; context_length: string; models: string[]; discover_models: boolean; make_default: boolean; model_details?: Endpoint["model_details"] };
const empty: Draft = { id: "", name: "", base_url: "", model: "", api_key: "", api_mode: "", context_length: "", models: [], discover_models: true, make_default: false };
const endpointPath = (id: string) => `/api/providers/custom-endpoints/${encodeURIComponent(id)}`;

export function HermesModelsConfig({ model, modelProvider, onModelChange, modelBusy, onDirtyChange }: { models: string[]; model: string; modelProvider?: string; onModelChange: (model: string, provider?: string) => void; modelBusy: boolean; onDirtyChange: (dirty: boolean) => void }) {
  const { ht } = useHermesI18n();
  const [endpoints, setEndpoints] = useState<Endpoint[]>([]);
  const [providers, setProviders] = useState<(HermesProvider & { api_url?: string; is_current?: boolean })[]>([]);
  const [oauth, setOAuth] = useState<HermesOAuthProvider[]>([]);
  const [defaultModel, setDefaultModel] = useState({ model: "", provider: "" });
  const [selected, setSelected] = useState("current");
  const [draft, setDraft] = useState<Draft>(empty);
  const [baseline, setBaseline] = useState(JSON.stringify(empty));
  const [loading, setLoading] = useState(true); const [busy, setBusy] = useState(false);
  const [error, setError] = useState(""); const [notice, setNotice] = useState("");
  const [discoveryError, setDiscoveryError] = useState("");
  const [discoveryNotice, setDiscoveryNotice] = useState("");
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
  useEffect(() => {
    const controller = new AbortController();
    Promise.allSettled([
      hermesJson<{ providers: typeof providers; model?: string; provider?: string }>("/api/model/options", { signal: controller.signal }),
      hermesJson<{ providers: HermesOAuthProvider[] }>("/api/providers/oauth", { signal: controller.signal }),
    ]).then(([catalog, auth]) => {
      if (controller.signal.aborted) return;
      if (catalog.status === "fulfilled") { setProviders(catalog.value.providers ?? []); setDefaultModel({ model: catalog.value.model ?? "", provider: catalog.value.provider ?? "" }); }
      else setError(ht("无法读取提供商目录，自定义接口仍可添加。"));
      if (auth.status === "fulfilled") setOAuth(auth.value.providers ?? []);
    });
    return () => controller.abort();
    // Catalog strings do not depend on the interface language.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [revision]);
  function choose(id: string, choice?: ProviderChoice) {
    if (busy || ((dirty || builtinDirty) && !window.confirm(ht("放弃未保存的修改？")))) return false;
    const item = endpoints.find(endpoint => endpoint.id === id);
    const next: Draft = item ? { ...empty, id: item.id, name: item.name, base_url: item.base_url, model: item.model, api_mode: item.api_mode ?? "", context_length: item.context_length == null ? "" : String(item.context_length), models: item.models ?? [], discover_models: item.discover_models !== false, model_details: item.model_details } : { ...empty };
    setBuiltin(choice ?? null); setBuiltinDirty(false); setSelected(id); setDraft(next); setBaseline(JSON.stringify(next)); setError(""); setNotice(""); setDiscoveryError(""); setDiscoveryNotice(""); setConfirmDelete(false); return true;
  }
  function change<K extends keyof Draft>(key: K, value: Draft[K]) { setDraft(previous => ({ ...previous, [key]: value })); setNotice(""); setDiscoveryError(""); setDiscoveryNotice(""); }
  function payload() {
    return { ...draft, api_key: draft.api_key.trim() || undefined, context_length: draft.context_length ? Number(draft.context_length) : null, models: [...new Set([...draft.models, draft.model].filter(Boolean))] };
  }
  async function run(action: () => Promise<void>) {
    setBusy(true); setError(""); setNotice("");
    try { await action(); } catch (e) { setError(e instanceof Error ? e.message : String(e)); } finally { setBusy(false); }
  }
  async function discover() {
    setBusy(true); setDiscoveryError(""); setDiscoveryNotice("");
    try {
      const result = await hermesJson<{ ok: boolean; code?: string; status?: number; models?: string[]; resolved_base_url?: string; model_details?: Endpoint["model_details"] }>("/api/providers/custom-endpoints/discover", { method: "POST", body: JSON.stringify({ id: draft.id, base_url: draft.base_url, api_key: draft.api_key.trim() || undefined, api_mode: draft.api_mode }) });
      if (!result.ok || !result.models?.length) {
        const messages: Record<string, string> = {
          authentication: ht("密钥验证失败，请检查密钥和访问权限。"),
          network: ht("连接超时或网络不可用，请检查接口地址。"),
          invalid_url: ht("请输入有效的接口地址，例如 https://api.example.com/v1。"),
          invalid_protocol: ht("请选择支持的接口协议。"),
          changed_url: ht("接口地址已改变，请重新输入此地址使用的密钥。"),
          missing_provider: ht("提供商已不存在，请刷新后重试。"),
          missing_key: ht("无法读取已保存的密钥，请重新输入密钥后重试。"),
          not_json: ht("该地址返回的是网页，请填写 API 地址而非网站首页。"),
          empty: ht("接口没有提供模型列表，可直接填写模型 ID。"),
          http: ht("接口返回 HTTP {status}，请检查地址和服务状态。", { status: result.status ?? "" }),
        };
        setDiscoveryError(messages[result.code ?? "empty"] ?? messages.empty); return;
      }
      setDraft(previous => ({ ...previous, models: result.models!, model_details: result.model_details, base_url: result.resolved_base_url ?? previous.base_url, model: previous.model || result.models![0] }));
      setDiscoveryNotice(ht("已获取 {count} 个模型", { count: result.models.length }));
    } catch {
      setDiscoveryError(ht("模型列表暂时无法获取，请稍后重试或手动填写模型 ID。"));
    } finally { setBusy(false); }
  }
  const ready = draft.name.trim() && /^https?:\/\//.test(draft.base_url) && draft.model.trim() && (!draft.context_length || (Number.isInteger(Number(draft.context_length)) && Number(draft.context_length) > 0));
  const currentEndpoint = endpoints.find(endpoint => endpoint.id === selected);
  const cards: HermesModelCard[] = [
    ...endpoints.map(endpoint => ({ id: endpoint.id, name: endpoint.name, baseUrl: endpoint.base_url, models: [...new Set([endpoint.model, ...(endpoint.models ?? [])].filter(Boolean))], defaultModel: endpoint.is_current && defaultModel.model ? defaultModel.model : endpoint.model, isDefault: endpoint.is_current, custom: true })),
    ...providers.filter(provider => !endpoints.some(endpoint => provider.slug.replace(/^custom:/, "").toLowerCase() === endpoint.id.replace(/^custom:/, "").toLowerCase() || (provider.is_user_defined && provider.name === endpoint.name))).map(provider => ({ id: provider.slug, name: provider.name, baseUrl: provider.api_url, models: provider.models ?? [], defaultModel: provider.slug === defaultModel.provider ? defaultModel.model : undefined, isDefault: provider.is_current || provider.slug === defaultModel.provider, custom: false, connected: provider.authenticated })),
  ];
  function editCard(card: HermesModelCard) {
    if (card.custom) choose(card.id);
    else { const provider = providers.find(row => row.slug === card.id); if (provider) choose("builtin", { provider, oauth: oauth.find(row => row.id === card.id) }); }
  }
  async function refreshCards(card?: HermesModelCard) {
    await run(async () => {
      const endpoint = card?.custom ? endpoints.find(row => row.id === card.id) : undefined;
      if (endpoint) {
        const result = await hermesJson<{ ok: boolean; models: string[]; model_details?: Endpoint["model_details"] }>("/api/providers/custom-endpoints/discover", { method: "POST", body: JSON.stringify({ id: endpoint.id, base_url: endpoint.base_url, api_mode: endpoint.api_mode ?? "" }) });
        if (!result.ok) throw new Error(ht("模型列表暂时无法获取，请稍后重试或手动填写模型 ID。"));
        setEndpoints(previous => previous.map(row => row.id === endpoint.id ? { ...row, models: result.models, model_details: result.model_details } : row));
        setNotice(ht("已获取 {count} 个模型", { count: result.models.length }));
      } else {
        const result = await hermesJson<{ providers: typeof providers; model?: string; provider?: string }>("/api/model/options?refresh=1");
        setProviders(result.providers ?? []); setDefaultModel({ model: result.model ?? "", provider: result.provider ?? "" });
        const saved = await hermesJson<{ endpoints: Endpoint[] }>("/api/providers/custom-endpoints");
        setEndpoints(saved.endpoints ?? []); setNotice(ht("模型列表已获取"));
      }
    });
  }
  async function setCardDefault(card: HermesModelCard, id: string) {
    await run(async () => {
      const body = { scope: "main", provider: card.id, model: id };
      let result = await hermesJson<{ confirm_required?: boolean; confirm_message?: string }>("/api/model/set", { method: "POST", body: JSON.stringify(body) });
      if (result.confirm_required) {
        if (!window.confirm(result.confirm_message || ht("确认使用这个模型？"))) return;
        result = await hermesJson("/api/model/set", { method: "POST", body: JSON.stringify({ ...body, confirm_expensive_model: true }) });
        if (result.confirm_required) throw new Error(ht("模型切换仍需确认，请在 Hermes 中检查。"));
      }
      onModelChange(id, card.id); setRevision(value => value + 1); setNotice(ht("默认模型已更新"));
    });
  }
  return <div className={`hermes-models-config${selected === "current" ? " is-overview" : ""}`}>
    {selected !== "current" && <div className="hermes-model-editor-toolbar"><button type="button" disabled={busy} onClick={() => choose("current")}><ArrowLeft size={16} aria-hidden="true"/>{ht("返回模型列表")}</button><ConfigButton aria-label={ht("＋ 添加提供商")} disabled={busy || loading} onClick={() => setPicker(true)}><Plus size={14} aria-hidden="true"/>{ht("添加提供商")}</ConfigButton></div>}
    {error && <div className="hermes-model-page-feedback is-error" role="alert"><CircleAlert size={15}/><span>{error}</span></div>}{notice && <div className="hermes-model-page-feedback" role="status"><CircleCheck size={15}/><span>{notice}</span></div>}
    {selected === "current" ? <HermesModelCards cards={cards} model={model} provider={modelProvider} busy={busy} modelBusy={modelBusy} loading={loading} onSwitch={onModelChange} onDefault={(card, id) => void setCardDefault(card, id)} onEdit={editCard} onRefresh={card => void refreshCards(card)} onAdd={() => setPicker(true)}/> : <ConfigSplitView><ConfigDetail>{builtin ? <HermesBuiltinProviderConfig key={builtin.oauth?.id ?? builtin.provider.slug} choice={builtin} modelBusy={modelBusy} onDirtyChange={setBuiltinDirty} onModelChange={onModelChange}/> : <div className="hermes-form"><ConfigDetailHeader><ConfigDetailHeaderInfo><ConfigDetailTitle>{selected === "new" ? ht("添加提供商") : draft.name}</ConfigDetailTitle></ConfigDetailHeaderInfo>{selected !== "new" && <ConfigButton variant="danger" disabled={busy} onClick={() => setConfirmDelete(true)}>{ht("删除")}</ConfigButton>}</ConfigDetailHeader>
      <ConfigField label={ht("提供商名称")}><input aria-label={ht("提供商名称")} disabled={busy} value={draft.name} placeholder={ht("OpenAI / Ollama / 自定义服务")} onChange={event => change("name", event.target.value)} /></ConfigField>
      <ConfigField label={ht("接口地址")}><input aria-label={ht("接口地址")} type="url" disabled={busy} value={draft.base_url} placeholder="https://api.example.com/v1" onChange={event => change("base_url", event.target.value)} /></ConfigField>
      <ConfigField label={ht("接口协议")}><span className="hermes-model-native-select"><select aria-label={ht("接口协议")} disabled={busy} value={draft.api_mode} onChange={event => change("api_mode", event.target.value)}><option value="">{ht("自动检测")}</option><option value="chat_completions">OpenAI Chat Completions</option><option value="codex_responses">OpenAI Responses</option><option value="anthropic_messages">Anthropic Messages</option></select><ChevronDown size={14} aria-hidden="true"/></span></ConfigField>
      <ConfigField label={ht("接口密钥")}><input aria-label={ht("提供商接口密钥")} type="password" autoComplete="new-password" disabled={busy} value={draft.api_key} placeholder={draft.id ? ht("留空保留已保存的密钥") : ht("本地服务可留空")} onChange={event => change("api_key", event.target.value)} /></ConfigField>
      <ConfigField label={ht("模型")}><div className="hermes-model-discovery-field"><div className="hermes-model-discovery"><input aria-label={ht("模型 ID")} aria-describedby={discoveryError || discoveryNotice ? "hermes-model-discovery-feedback" : undefined} aria-invalid={discoveryError ? true : undefined} list="hermes-provider-models" disabled={busy} value={draft.model} placeholder="gpt-… / claude-…" onChange={event => change("model", event.target.value)} /><datalist id="hermes-provider-models">{draft.models.map(id => <option key={id} value={id} />)}</datalist><ConfigButton disabled={busy || !draft.base_url.trim()} onClick={() => void discover()}>{busy ? ht("获取中…") : ht("获取模型")}</ConfigButton></div>
        {(discoveryError || discoveryNotice) && <div id="hermes-model-discovery-feedback" className={`hermes-model-discovery-feedback${discoveryError ? " is-error" : ""}`} role={discoveryError ? "alert" : "status"}>{discoveryError ? <CircleAlert size={15} aria-hidden="true"/> : <CircleCheck size={15} aria-hidden="true"/>}<span>{discoveryError || discoveryNotice}</span></div>}
      </div></ConfigField>
      {draft.models.length > 0 && <ConfigField label={ht("可用模型")}><span className="hermes-model-native-select"><select aria-label={ht("选择模型")} disabled={busy} value={draft.model} onChange={event => change("model", event.target.value)}>{!draft.models.includes(draft.model) && <option value={draft.model}>{draft.model || ht("请选择")}</option>}{draft.models.map(id => <option key={id} value={id}>{id}</option>)}</select><ChevronDown size={14} aria-hidden="true"/></span></ConfigField>}
      <ConfigField label={ht("上下文窗口")}><input aria-label={ht("上下文窗口")} type="number" min={1} step={1} disabled={busy} value={draft.context_length} placeholder={ht("留空使用模型检测值")} onChange={event => change("context_length", event.target.value)} /></ConfigField>
      <div className="hermes-preference-row"><div><strong>{ht("自动发现模型")}</strong><p>{ht("自动读取这个接口提供的模型列表。")}</p></div><ConfigSwitch label={ht("自动发现模型")} checked={draft.discover_models} disabled={busy} onChange={value => change("discover_models", value)} /></div>
      <div className="hermes-preference-row"><div><strong>{ht("保存后设为默认提供商")}</strong><p>{ht("保存时将此提供商和模型用于之后的新对话。")}</p></div><ConfigSwitch label={ht("保存后设为默认提供商")} checked={draft.make_default} disabled={busy || modelBusy} onChange={value => change("make_default", value)} /></div>
      {confirmDelete && <ConfigNotice><p>{ht("确认删除这个提供商？")}</p><ConfigButton disabled={busy} onClick={() => setConfirmDelete(false)}>{ht("取消")}</ConfigButton><ConfigButton variant="danger" disabled={busy} onClick={() => void run(async () => { await hermesJson(endpointPath(draft.id), { method: "DELETE" }); setSelected("current"); setDraft(empty); setBaseline(JSON.stringify(empty)); setRevision(value => value + 1); setNotice(ht("提供商已删除")); })}>{ht("确认删除")}</ConfigButton></ConfigNotice>}
      <ConfigFooter status={dirty ? ht("有未保存的修改") : currentEndpoint?.is_current ? ht("默认提供商") : ""}>{selected !== "new" && <ConfigButton disabled={busy || dirty || modelBusy || currentEndpoint?.is_current} onClick={() => void run(async () => { await hermesJson(`${endpointPath(draft.id)}/activate`, { method: "POST", body: "{}" }); onModelChange(draft.model,draft.id); setRevision(value => value + 1); setNotice(ht("默认提供商已切换")); })}>{ht("设为默认")}</ConfigButton>}<ConfigButton variant="primary" disabled={busy || !ready || (modelBusy && draft.make_default) || (!dirty && selected !== "new")} onClick={() => void run(async () => { const result = await hermesJson<{ id: string }>("/api/providers/custom-endpoints", { method: "POST", body: JSON.stringify(payload()) }); const saved = { ...draft, id: result.id, api_key: "", make_default: false }; setDraft(saved); setBaseline(JSON.stringify(saved)); setSelected(result.id); setRevision(value => value + 1); if (draft.make_default) onModelChange(draft.model,result.id); setNotice(ht("提供商已保存")); })}>{busy ? ht("保存中…") : ht("保存提供商")}</ConfigButton></ConfigFooter>
    </div>}</ConfigDetail></ConfigSplitView>}{picker && <HermesProviderPicker onClose={() => setPicker(false)} onCustom={() => {if (choose("new")) setPicker(false);}} onChoose={choice => {if (choose("builtin", choice)) setPicker(false);}}/>}</div>;
}
