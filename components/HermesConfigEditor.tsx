"use client";

import { useHermesI18n } from "@/hooks/useHermesI18n";

import { useEffect, useMemo, useRef, useState } from "react";
import { hermesJson } from "@/lib/hermes-client";
import { configDocument, configFieldFromDocument, configPatch, getObjectField, updateConfigField, type ConfigFieldSchema, type ConfigSchema } from "@/lib/hermes-config-form";
import { configLabel, configDescription, configOption, hasReviewedConfigCopy } from "@/lib/i18n/hermes/config-copy";
import { hermesLabel } from "@/lib/hermes-display";
import { configControlOverrides, dedicatedConfigCategories, isConfigFieldApplicable, isWebConfigField } from "@/lib/hermes-settings-fields";
import { ConfigButton, ConfigEmptyState, ConfigFooter, ConfigNotice, ConfigDetail, ConfigSwitch } from "./SettingsUi";

const categories: Record<string, string> = { general: "通用", agent: "任务执行", terminal: "终端", display: "显示", delegation: "子任务", memory: "记忆", compression: "上下文压缩", security: "安全", browser: "浏览器", voice: "语音", tts: "文字转语音", stt: "语音转文字", logging: "日志", auxiliary: "辅助模型", attachments: "附件", bot_desktop: "桌面助手", curator: "整理器", database: "数据库", desktop: "桌面", gateway: "网关", kanban: "看板", local_runtime: "本地运行环境", model_catalog: "模型目录", openrouter: "OpenRouter", sessions: "会话", tool_loop_guardrails: "工具循环保护", tool_output: "工具输出", updates: "更新", providers: "提供商", runtime: "运行环境", checkpoint: "检查点", egress: "网络出口", proxy: "代理" };
export function HermesConfigEditor({ onDirtyChange, allowedCategories, category: requestedCategory = "general", onCategoriesChange, visibleKeys }: { onDirtyChange: (dirty: boolean) => void; allowedCategories?: string[]; category?: string; onCategoriesChange?: (options: {id:string;label:string}[]) => void; visibleKeys?: string[] }) {
  const { ht, locale } = useHermesI18n();
  const fieldLabel = (key: string) => configLabel(key, locale);
  const [schema, setSchema] = useState<ConfigSchema>({ fields: {} });
  const [resolved, setResolved] = useState<Record<string, unknown>>({});
  const [source, setSource] = useState(""); const [saved, setSaved] = useState("");
  const [path, setPath] = useState("config.yaml");
  const [mode, setMode] = useState<"form" | "yaml">("form");
  const [filter, setFilter] = useState(""); const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false); const [error, setError] = useState(""); const [notice, setNotice] = useState("");
  const [revision, setRevision] = useState(0); const [sourceEdited, setSourceEdited] = useState(false);
  const changed = useRef(new Set<string>()); const importRef = useRef<HTMLInputElement>(null);
  const dirty = source !== saved;
  useEffect(() => { onDirtyChange(dirty || saving); }, [dirty, saving, onDirtyChange]);
  useEffect(() => {
    const controller = new AbortController(); setLoading(true); setError("");
    Promise.all([
      hermesJson<ConfigSchema>("/api/config/schema", { signal: controller.signal }),
      hermesJson<Record<string, unknown>>("/api/config", { signal: controller.signal }),
      hermesJson<{ yaml: string; path?: string }>("/api/config/raw", { signal: controller.signal }),
    ]).then(([nextSchema, config, raw]) => {
      if (controller.signal.aborted) return;
      setSchema(nextSchema); setResolved(config); setSource(raw.yaml); setSaved(raw.yaml); setPath(raw.path ?? "config.yaml"); changed.current.clear(); setSourceEdited(false);
    }).catch((e: unknown) => { if (!controller.signal.aborted) setError(e instanceof Error ? e.message : String(e)); }).finally(() => { if (!controller.signal.aborted) setLoading(false); });
    return () => controller.abort();
  }, [revision]);
  useEffect(() => {
    if (!dirty) return;
    const warn = (event: BeforeUnloadEvent) => event.preventDefault(); window.addEventListener("beforeunload", warn);
    return () => window.removeEventListener("beforeunload", warn);
  }, [dirty]);
  const parsed = useMemo(() => { try { return { document: configDocument(source), error: "" }; } catch (e) { return { document: null, error: e instanceof Error ? e.message : String(e) }; } }, [source]);
  const orderedCategories = useMemo(() => {
    const all = [...new Set(Object.entries(schema.fields).filter(([key]) => isWebConfigField(key) && (visibleKeys ? visibleKeys.includes(key) : hasReviewedConfigCopy(key))).map(([,field]) => field.category ?? "general").filter((name) => allowedCategories ? allowedCategories.includes(name) : !dedicatedConfigCategories.includes(name)))];
    return [...(schema.category_order ?? []).filter((name) => all.includes(name)), ...all.filter((name) => !schema.category_order?.includes(name)).sort()];
  }, [schema, allowedCategories, visibleKeys]);
  useEffect(() => { onCategoriesChange?.(orderedCategories.map(id => ({id, label: ht(categories[id] ?? hermesLabel(id))}))); }, [orderedCategories, ht, onCategoriesChange]);
  const selectedCategory = orderedCategories.includes(requestedCategory) ? requestedCategory : orderedCategories[0];
  const visibleFields = Object.entries(schema.fields).filter(([key, field]) => isWebConfigField(key) && (visibleKeys ? visibleKeys.includes(key) : hasReviewedConfigCopy(key)) && orderedCategories.includes(field.category ?? "general") && isConfigFieldApplicable(key, name => parsed.document ? configFieldFromDocument(parsed.document, name, getObjectField(resolved, name)) : getObjectField(resolved, name)) && (filter.trim() ? `${key} ${fieldLabel(key)} ${configDescription(key, field.description, locale)} ${categories[field.category ?? "general"] ?? ""}`.toLowerCase().includes(filter.trim().toLowerCase()) : (field.category ?? "general") === selectedCategory));
  function changeField(key: string, value: unknown) {
    try { setSource(updateConfigField(source, key, value)); changed.current.add(key); setNotice(""); setError(""); }
    catch (e) { setError(e instanceof Error ? e.message : String(e)); }
  }
  async function save() {
    if (!dirty || !parsed.document) return;
    setSaving(true); setError(""); setNotice("");
    try {
      if (mode === "yaml" || sourceEdited) await hermesJson("/api/config/raw", { method: "PUT", body: JSON.stringify({ yaml_text: source }) });
      else await hermesJson("/api/config", { method: "PUT", body: JSON.stringify({ config: configPatch(source, changed.current) }) });
      setSaved(source); setNotice(ht("配置已保存")); setRevision((value) => value + 1);
    } catch (e) { setError(e instanceof Error ? e.message : String(e)); }
    finally { setSaving(false); }
  }
  function download() {
    const url = URL.createObjectURL(new Blob([source], { type: "application/yaml" }));
    const anchor = document.createElement("a"); anchor.href = url; anchor.download = "config.yaml"; anchor.click(); URL.revokeObjectURL(url);
  }
  return <div className="hermes-config-editor is-focused"><div className="hermes-config-toolbar">{mode === "form" && <input className="hermes-config-quick-search" aria-label={ht("搜索配置字段")} placeholder={ht("搜索配置字段…")} value={filter} onChange={event => setFilter(event.target.value)} />}{mode === "yaml" && <code title={path}>{path}</code>}<div className="hermes-config-mode" aria-label={ht("配置编辑方式")}>{mode === "yaml" && <ConfigButton disabled={!parsed.document} onClick={() => setMode("form")}>{ht("表单")}</ConfigButton>}<ConfigButton disabled={mode === "yaml"} onClick={() => setMode("yaml")}>{ht("YAML 源码")}</ConfigButton></div><details className="hermes-config-more"><summary>{ht("更多")}</summary><div><ConfigButton disabled={loading} onClick={download}>{ht("导出")}</ConfigButton><ConfigButton disabled={loading || saving} onClick={() => importRef.current?.click()}>{ht("导入")}</ConfigButton></div></details><ConfigButton disabled={!dirty || saving} onClick={() => { setSource(saved); setSourceEdited(false); changed.current.clear(); setError(""); }}>{ht("还原")}</ConfigButton></div>
    <input ref={importRef} type="file" accept=".yaml,.yml" hidden onChange={async (event) => { const file = event.target.files?.[0]; if (!file) return; try { const content = await file.text(); configDocument(content); setSource(content); setSourceEdited(true); setNotice(ht("配置已导入，保存后生效")); setError(""); } catch (e) { setError(e instanceof Error ? e.message : String(e)); } event.target.value = ""; }} />
    {loading && <ConfigNotice>{ht("正在读取配置字段…")}</ConfigNotice>}{error && <div role="alert"><ConfigNotice>{error}</ConfigNotice></div>}{notice && <div role="status"><ConfigNotice>{notice}</ConfigNotice></div>}
    {mode === "yaml" ? <div className="hermes-config-source"><textarea className="hermes-editor" aria-label={ht("配置 YAML 源码")} value={source} disabled={loading || saving} onChange={(event) => { setSource(event.target.value); setSourceEdited(true); }} spellCheck={false} />{parsed.error && <div role="alert"><ConfigNotice>{parsed.error}</ConfigNotice></div>}</div> : <ConfigDetail><div className="hermes-config-fields">{filter && <h3>{filter ? ht("搜索结果") : ht(categories[selectedCategory] ?? selectedCategory ?? "")}</h3>}{!visibleFields.length && !loading && <ConfigEmptyState>{ht("没有匹配的配置字段")}</ConfigEmptyState>}{parsed.document && visibleFields.map(([key, field]) => {
      const value = configFieldFromDocument(parsed.document!, key, getObjectField(resolved, key));
      return <div className="hermes-config-field" key={key}><div className="hermes-config-field-info"><label htmlFor={`config-${key}`}>{fieldLabel(key)}</label>{configDescription(key, field.description, locale) && <p>{configDescription(key, field.description, locale)}</p>}</div><ValueEditor fieldKey={key} field={{...field, ...configControlOverrides[key]}} value={value} disabled={saving} onChange={(next) => changeField(key, next)} /></div>;
    })}</div></ConfigDetail>}
    <ConfigFooter status={dirty ? ht("有未保存的修改") : ht("已保存")}><ConfigButton disabled={dirty || saving || loading} onClick={() => setRevision((value) => value + 1)}>{ht("刷新")}</ConfigButton><ConfigButton variant="primary" disabled={!dirty || saving || loading || !parsed.document} onClick={() => void save()}>{saving ? ht("保存中…") : ht("保存配置")}</ConfigButton></ConfigFooter>
  </div>;
}

