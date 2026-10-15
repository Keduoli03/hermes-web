"use client";
import { useEffect, useRef, useState } from "react";
import { QrCode, X } from "lucide-react";
import { useHermesI18n } from "@/hooks/useHermesI18n";
import { hermesJson } from "@/lib/hermes-client";
import { scoped } from "@/lib/hermes-advanced";
import { ConfigButton, ConfigNotice } from "./SettingsUi";

type Flow = { pairing_id: string; status?: string; qr_payload?: string; deep_link?: string; expires_at: string; owner_user_id?: string; account_name?: string; account_phone?: string; error?: string };
export function HermesChannelOnboarding({ platform, profile, disabled, onPending, onSaved }: { platform: "telegram" | "whatsapp"; profile: string; disabled: boolean; onPending: (pending: boolean) => void; onSaved: () => void }) {
  const { ht } = useHermesI18n();
  const [flow, setFlow] = useState<Flow | null>(null), [qr, setQr] = useState(""), [error, setError] = useState(""), [notice, setNotice] = useState("");
  const [busy, setBusy] = useState(false), [name, setName] = useState("Hermes"), [mode, setMode] = useState("self-chat"), [allowed, setAllowed] = useState("");
  const active = useRef<string | null>(null), alive = useRef(true);
  const base = `/api/messaging/${platform}/onboarding`;
  useEffect(() => { onPending(Boolean(flow) || busy); return () => onPending(false); }, [flow, busy, onPending]);
  useEffect(() => {
    alive.current = true;
    return () => { alive.current = false; if (active.current) void hermesJson(scoped(`${base}/${encodeURIComponent(active.current)}`, profile), { method: "DELETE", keepalive: true }).catch(() => {}); };
  }, [base, profile]);
  useEffect(() => {
    if (!flow?.qr_payload && !flow?.deep_link) return;
    let cancelled = false;
    import("qrcode").then(QRCode => QRCode.toDataURL(flow.qr_payload || flow.deep_link!, { width: 240, margin: 2, errorCorrectionLevel: "M" })).then(value => { if (!cancelled) setQr(value); }).catch(() => { if (!cancelled) setError(ht("二维码生成失败")); });
    return () => { cancelled = true; };
  }, [flow?.qr_payload, flow?.deep_link, ht]);
  const pairingId = flow?.pairing_id, flowStatus = flow?.status, expiresAt = flow?.expires_at;
  useEffect(() => {
    if (!pairingId || ["ready", "connected", "expired", "cancelled", "error"].includes(flowStatus ?? "")) return;
    const controller = new AbortController(); let timer: ReturnType<typeof setTimeout>;
    const poll = async () => {
      try {
        if (Date.parse(expiresAt || "") <= Date.now()) throw new Error(ht("绑定已过期，请重新开始。"));
        const next = await hermesJson<Flow>(scoped(`${base}/${encodeURIComponent(pairingId)}`, profile), { signal: controller.signal });
        if (!controller.signal.aborted) { setFlow(old => old?.pairing_id === pairingId ? { ...old, ...next } : old); setError(next.error || ""); }
      } catch (e) { if (!controller.signal.aborted) { setError(e instanceof Error ? e.message : String(e)); return; } }
      if (!controller.signal.aborted) timer = setTimeout(poll, 2000);
    };
    timer = setTimeout(poll, 1000);
    return () => { controller.abort(); clearTimeout(timer); };
  }, [pairingId, flowStatus, expiresAt, base, profile, ht]);
  async function start() {
    setBusy(true); setError(""); setNotice(""); setQr("");
    try {
      const next = await hermesJson<Flow>(scoped(`${base}/start`, profile), { method: "POST", body: JSON.stringify(platform === "telegram" ? { bot_name: name } : { mode, allowed_users: allowed, ...(profile ? { profile } : {}) }) });
      if (!alive.current) { await hermesJson(scoped(`${base}/${encodeURIComponent(next.pairing_id)}`, profile), { method: "DELETE" }); return; }
      active.current = next.pairing_id; setFlow(next);
    } catch (e) { if (alive.current) setError(e instanceof Error ? e.message : String(e)); }
    finally { if (alive.current) setBusy(false); }
  }
  async function cancel() {
    if (!flow) return;
    setBusy(true); setError("");
    try { await hermesJson(scoped(`${base}/${encodeURIComponent(flow.pairing_id)}`, profile), { method: "DELETE" }); active.current = null; setFlow(null); setQr(""); }
    catch (e) { setError(e instanceof Error ? e.message : String(e)); }
    finally { setBusy(false); }
  }
  const ready = flow?.status === "ready" || flow?.status === "connected";
  const deepLink = flow?.deep_link && /^https:\/\/t\.me\//.test(flow.deep_link) ? flow.deep_link : null;
  return <section className="hermes-channel-onboarding"><h3><QrCode size={16} />{ht("扫码绑定")}</h3>{error && <ConfigNotice>{error}</ConfigNotice>}{notice && <ConfigNotice>{notice}</ConfigNotice>}
    {!flow ? <div className="hermes-admin-form">{platform === "telegram" ? <label><span>{ht("机器人名称")}</span><input value={name} disabled={busy || disabled} onChange={event => setName(event.target.value)} /></label> : <><label><span>{ht("连接模式")}</span><select value={mode} disabled={busy || disabled} onChange={event => setMode(event.target.value)}><option value="self-chat">{ht("与自己聊天")}</option><option value="bot">{ht("机器人模式")}</option></select></label><label><span>{ht("允许访问的用户或群组")}</span><input value={allowed} disabled={busy || disabled} onChange={event => setAllowed(event.target.value)} /></label></>}<ConfigButton disabled={busy || disabled} onClick={() => void start()}><QrCode size={16} />{ht("开始绑定")}</ConfigButton></div> : <>
      {/* eslint-disable-next-line @next/next/no-img-element */}
      {qr && !ready && <img width={240} height={240} src={qr} alt={ht("绑定二维码")} />}
      {deepLink && !ready && <a href={deepLink} target="_blank" rel="noopener noreferrer">{ht("在 Telegram 中打开")}</a>}
      <p role="status">{ht(ready ? "已确认绑定" : "等待扫码确认…")}{flow.account_name ? ` · ${flow.account_name}` : ""}</p>
      <div className="hermes-admin-actions"><ConfigButton disabled={busy} onClick={() => void cancel()}><X size={15} />{ht("取消绑定")}</ConfigButton><ConfigButton variant="primary" disabled={busy || !ready} onClick={() => { setBusy(true); void hermesJson<{ needs_restart: boolean; restart_error?: string }>(scoped(`${base}/${encodeURIComponent(flow.pairing_id)}/apply`, profile), { method: "POST", body: JSON.stringify(platform === "telegram" ? { allowed_user_ids: [...new Set([flow.owner_user_id, ...allowed.split(",")].filter(Boolean).map(value => value!.trim()))], ...(profile ? { profile } : {}) } : { mode, allowed_users: allowed || undefined, ...(profile ? { profile } : {}) }) }).then(result => { active.current = null; setFlow(null); setQr(""); setNotice(result.restart_error || ht(result.needs_restart ? "已保存，需要重启网关。" : "绑定已保存")); onSaved(); }).catch(e => setError(e.message)).finally(() => setBusy(false)); }}>{ht("保存绑定")}</ConfigButton></div>
    </>}
  </section>;
}
