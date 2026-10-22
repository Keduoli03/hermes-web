"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { LogIn, LogOut, ShieldCheck, RefreshCw, Link2 } from "lucide-react";
import { useHermesI18n } from "@/hooks/useHermesI18n";
import { hermesLoginPath, signOutHermesWeb, type HermesAccountStatus } from "@/lib/hermes-account-client";
import { ConfigButton } from "./SettingsUi";
import type { HermesConnectionStatus } from "@/lib/hermes-connection-status";

export function HermesAccountSettings() {
  const { ht } = useHermesI18n();
  const router = useRouter();
  const [status, setStatus] = useState<HermesAccountStatus | null>(null);
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);
  const [connection,setConnection]=useState<HermesConnectionStatus|null>(null);
  const [connecting,setConnecting]=useState(false);
  const connectionRequest = useRef<AbortController | null>(null);
  const readConnection = useCallback(async (method = "GET") => {
    connectionRequest.current?.abort();
    const controller = new AbortController();
    connectionRequest.current = controller;
    setConnecting(true);
    try {
      const response = await fetch("/api/hermes-connection", { method, signal: controller.signal, cache: "no-store" });
      const result = await response.json();
      if (!response.ok) throw new Error();
      if (!controller.signal.aborted) setConnection(result);
    } catch {
      if (!controller.signal.aborted) setConnection({ connected: false, error: ht("无法读取管理服务连接状态，请重试。") });
    } finally { if (!controller.signal.aborted) setConnecting(false); }
  }, [ht]);
  useEffect(() => {
    const controller = new AbortController();
    fetch("/api/web-auth", { signal: controller.signal, cache: "no-store" }).then(async response => {
      if (!response.ok) throw new Error("Auth status unavailable");
      setStatus(await response.json());
    }).catch(() => { if (!controller.signal.aborted) setError(ht("无法读取登录配置，请刷新重试。")); });
    return () => controller.abort();
  }, [ht]);
  useEffect(() => {
    void readConnection();
    return () => connectionRequest.current?.abort();
  }, [readConnection]);
  async function logout() {
    setBusy(true); setError("");
    try {
      await signOutHermesWeb();
    } catch { setError(ht("退出失败，请重试。")); setBusy(false); }
  }
  const dashboard = connection?.dashboard ?? connection;
  return <section className="hermes-account-settings" aria-label={ht("账号与访问")}>
    <div className="hermes-preference-row"><div><strong><ShieldCheck size={16} aria-hidden="true" /> {ht("账号与访问")}</strong><p>{!status ? ht("正在读取登录方式…") : !status.enabled ? ht("未启用登录验证") : !status.authenticated ? ht("尚未登录") : status.account ? ht("已通过 Nous 官方账号登录") : ht("已通过面板密码登录")}</p>{status?.account && <p className="hermes-account-id">{status.account}</p>}{status?.official.enabled && !status.official.ready && <p>{ht("官方登录配置尚未完成，请联系面板管理员。")}</p>}</div>
      {status?.enabled && !status.authenticated && <ConfigButton onClick={() => router.push(hermesLoginPath())}><LogIn size={15} aria-hidden="true"/>{ht("登录面板")}</ConfigButton>}
      {status?.enabled && status.authenticated && <ConfigButton disabled={busy} onClick={() => void logout()}><LogOut size={15} aria-hidden="true" />{busy ? ht("正在退出…") : ht("退出登录")}</ConfigButton>}
    </div>{error && <p role="alert">{error}</p>}
    <div className="hermes-preference-row"><div><strong><Link2 size={16} aria-hidden="true"/>{ht("Hermes 管理服务")}</strong><p role="status">{ht(!dashboard ? "正在连接本机管理服务…" : dashboard.connected ? connection?.automatic ? "已自动连接本机 Hermes" : "已连接 Hermes 管理服务" : "管理服务尚未连接")}</p>{dashboard?.error && <p>{ht(dashboard.error)}</p>}</div><ConfigButton disabled={connecting} onClick={()=>void readConnection("POST")}><RefreshCw size={15} aria-hidden="true"/>{ht(connecting ? "正在连接…" : "重新连接")}</ConfigButton></div>
    {connection?.api && <div className="hermes-preference-row"><div><strong>{ht("Hermes 聊天服务")}</strong><p role="status">{ht(connection.api.connected ? "聊天服务已连接" : "聊天服务尚未连接")}</p>{connection.api.error && <p>{ht(connection.api.error)}</p>}</div></div>}
    {connection?.project && <div className="hermes-preference-row"><div><strong>{ht("Hermes 项目会话")}</strong><p role="status">{ht(connection.project.connected ? "项目会话已连接" : "项目会话尚未连接")}</p>{connection.project.error && <p>{ht(connection.project.error)}</p>}</div></div>}
  </section>;
}
