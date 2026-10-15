"use client";
import { LoaderCircle, RefreshCw, Unplug } from "lucide-react";
import { useHermesI18n } from "@/hooks/useHermesI18n";
import { ConfigButton } from "./SettingsUi";

export function HermesResourceState({ loading, error, onRetry }: {
  loading: boolean;
  error: string;
  onRetry: () => void;
}) {
  const { ht } = useHermesI18n();
  return <div className="hermes-resource-state">
    <div className="hermes-resource-state-body" role={loading ? "status" : "alert"}>
      {loading ? <LoaderCircle size={28} aria-hidden="true" /> : <Unplug size={28} aria-hidden="true" />}
      <h2>{ht(loading ? "正在加载…" : "暂时无法加载")}</h2>
      <p>{ht(loading ? "正在读取服务数据，请稍候。" : "请确认 Hermes 管理服务正在运行，然后重试。")}</p>
      {!loading && <><ConfigButton onClick={onRetry}><RefreshCw size={14} aria-hidden="true" />{ht("重新连接")}</ConfigButton>
        <details><summary>{ht("查看原因")}</summary><p>{error}</p></details></>}
    </div>
  </div>;
}
