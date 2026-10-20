"use client";

import { useEffect, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { ArrowLeft, FolderCog, LogIn, LogOut, RefreshCw, ShieldCheck, UserRound } from "lucide-react";
import { useHermesI18n } from "@/hooks/useHermesI18n";
import { useIsMobile } from "@/hooks/useIsMobile";
import { hermesLoginPath, signOutHermesWeb, type HermesAccountStatus } from "@/lib/hermes-account-client";
import { hermesJson } from "@/lib/hermes-client";
import { SidebarMenu, type SidebarMenuAnchor, type SidebarMenuItem } from "./SidebarMenu";
import { HermesAccountSettings } from "./HermesAccountSettings";
import type { ProfileInfo } from "./HermesAdvancedModules";

export function HermesAccountMenu({ inert, onManageProfiles }: { inert: boolean; onManageProfiles: () => void }) {
  const { ht } = useHermesI18n();
  const router = useRouter();
  const isMobile = useIsMobile();
  const buttonRef = useRef<HTMLButtonElement>(null);
  const [open, setOpen] = useState(false);
  const [anchor, setAnchor] = useState<SidebarMenuAnchor | null>(null);
  const [view, setView] = useState<"menu" | "auth">("menu");
  const [revision, setRevision] = useState(0);
  const [status, setStatus] = useState<HermesAccountStatus | null>(null);
  const [profiles, setProfiles] = useState<ProfileInfo[]>([]);
  const [active, setActive] = useState<{ active: string; current: string } | null>(null);
  const [loading, setLoading] = useState(false);
  const [busy, setBusy] = useState(false);
  const [loggingOut, setLoggingOut] = useState(false);
  const [authError, setAuthError] = useState("");
  const [profileError, setProfileError] = useState("");
  const [actionError, setActionError] = useState("");
  const [notice, setNotice] = useState("");
  const visible = open && !inert;

  useEffect(() => { if (inert) setOpen(false); }, [inert]);
  useEffect(() => {
    if (!visible) return;
    const controller = new AbortController();
    setLoading(true);setStatus(null);setProfiles([]);setActive(null);setAuthError("");setProfileError("");
    fetch("/api/web-auth", { signal: controller.signal, cache: "no-store" }).then(async response => {
      if (!response.ok) throw new Error();
      const account = await response.json() as HermesAccountStatus;
      if (controller.signal.aborted) return;
      setStatus(account);
      if (!account.authenticated) return;
      try {
        const [list, current] = await Promise.all([
          hermesJson<{ profiles: ProfileInfo[] }>("/api/profiles", { signal: controller.signal }),
          hermesJson<{ active: string; current: string }>("/api/profiles/active", { signal: controller.signal }),
        ]);
        if (!controller.signal.aborted) { setProfiles(list.profiles ?? []);setActive(current?.active && current?.current ? current : null); }
      } catch {
        if (!controller.signal.aborted) setProfileError(ht("无法读取配置方案，请重试。"));
      }
    }).catch(() => { if (!controller.signal.aborted) setAuthError(ht("无法读取登录配置，请刷新重试。")); })
      .finally(() => { if (!controller.signal.aborted) setLoading(false); });
    return () => controller.abort();
  }, [visible, revision, ht]);

  function toggle() {
    if (open) { setOpen(false);return; }
    const rect = buttonRef.current?.getBoundingClientRect();
    if (rect) setAnchor({ kind: "point", x: rect.right + 8, y: rect.bottom });
    setView("menu");setActionError("");setNotice("");setOpen(true);
  }
  async function setDefault(name: string) {
    if (busy || active?.active === name) return;
    setBusy(true);setActionError("");setNotice("");
    try {
      const result = await hermesJson<{ active: string }>("/api/profiles/active", { method: "POST", body: JSON.stringify({ name }) });
      setActive(previous => previous ? { ...previous, active: result.active || name } : null);
      setNotice(ht("默认方案已更新，当前服务和已有会话保持原方案。"));
    } catch (error) { setActionError(error instanceof Error ? error.message : ht("配置方案更新失败")); }
    finally { setBusy(false); }
  }
  async function logout() {
    if (busy) return;
    setBusy(true);setLoggingOut(true);setActionError("");
    try { await signOutHermesWeb(); }
    catch { setActionError(ht("退出失败，请重试。"));setBusy(false);setLoggingOut(false); }
  }
  const accountLabel = !status ? ht("正在读取登录方式…") : !status.enabled ? ht("未启用登录验证") : !status.authenticated ? ht("尚未登录") : status.account ? ht("已通过 Nous 官方账号登录") : ht("已通过面板密码登录");
  const items: SidebarMenuItem[] = [
    { type: "custom", id: "account", content: <div className="hermes-account-summary"><UserRound size={24} strokeWidth={1.5} aria-hidden="true"/><div><strong>{ht("账户与配置")}</strong><span role="status">{accountLabel}</span>{status?.account && <small>{status.account}</small>}</div></div> },
    { type: "item", id: "auth", label: ht("认证与登录"), icon: <ShieldCheck size={16}/>, onSelect: event => { event.keepOpen();setView("auth"); } },
    ...(status?.enabled && !status.authenticated ? [{ type: "item" as const, id: "login", label: ht("登录面板"), icon: <LogIn size={16}/>, onSelect: () => router.push(hermesLoginPath()) }] : []),
    { type: "separator", id: "profile-separator" },
    { type: "header", id: "profile-heading", label: ht("默认配置方案") },
    ...(active ? [{ type: "custom" as const, id: "current-profile", content: <p className="hermes-account-menu-status">{ht("当前服务方案：{name}", { name: active.current })}</p> }] : []),
    ...(loading ? [{ type: "custom" as const, id: "loading", content: <p className="hermes-account-menu-status" role="status">{ht("正在读取档案…")}</p> }] : []),
    ...profiles.map(profile => ({ type: "item" as const, id: `profile:${profile.name}`, label: profile.display_name || profile.name, title: profile.description || profile.name, checked: active?.active === profile.name, disabled: busy, onSelect: (event: { keepOpen: () => void }) => { event.keepOpen();void setDefault(profile.name); } })),
    { type: "item", id: "manage-profiles", label: ht("管理配置方案"), icon: <FolderCog size={16}/>, disabled: busy || !status?.authenticated, onSelect: onManageProfiles },
    ...(authError || profileError ? [
      { type: "custom" as const, id: "read-error", content: <p className="hermes-account-menu-status" role="alert">{authError || profileError}</p> },
      { type: "item" as const, id: "retry", label: ht("重试"), icon: <RefreshCw size={16}/>, disabled: busy, onSelect: (event: { keepOpen: () => void }) => { event.keepOpen();setRevision(value => value + 1); } },
    ] : []),
    ...(notice || actionError ? [{ type: "custom" as const, id: "result", content: <p className="hermes-account-menu-status" role={actionError ? "alert" : "status"}>{actionError || notice}</p> }] : []),
    ...(status?.enabled && status.authenticated ? [
      { type: "separator" as const, id: "logout-separator" },
      { type: "item" as const, id: "logout", label: ht(loggingOut ? "正在退出…" : "退出登录"), icon: <LogOut size={16}/>, disabled: busy, onSelect: (event: { keepOpen: () => void }) => { event.keepOpen();void logout(); } },
    ] : []),
  ];

  return <>
    <button ref={buttonRef} type="button" className="hermes-rail-profiles" aria-label={ht("账户与配置")} aria-haspopup="menu" aria-expanded={visible} onClick={toggle}><UserRound size={21} strokeWidth={1.7} aria-hidden="true"/><span className="hermes-rail-tooltip">{ht("账户与配置")}</span></button>
    <SidebarMenu open={visible} anchor={anchor} sheet={isMobile} ariaLabel={ht("账户与配置")} title={ht("账户与配置")} cancelLabel={ht("关闭")} width={312} items={items} onClose={() => setOpen(false)} returnFocusTo={buttonRef.current} focusKey={view}>
      {view === "auth" && <div className="hermes-account-panel"><button type="button" className="hermes-account-menu-back" data-sidebar-menu-item="" onClick={() => setView("menu")}><ArrowLeft size={15} aria-hidden="true"/>{ht("返回账户菜单")}</button><HermesAccountSettings/></div>}
    </SidebarMenu>
  </>;
}
