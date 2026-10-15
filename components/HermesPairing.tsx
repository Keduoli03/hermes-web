"use client";
import { useState } from "react";
import { useHermesI18n } from "@/hooks/useHermesI18n";
import { useHermesOperation, useHermesResource } from "@/hooks/useHermesResource";
import { hermesJson } from "@/lib/hermes-client";
import { ConfigButton, ConfigEmptyState, ConfigNotice } from "./SettingsUi";
import { HermesResourceState } from "./HermesResourceState";
type User = { platform: string; user_id: string; user_name?: string; request_id?: string; age_minutes?: number };
export function HermesPairing() {
  const { ht } = useHermesI18n(), op = useHermesOperation();
  const [revision, setRevision] = useState(0);
  const resource = useHermesResource<{ pending: User[]; approved: User[] }>("/api/pairing", revision);
  if (!resource.data) return <HermesResourceState loading={resource.loading} error={resource.error} onRetry={() => setRevision(v => v + 1)} />;
  async function act(row: User, action: "approve" | "revoke") {
    if (action === "revoke" && !window.confirm(ht("撤销此用户的访问权限？"))) return;
    await op.run(async signal => { await hermesJson(`/api/pairing/${action}`, { method: "POST", signal, body: JSON.stringify({ platform: row.platform, ...(action === "approve" ? { request_id: row.request_id } : { user_id: row.user_id }) }) }); setRevision(v => v + 1); });
  }
  return <div className="hermes-admin-page"><header><ConfigButton disabled={op.busy} onClick={() => setRevision(v => v + 1)}>{ht("刷新")}</ConfigButton></header>{op.error && <ConfigNotice>{op.error}</ConfigNotice>}{resource.error && <ConfigNotice>{resource.error}</ConfigNotice>}
    {(["pending", "approved"] as const).map(kind => <section key={kind}><h3>{ht(kind === "pending" ? "待批准" : "已授权")}</h3>{!resource.data![kind].length && <ConfigEmptyState>{ht("暂无记录")}</ConfigEmptyState>}{resource.data![kind].map(row => <div className="hermes-admin-row" key={`${row.platform}:${row.user_id}:${row.request_id}`}><div><strong>{row.user_name || row.user_id}</strong><small>{row.platform} · {row.user_id}{row.age_minutes !== undefined ? ` · ${row.age_minutes} min` : ""}</small></div><ConfigButton disabled={op.busy || kind === "pending" && !row.request_id} variant={kind === "pending" ? "primary" : "danger"} onClick={() => void act(row, kind === "pending" ? "approve" : "revoke")}>{ht(kind === "pending" ? "批准访问" : "撤销访问")}</ConfigButton></div>)}</section>)}
  </div>;
}
