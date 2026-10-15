"use client";

import { useEffect, useState } from "react";
import { LogOut, ShieldCheck } from "lucide-react";
import { useHermesI18n } from "@/hooks/useHermesI18n";
import { ConfigButton } from "./SettingsUi";

type Status = { enabled: boolean; authenticated: boolean; passwordEnabled: boolean; official: { enabled: boolean; ready: boolean }; account: string | null };

export function HermesAccountSettings() {
  const { ht } = useHermesI18n();
  const [status, setStatus] = useState<Status | null>(null);
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);
  useEffect(() => {
    const controller = new AbortController();
    fetch("/api/web-auth", { signal: controller.signal, cache: "no-store" }).then(async response => {
      if (!response.ok) throw new Error("Auth status unavailable");
      setStatus(await response.json());
    }).catch(() => { if (!controller.signal.aborted) setError(ht("无法读取登录配置，请刷新重试。")); });
    return () => controller.abort();
  }, [ht]);
  async function logout() {
    setBusy(true); setError("");
    try {
      const response = await fetch("/api/web-auth", { method: "DELETE" });
      if (!response.ok) throw new Error("Logout failed");
      window.location.replace("/login");
    } catch { setError(ht("退出失败，请重试。")); setBusy(false); }
  }
  return <section className="hermes-account-settings" aria-label={ht("账号与访问")}>
    <div className="hermes-preference-row"><div><strong><ShieldCheck size={16} aria-hidden="true" /> {ht("账号与访问")}</strong><p>{!status ? ht("正在读取登录方式…") : !status.enabled ? ht("未启用登录验证") : status.account ? ht("已通过 Nous 官方账号登录") : ht("已通过面板密码登录")}</p>{status?.account && <p className="hermes-account-id">{status.account}</p>}{status?.official.enabled && !status.official.ready && <p>{ht("官方登录配置尚未完成，请联系面板管理员。")}</p>}</div>
      {status?.enabled && status.authenticated && <ConfigButton disabled={busy} onClick={() => void logout()}><LogOut size={15} aria-hidden="true" />{busy ? ht("正在退出…") : ht("退出登录")}</ConfigButton>}
    </div>{error && <p role="alert">{error}</p>}
  </section>;
}
