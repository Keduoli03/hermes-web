"use client";

import { useEffect, useRef, useState, type RefObject } from "react";
import { Check, Copy, LoaderCircle, RefreshCw, X } from "lucide-react";
import { useHermesI18n } from "@/hooks/useHermesI18n";
import { hermesJson } from "@/lib/hermes-client";
import { listenForStackedDialogEscape } from "@/lib/stacked-dialog";
import { SystemPromptPanel } from "./SystemPromptPanel";

export function HermesSystemPrompt({ sessionId, refreshKey, onClose, buttonRef }: {
  sessionId: string; refreshKey: number; onClose: () => void; buttonRef: RefObject<HTMLButtonElement | null>;
}) {
  const { ht } = useHermesI18n();
  const panelRef = useRef<HTMLDivElement>(null);
  const [prompt, setPrompt] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [revision, setRevision] = useState(0);
  const [copied, setCopied] = useState(false);
  const [copyError, setCopyError] = useState(false);

  useEffect(() => {
    const controller = new AbortController();
    setLoading(true); setError(""); setCopied(false); setCopyError(false);
    hermesJson<{ system_prompt?: string | null }>(`/api/sessions/${encodeURIComponent(sessionId)}`, { signal: controller.signal })
      .then(data => { if (!controller.signal.aborted) setPrompt(typeof data.system_prompt === "string" ? data.system_prompt : ""); })
      .catch(() => { if (!controller.signal.aborted) setError("无法读取系统提示词，请重试。"); })
      .finally(() => { if (!controller.signal.aborted) setLoading(false); });
    return () => controller.abort();
  }, [sessionId, refreshKey, revision]);

  useEffect(() => {
    panelRef.current?.focus({ preventScroll: true });
    const outside = (event: PointerEvent) => {
      if (event.target instanceof Node && !panelRef.current?.contains(event.target) && !buttonRef.current?.contains(event.target)) onClose();
    };
    document.addEventListener("pointerdown", outside);
    const escape = listenForStackedDialogEscape(document, () => { onClose(); buttonRef.current?.focus({ preventScroll: true }); });
    return () => { document.removeEventListener("pointerdown", outside); escape(); };
  }, [buttonRef, onClose]);

  useEffect(() => {
    if (!copied) return;
    const timer = setTimeout(() => setCopied(false), 2000);
    return () => clearTimeout(timer);
  }, [copied]);

  const translate = (key: string) => ht({
    "system.prompt": "系统提示词",
    "system.empty": "本会话尚未保存系统提示词。",
    "system.loading": "正在读取系统提示词…",
    "system.load": "本会话尚未保存系统提示词。",
  }[key] ?? key);

  return <div ref={panelRef} id="hermes-system-prompt" className="hermes-system-prompt" tabIndex={-1}>
    <header><div><strong>{ht("系统提示词")}</strong><small>{ht("本会话保存的提示词")}</small></div><div className="hermes-system-prompt-actions">
      <button type="button" disabled={!prompt || loading || Boolean(error)} title={ht(copied ? "已复制" : "复制提示词")} aria-label={ht(copied ? "已复制" : "复制提示词")} onClick={async () => {
        try { await navigator.clipboard.writeText(prompt || ""); setCopied(true); setCopyError(false); }
        catch { setCopyError(true); }
      }}>{copied ? <Check size={14} /> : <Copy size={14} />}</button>
      <button type="button" disabled={loading} title={ht("刷新系统提示词")} aria-label={ht("刷新系统提示词")} onClick={() => setRevision(value => value + 1)}>{loading ? <LoaderCircle size={14} className="hermes-artifact-spinner" /> : <RefreshCw size={14} />}</button>
      <button type="button" title={ht("关闭系统提示词")} aria-label={ht("关闭系统提示词")} onClick={() => { onClose(); buttonRef.current?.focus({ preventScroll: true }); }}><X size={15} /></button>
    </div></header>
    {copyError && <p role="status" className="hermes-system-prompt-notice">{ht("复制失败，请选择文本手动复制。")}</p>}
    {error ? <div className="hermes-system-prompt-error" role="alert"><span>{ht(error)}</span><button type="button" onClick={() => setRevision(value => value + 1)}><RefreshCw size={14} />{ht("重试")}</button></div>
      : <SystemPromptPanel prompt={loading ? null : prompt} loading={loading} translate={translate} />}
  </div>;
}