function ValueEditor({ fieldKey, field, value, disabled, onChange }: { fieldKey: string; field: ConfigFieldSchema; value: unknown; disabled: boolean; onChange: (value: unknown) => void }) {
  const { ht, locale } = useHermesI18n();
  const fieldLabel = (key: string) => configLabel(key, locale);
  const [newKey, setNewKey] = useState("");
  if (value && typeof value === "object" && !Array.isArray(value)) return <div className="hermes-config-nested">{Object.entries(value as Record<string, unknown>).map(([key, item]) => <div key={key}><label>{fieldLabel(key)}</label><ValueEditor fieldKey={`${fieldKey}.${key}`} field={{ type: typeof item }} value={item} disabled={disabled} onChange={(next) => onChange({ ...(value as object), [key]: next })} /><ConfigButton size="small" disabled={disabled} onClick={() => { const next = { ...(value as Record<string, unknown>) }; delete next[key]; onChange(next); }}>{ht("删除")}</ConfigButton></div>)}<div><input aria-label={ht("{name} 新键名", { name: fieldKey })} placeholder={ht("新键名")} value={newKey} onChange={(event) => setNewKey(event.target.value)} /><ConfigButton size="small" disabled={disabled || !newKey.trim() || ["__proto__", "constructor", "prototype"].includes(newKey)} onClick={() => { onChange({ ...(value as object), [newKey]: "" }); setNewKey(""); }}>{ht("添加字段")}</ConfigButton></div></div>;
  if (Array.isArray(value) || field.type === "list") {
    const list = Array.isArray(value) ? value : [];
    return <div className="hermes-config-nested">{list.map((item, index) => <div key={index}><ValueEditor fieldKey={`${fieldKey}.${index}`} field={{ type: typeof item }} value={item} disabled={disabled} onChange={(next) => onChange(list.map((entry, i) => index === i ? next : entry))} /><ConfigButton size="small" disabled={disabled} onClick={() => onChange(list.filter((_, i) => i !== index))}>{ht("删除")}</ConfigButton></div>)}<ConfigButton size="small" disabled={disabled} onClick={() => onChange([...list, typeof list[0] === "object" ? {} : ""])}>{ht("添加一项")}</ConfigButton></div>;
  }
  const label = fieldLabel(fieldKey);
  if (field.type === "boolean" || typeof value === "boolean") return <ConfigSwitch label={label} checked={value === true} disabled={disabled} onChange={onChange} />;
  if (field.type === "select") { const options = (field.options ?? []).map(String); const selected = String(value ?? ""); return <select id={`config-${fieldKey}`} aria-label={label} disabled={disabled} value={selected} onChange={(event) => onChange(event.target.value)}>{!options.includes(selected) && <option value={selected}>{selected || ht("未设置")}</option>}{options.map((option) => <option key={option} value={option}>{configOption(fieldKey, option, locale)}</option>)}</select>; }
  if (field.type === "number" || typeof value === "number") return <input id={`config-${fieldKey}`} aria-label={label} type="number" min={field.min} max={field.max} disabled={disabled} value={value === undefined || value === null ? "" : String(value)} onChange={(event) => { const number = event.target.valueAsNumber; if (Number.isFinite(number)) onChange(number); }} />;
  if (field.type === "textarea" || (typeof value === "string" && value.includes("\n"))) return <textarea id={`config-${fieldKey}`} aria-label={label} rows={4} disabled={disabled} value={String(value ?? "")} onChange={(event) => onChange(event.target.value)} />;
  return <input id={`config-${fieldKey}`} aria-label={label} type={/key|token|password|secret/i.test(fieldKey) ? "password" : "text"} autoComplete="off" disabled={disabled} value={String(value ?? "")} onChange={(event) => onChange(event.target.value)} />;
}
