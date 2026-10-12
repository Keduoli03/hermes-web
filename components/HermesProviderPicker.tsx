"use client";

import { useEffect, useLayoutEffect, useRef, useState } from "react";
import { hermesJson } from "@/lib/hermes-client";
import { openStackedDialog } from "@/lib/stacked-dialog";
import { useHermesI18n } from "@/hooks/useHermesI18n";
import { ProviderIcon } from "./ProviderIcon";
import { SearchIcon } from "./SidebarIcons";

const iconId = (id:string) => ({"openai-api":"openai",gemini:"google",vertex:"google-vertex",bedrock:"amazon-bedrock","azure-foundry":"azure",copilot:"github-copilot","copilot-acp":"github-copilot","claude-code":"anthropic","minimax-oauth":"minimax","xai-oauth":"xai","qwen-oauth":"qwen","ai-gateway":"vercel-ai-gateway","opencode-zen":"opencode","kimi-coding-cn":"kimi-coding"} as Record<string,string>)[id] ?? id;

export type HermesProvider = { slug: string; name: string; models?: string[]; total_models?: number; key_env?: string; authenticated?: boolean; is_user_defined?: boolean };
export type HermesOAuthProvider = { id: string; name: string; flow: string; cli_command?: string; status?: {logged_in?:boolean} };
export type ProviderChoice = { provider: HermesProvider; oauth?: HermesOAuthProvider };

export function HermesProviderPicker({ onChoose, onCustom, onClose }: { onChoose: (choice: ProviderChoice) => void; onCustom: () => void; onClose: () => void }) {
  const { ht } = useHermesI18n();
  const ref = useRef<HTMLDivElement>(null);
  const closeRef = useRef(onClose);
  const [search, setSearch] = useState("");
  const [providers, setProviders] = useState<HermesProvider[]>([]);
  const [oauth, setOAuth] = useState<HermesOAuthProvider[]>([]);
  const [loading, setLoading] = useState(true); const [error, setError] = useState("");
  useLayoutEffect(() => { closeRef.current = onClose; });
  useEffect(() => openStackedDialog(document, ref.current, () => closeRef.current()), []);
  useEffect(() => {
    const controller = new AbortController();
    Promise.allSettled([
      hermesJson<{providers:HermesProvider[]}>("/api/model/options?include_unconfigured=1", {signal:controller.signal}),
      hermesJson<{providers:HermesOAuthProvider[]}>("/api/providers/oauth", {signal:controller.signal}),
    ]).then(([catalog, auth]) => {
      if (controller.signal.aborted) return;
      if (catalog.status === "fulfilled") setProviders((catalog.value.providers ?? []).filter(item => !item.is_user_defined && item.slug !== "custom")); else setError(ht("无法读取提供商目录，自定义接口仍可添加。"));
      if (auth.status === "fulfilled") setOAuth(auth.value.providers ?? []);
      setLoading(false);
    });
    return () => controller.abort();
    // Catalog content is independent of the selected interface language.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);
  const query = search.trim().toLowerCase();
  const match = (name:string, id:string) => !query || `${name} ${id}`.toLowerCase().includes(query);
  const subscriptions = oauth.filter(item => match(item.name,item.id));
  const api = providers.filter(item => (Boolean(item.key_env) || !oauth.some(auth => auth.id === item.slug)) && match(item.name,item.slug));
  const showCustom = !query || "自定义 custom openai anthropic compatible".includes(query);
  return <div className="hermes-provider-picker-backdrop" onClick={event => {if (event.target === event.currentTarget) onClose();}}><div ref={ref} className="hermes-provider-picker" role="dialog" aria-modal="true" aria-label={ht("选择提供商")} tabIndex={-1} onKeyDown={event => {
    if (event.key !== "Tab") return;
    const controls = Array.from(ref.current?.querySelectorAll<HTMLElement>('input,button:not(:disabled)') ?? []);
    const first=controls[0],last=controls.at(-1);
    if (event.shiftKey && (document.activeElement === first || document.activeElement === ref.current)) {event.preventDefault();last?.focus();}
    else if (!event.shiftKey && (document.activeElement === last || document.activeElement === ref.current)) {event.preventDefault();first?.focus();}
  }}><header><SearchIcon size={16}/><input autoFocus aria-label={ht("搜索提供商")} placeholder={ht("搜索提供商…")} value={search} onChange={event=>setSearch(event.target.value)}/><button type="button" aria-label={ht("关闭提供商选择")} onClick={onClose}>×</button></header><div className="hermes-provider-picker-body">{loading && <p>{ht("正在读取提供商目录…")}</p>}{error && <p role="alert">{error}</p>}{showCustom && <section><h3>{ht("自定义")}</h3><div className="hermes-provider-card-grid"><button type="button" className="hermes-provider-card" onClick={onCustom}><div><strong>OpenAI / Anthropic compatible</strong><small>{ht("自定义接口地址与模型")}</small></div><span aria-hidden="true" className="hermes-provider-symbol">＋</span></button></div></section>}{subscriptions.length > 0 && <section><h3>{ht("订阅与账号登录")}</h3><div className="hermes-provider-card-grid">{subscriptions.map(item => <button type="button" className="hermes-provider-card" key={item.id} onClick={()=>onChoose({provider:providers.find(provider=>provider.slug===item.id) ?? {slug:item.id,name:item.name},oauth:item})}><div><strong>{item.name}</strong><small>{ht(item.flow === "device_code" ? "账号授权登录" : "通过官方命令行登录")}</small></div><ProviderIcon id={iconId(item.id)} size={32}/></button>)}</div></section>}{api.length > 0 && <section><h3>{ht("接口密钥与本地服务")}</h3><div className="hermes-provider-card-grid">{api.map(item=><button type="button" className="hermes-provider-card" key={item.slug} onClick={()=>onChoose({provider:item})}><div><strong>{item.name}</strong><small>{(item.total_models ?? item.models?.length ?? 0) > 0 ? ht("{count} 个模型",{count:item.total_models ?? item.models?.length ?? 0}) : ht("连接后选择模型")}</small></div><ProviderIcon id={iconId(item.slug)} size={32}/></button>)}</div></section>}{!loading && !showCustom && !subscriptions.length && !api.length && <p>{ht("没有匹配的提供商")}</p>}</div></div></div>;
}
