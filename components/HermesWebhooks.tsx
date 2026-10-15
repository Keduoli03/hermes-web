"use client";
import { useEffect, useState } from "react";
import { Copy, Plus, Trash2, X } from "lucide-react";
import { useHermesI18n } from "@/hooks/useHermesI18n";
import { useHermesOperation, useHermesResource } from "@/hooks/useHermesResource";
import { hermesJson } from "@/lib/hermes-client";
import { ConfigButton, ConfigEmptyState, ConfigNotice, ConfigSwitch } from "./SettingsUi";
import { HermesResourceState } from "./HermesResourceState";
type Route = { name: string; description: string; url: string; enabled: boolean; events: string[]; prompt: string; deliver: string; skills: string[] };
export function HermesWebhooks({ onDirtyChange }: { onDirtyChange: (dirty: boolean) => void }) {
  const { ht } = useHermesI18n(), op = useHermesOperation();
  const [revision, setRevision] = useState(0), [adding, setAdding] = useState(false), [secret, setSecret] = useState("");
  const [draft, setDraft] = useState({ name: "", description: "", prompt: "", events: "", skills: "", deliver: "log", deliver_chat_id: "", deliver_only: false });
  const resource = useHermesResource<{ enabled: boolean; subscriptions: Route[] }>("/api/webhooks", revision);
  const dirty = adding && Object.entries(draft).some(([key, value]) => key === "deliver" ? value !== "log" : Boolean(value));
  useEffect(() => { onDirtyChange(dirty || op.busy); }, [dirty, op.busy, onDirtyChange]);
  const split = (value: string) => value.split(",").map(s => s.trim()).filter(Boolean);
  if (!resource.data) return <HermesResourceState loading={resource.loading} error={resource.error} onRetry={() => setRevision(v => v + 1)} />;
  return <div className="hermes-admin-page"><header><ConfigButton disabled={op.busy || dirty} onClick={() => setRevision(v => v + 1)}>{ht("刷新")}</ConfigButton>{!resource.data.enabled ? <ConfigButton disabled={op.busy} onClick={() => void op.run(async signal => { const result = await hermesJson<{ needs_restart?: boolean }>("/api/webhooks/enable", { method: "POST", signal }); op.setNotice(ht(result.needs_restart ? "已启用，需要重启网关。" : "已启用")); setRevision(v => v + 1); })}>{ht("启用 Webhooks")}</ConfigButton> : <ConfigButton disabled={op.busy} onClick={() => setAdding(!adding)}><Plus size={15} />{ht("新建订阅")}</ConfigButton>}</header>
    {(op.error || resource.error) && <ConfigNotice>{op.error || resource.error}</ConfigNotice>}{op.notice && <ConfigNotice>{op.notice}</ConfigNotice>}
    {secret && <div className="hermes-one-time-secret"><strong>{ht("新订阅密钥")}</strong><output>{secret}</output><ConfigButton title={ht("复制密钥")} aria-label={ht("复制密钥")} onClick={() => void navigator.clipboard.writeText(secret).catch(() => op.setError(ht("复制失败")))}><Copy size={16} /></ConfigButton><ConfigButton title={ht("关闭")} aria-label={ht("关闭")} onClick={() => setSecret("")}><X size={16} /></ConfigButton></div>}
    {adding && <form className="hermes-admin-form" onSubmit={event => { event.preventDefault(); void op.run(async signal => { const result = await hermesJson<Route & { secret: string }>("/api/webhooks", { method: "POST", signal, body: JSON.stringify({ ...draft, events: split(draft.events), skills: split(draft.skills), deliver_chat_id: draft.deliver_chat_id || undefined }) }); setSecret(result.secret); setAdding(false); setDraft({ name: "", description: "", prompt: "", events: "", skills: "", deliver: "log", deliver_chat_id: "", deliver_only: false }); setRevision(v => v + 1); }); }}>
      {([ ["name", "名称"], ["description", "说明"], ["events", "事件（逗号分隔）"], ["skills", "技能（逗号分隔）"], ["deliver_chat_id", "接收会话"] ] as const).map(([key, label]) => <label key={key}><span>{ht(label)}</span><input value={draft[key]} required={key === "name"} disabled={op.busy} onChange={event => setDraft(old => ({ ...old, [key]: event.target.value }))} /></label>)}
      <label><span>{ht("任务提示词")}</span><textarea disabled={op.busy} value={draft.prompt} onChange={event => setDraft(old => ({ ...old, prompt: event.target.value }))} /></label><label><span>{ht("结果投递")}</span><input value={draft.deliver} disabled={op.busy} onChange={event => setDraft(old => ({ ...old, deliver: event.target.value }))} /></label><label><ConfigSwitch label={ht("仅投递事件")} checked={draft.deliver_only} disabled={op.busy} onChange={value => setDraft(old => ({ ...old, deliver_only: value }))} />{ht("仅投递事件")}</label><ConfigButton type="submit" variant="primary" disabled={op.busy || !draft.name.trim()}>{ht("创建订阅")}</ConfigButton>
    </form>}
    {!resource.data.subscriptions.length && <ConfigEmptyState>{ht("暂无订阅")}</ConfigEmptyState>}{resource.data.subscriptions.map(row => <div className="hermes-admin-row" key={row.name}><div><strong>{row.name}</strong><p>{row.description}</p><small>{row.url}</small><small>{row.events.join(", ")}</small></div><ConfigSwitch label={ht("启用 {name}", { name: row.name })} checked={row.enabled} disabled={op.busy} onChange={enabled => void op.run(async signal => { await hermesJson(`/api/webhooks/${encodeURIComponent(row.name)}/enabled`, { method: "PUT", signal, body: JSON.stringify({ enabled }) }); setRevision(v => v + 1); })} /><ConfigButton variant="danger" title={ht("删除订阅")} aria-label={ht("删除订阅 {name}", { name: row.name })} disabled={op.busy} onClick={() => { if (window.confirm(ht("删除此订阅？"))) void op.run(async signal => { await hermesJson(`/api/webhooks/${encodeURIComponent(row.name)}`, { method: "DELETE", signal }); setRevision(v => v + 1); }); }}><Trash2 size={16} /></ConfigButton></div>)}
  </div>;
}
