"use client";
import { useEffect, useState } from "react";
import { Download, RefreshCw, Trash2 } from "lucide-react";
import { useHermesI18n } from "@/hooks/useHermesI18n";
import { useHermesOperation, useHermesResource } from "@/hooks/useHermesResource";
import { hermesControl, readHermesControl } from "@/lib/hermes-control-client";
import { ConfigButton, ConfigEmptyState, ConfigNotice, ConfigSwitch } from "./SettingsUi";
import { HermesResourceState } from "./HermesResourceState";
type Setting = { key: string; type: string; label: string; description?: string; choices?: string[]; value?: unknown; has_value?: boolean };
type Plugin = { name: string; key?: string; version?: string; description: string; source: string; status: string; update_available?: boolean; settings_schema?: Setting[] };
export function HermesPlugins({ onDirtyChange }: { onDirtyChange: (dirty: boolean) => void }) {
  const { ht } = useHermesI18n(), op = useHermesOperation();
  const [revision, setRevision] = useState(0), [query, setQuery] = useState(""), [source, setSource] = useState(""), [ref, setRef] = useState("");
  const [selected, setSelected] = useState<string | null>(null), [values, setValues] = useState<Record<string, unknown>>({});
  const resource = useHermesResource<{ plugins: Plugin[] }>("/api/hermes-control?module=plugins", revision, readHermesControl);
  const dirty = Boolean(source || ref || Object.keys(values).length);
  useEffect(() => { onDirtyChange(dirty || op.busy); }, [dirty, op.busy, onDirtyChange]);
  const current = resource.data?.plugins.find(row => (row.key || row.name) === selected);
  function action(body: Record<string, unknown>) { return op.run(async signal => { await hermesControl({ module: "plugins", ...body }, signal); setRevision(v => v + 1); }); }
  if (!resource.data) return <HermesResourceState loading={resource.loading} error={resource.error} onRetry={() => setRevision(v => v + 1)} />;
  return <div className="hermes-admin-page"><header><input aria-label={ht("搜索插件")} placeholder={ht("搜索插件…")} value={query} onChange={event => setQuery(event.target.value)} /><ConfigButton disabled={op.busy || dirty} title={ht("刷新")} onClick={() => setRevision(v => v + 1)}><RefreshCw size={16} /></ConfigButton></header>
    {(op.error || resource.error) && <ConfigNotice>{op.error || resource.error}</ConfigNotice>}
    <form className="hermes-admin-form" onSubmit={event => { event.preventDefault(); void op.run(async signal => { const result = await hermesControl<{ warnings?: string[]; missing_env?: string[]; enabled?: boolean }>({ module: "plugins", action: "install", identifier: source.trim(), ...(ref ? { ref } : {}) }, signal); setSource(""); setRef(""); op.setNotice([ht("插件已安装"), ...(result.warnings ?? []), ...(result.missing_env ?? [])].join(" · ")); setRevision(v => v + 1); }); }}><label><span>{ht("插件来源")}</span><input value={source} disabled={op.busy} onChange={event => setSource(event.target.value)} /></label><label><span>{ht("固定提交（可选）")}</span><input value={ref} pattern="[a-fA-F0-9]{40}" disabled={op.busy} onChange={event => setRef(event.target.value)} /></label><ConfigButton type="submit" disabled={op.busy || !source.trim()}><Download size={15} />{ht("安装插件")}</ConfigButton></form>
    {op.notice && <ConfigNotice>{op.notice}</ConfigNotice>}
    {!resource.data.plugins.length && <ConfigEmptyState>{ht("暂无插件")}</ConfigEmptyState>}
    {resource.data.plugins.filter(row => `${row.name} ${row.description}`.toLowerCase().includes(query.toLowerCase())).map(row => <div className="hermes-admin-row" key={row.key || row.name}><button type="button" className="hermes-admin-select" onClick={() => { if (Object.keys(values).length && !window.confirm(ht("放弃未保存的修改？"))) return; setSelected(row.key || row.name); setValues({}); }}><strong>{row.name} <small>{row.version}</small></strong><span>{row.description}</span><small>{row.source}</small></button><ConfigSwitch label={ht("启用 {name}", { name: row.name })} checked={row.status === "enabled"} disabled={op.busy} onChange={enable => void action({ action: "toggle", key: row.key || row.name, name: row.name, enable })} />{row.update_available && <ConfigButton title={ht("更新插件")} disabled={op.busy} onClick={() => void action({ action: "update", name: row.name })}><RefreshCw size={16} /></ConfigButton>}{row.source !== "bundled" && <ConfigButton title={ht("卸载插件")} aria-label={ht("卸载 {name}", { name: row.name })} disabled={op.busy} onClick={() => { if (window.confirm(ht("卸载此插件？"))) void action({ action: "remove", name: row.name }); }}><Trash2 size={16} /></ConfigButton>}</div>)}
    {current && <section><h3>{current.name}</h3>{current.settings_schema?.length ? <form className="hermes-admin-form" onSubmit={event => {
      event.preventDefault(); void op.run(async signal => {
        const patch = Object.fromEntries(Object.entries(values).filter(([key, value]) => !(current.settings_schema?.find(field => field.key === key)?.type === "secret" && value === "")).map(([key, value]) => {
          const type = current.settings_schema?.find(field => field.key === key)?.type;
          return [key, type === "json" && typeof value === "string" ? JSON.parse(value) : value];
        }));
        await hermesControl({ module: "plugins", action: "settings", key: current.key || current.name, values: patch }, signal); setValues({}); setRevision(v => v + 1);
      });
    }}>{current.settings_schema.map(field => <label key={field.key}><span>{field.label}</span>{field.type === "boolean" ? <ConfigSwitch label={field.label} checked={Boolean(values[field.key] ?? field.value)} disabled={op.busy} onChange={value => setValues(old => ({ ...old, [field.key]: value }))} /> : field.type === "enum" ? <select value={String(values[field.key] ?? field.value ?? "")} disabled={op.busy} onChange={event => setValues(old => ({ ...old, [field.key]: event.target.value }))}><option value="" />{field.choices?.map(choice => <option key={choice}>{choice}</option>)}</select> : field.type === "json" ? <textarea value={String(values[field.key] ?? JSON.stringify(field.value ?? {}, null, 2))} disabled={op.busy} onChange={event => setValues(old => ({ ...old, [field.key]: event.target.value }))} /> : <input type={field.type === "secret" ? "password" : field.type === "number" ? "number" : "text"} value={String(values[field.key] ?? (field.type === "secret" ? "" : field.value ?? ""))} placeholder={field.type === "secret" && field.has_value ? ht("留空保留已保存的值") : undefined} autoComplete="off" disabled={op.busy} onChange={event => setValues(old => ({ ...old, [field.key]: field.type === "number" ? Number(event.target.value) : event.target.value }))} />}{field.description && <small>{field.description}</small>}</label>)}<ConfigButton type="submit" variant="primary" disabled={op.busy || !Object.keys(values).length}>{ht("保存设置")}</ConfigButton></form> : <ConfigEmptyState>{ht("此插件没有可编辑设置")}</ConfigEmptyState>}</section>}
  </div>;
}
