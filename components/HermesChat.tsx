"use client";

import { useCallback, useEffect, useRef, useState } from "react";

type HermesSession = { id: string; title?: string | null; last_active?: number; preview?: string; message_count?: number };
type ChatMessage = { role: "user" | "assistant" | "tool"; text: string };
type RunEvent = { event?: string; run_id?: string; session_id?: string; delta?: string; output?: string; status?: string; tool?: string; preview?: string; error?: string; approval?: { request_id?: string; command?: string; description?: string; choices?: string[] } };

async function api(path: string, init?: RequestInit) {
  const response = await fetch(`/api/hermes${path}`, { ...init, cache: "no-store", headers: { ...(init?.headers ?? {}), ...(init?.body ? { "Content-Type": "application/json" } : {}) } });
  if (!response.ok) {
    const body = await response.json().catch(() => ({}));
    throw new Error(body.error ?? body.message ?? body.detail ?? `Hermes API ${response.status}`);
  }
  return response;
}

function textFromMessage(item: Record<string, unknown>): string {
  const content = item.content ?? item.text ?? item.reasoning_content;
  if (typeof content === "string") return content;
  if (Array.isArray(content)) return content.map((part) => {
    if (typeof part === "string") return part;
    if (part && typeof part === "object") {
      const p = part as Record<string, unknown>;
      if (typeof p.text === "string") return p.text;
      if (p.type === "image") return "[图片]";
      if (p.type === "toolCall") return `工具调用：${String(p.toolName ?? "tool")}\n${JSON.stringify(p.input ?? {})}`;
    }
    return "";
  }).filter(Boolean).join("\n");
  return "";
}

export function HermesChat() {
  const [sessions, setSessions] = useState<HermesSession[]>([]);
  const [messages, setMessages] = useState<ChatMessage[]>([]);
  const [selected, setSelected] = useState<string | null>(null);
  const [draft, setDraft] = useState("");
  const [busy, setBusy] = useState(false);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [status, setStatus] = useState("连接 Hermes…");
  const [tools, setTools] = useState<string[]>([]);
  const [approval, setApproval] = useState<{ runId: string; requestId?: string; command?: string } | null>(null);
  const [modelName, setModelName] = useState("hermes-agent");
  const streamRef = useRef<AbortController | null>(null);
  const activeRunIdRef = useRef<string | null>(null);
  const scrollRef = useRef<HTMLDivElement>(null);

  const refreshSessions = useCallback(async () => {
    const response = await api("/api/sessions?limit=50");
    const data = await response.json() as { data?: HermesSession[] };
    setSessions(data.data ?? []);
  }, []);

  useEffect(() => {
    let alive = true;
    Promise.all([
      api("/health").then((r) => r.json()),
      api("/api/status").then((r) => r.json()),
      api("/v1/models").then((r) => r.json()),
      refreshSessions(),
    ]).then(([health, system, models]) => {
      if (!alive) return;
      const first = models.data?.[0]?.id;
      if (first) setModelName(first);
      setStatus(`Hermes ${health.version ?? system.version ?? ""} · API 已连接`);
      setError("");
    }).catch((e: unknown) => { if (alive) { setError(e instanceof Error ? e.message : String(e)); setStatus("无法连接 Hermes"); } })
      .finally(() => { if (alive) setLoading(false); });
    return () => { alive = false; };
  }, [refreshSessions]);

  useEffect(() => { scrollRef.current?.scrollTo({ top: scrollRef.current.scrollHeight, behavior: "smooth" }); }, [messages]);

  const openSession = useCallback(async (id: string) => {
    setSelected(id); setBusy(false); setApproval(null); setTools([]); setError("");
    setLoading(true);
    try {
      const response = await api(`/api/sessions/${encodeURIComponent(id)}/messages?limit=100&order=latest`);
      const body = await response.json() as { data?: Record<string, unknown>[] };
      const rows = (body.data ?? []).map((row) => ({ role: row.role === "user" ? "user" as const : "assistant" as const, text: textFromMessage(row) })).filter((m) => m.text);
      setMessages(rows);
    } catch (e) { setError(e instanceof Error ? e.message : String(e)); setMessages([]); }
    finally { setLoading(false); }
  }, []);

  const send = useCallback(async () => {
    const prompt = draft.trim();
    if (!prompt || busy) return;
    setDraft(""); setError(""); setBusy(true); setTools([]); setApproval(null);
    setMessages((old) => [...old, { role: "user", text: prompt }, { role: "assistant", text: "" }]);
    const controller = new AbortController(); streamRef.current = controller;
    let runId = ""; let finalOutput = ""; let deltaText = "";
    try {
      const response = await api("/v1/runs", { method: "POST", signal: controller.signal, body: JSON.stringify({ input: prompt, model: modelName, ...(selected ? { session_id: selected } : {}) }) });
      const created = await response.json() as { run_id: string; session_id?: string };
      runId = created.run_id;
      activeRunIdRef.current = runId;
      if (!selected) setSelected(created.session_id ?? created.run_id);
      const eventsResponse = await api(`/v1/runs/${encodeURIComponent(runId)}/events`, { headers: { Accept: "text/event-stream" }, signal: controller.signal });
      if (!eventsResponse.body) throw new Error("Hermes 没有返回事件流");
      const reader = eventsResponse.body.getReader(); const decoder = new TextDecoder(); let buffer = "";
      let terminal = false;
      while (!terminal) {
        const { done, value } = await reader.read(); if (done) break;
        buffer += decoder.decode(value, { stream: true });
        const frames = buffer.split(/\r?\n\r?\n/); buffer = frames.pop() ?? "";
        for (const frame of frames) {
          const data = frame.split(/\r?\n/).filter((line) => line.startsWith("data:")).map((line) => line.slice(5).trim()).join("\n");
          if (!data) continue;
          let event: RunEvent; try { event = JSON.parse(data) as RunEvent; } catch { continue; }
          if (event.event === "message.delta" && typeof event.delta === "string") {
            deltaText += event.delta;
            setMessages((old) => old.map((m, i) => i === old.length - 1 ? { ...m, text: deltaText } : m));
          } else if (event.event === "tool.started") {
            setTools((old) => [...old, `${event.tool ?? "工具"}${event.preview ? `：${event.preview}` : ""}`]);
          } else if (event.event === "approval.request") {
            setApproval({ runId, requestId: event.approval?.request_id, command: event.approval?.command ?? event.approval?.description });
          } else if (["run.completed", "run.failed", "run.interrupted", "run.cancelled"].includes(event.event ?? "")) {
            terminal = true;
            if (event.event === "run.completed") finalOutput = event.output ?? deltaText;
            else throw new Error(event.error ?? `运行结束：${event.event}`);
          }
        }
      }
      const answer = finalOutput || deltaText;
      if (answer) setMessages((old) => old.map((m, i) => i === old.length - 1 ? { ...m, text: answer } : m));
      setStatus("Hermes 就绪");
      await refreshSessions();
    } catch (e) {
      if (!controller.signal.aborted) setError(e instanceof Error ? e.message : String(e));
      if (!deltaText) setMessages((old) => old.filter((_, i) => i !== old.length - 1 || Boolean(deltaText)));
    } finally { setBusy(false); streamRef.current = null; activeRunIdRef.current = null; setApproval(null); }
  }, [busy, draft, modelName, refreshSessions, selected]);

  const stop = useCallback(async () => {
    const runId = activeRunIdRef.current;
    if (runId) {
      try { await api(`/v1/runs/${encodeURIComponent(runId)}/stop`, { method: "POST", body: JSON.stringify({}) }); }
      catch { /* the abort below still detaches the local SSE client */ }
    }
    streamRef.current?.abort();
    setBusy(false);
  }, []);

  const respondApproval = useCallback(async (choice: "once" | "deny") => {
    if (!approval) return;
    try {
      await api(`/v1/runs/${encodeURIComponent(approval.runId)}/approval`, { method: "POST", body: JSON.stringify({ choice, ...(approval.requestId ? { request_id: approval.requestId } : {}) }) });
      setApproval(null);
    } catch (e) { setError(e instanceof Error ? e.message : String(e)); }
  }, [approval]);

  const newChat = () => { streamRef.current?.abort(); setSelected(null); setMessages([]); setBusy(false); setTools([]); setError(""); };

  return <main className="hermes-layout">
    <aside className="hermes-sidebar">
      <div className="hermes-brand"><span className="hermes-mark">H</span><div><strong>Hermes</strong><small>Agent workspace</small></div></div>
      <button className="hermes-new" onClick={newChat}>＋　新建对话</button>
      <div className="hermes-nav-label">最近会话</div>
      <nav className="hermes-sessions">{sessions.map((s) => <button key={s.id} className={`hermes-session ${selected === s.id ? "active" : ""}`} onClick={() => void openSession(s.id)}><span>{s.title || s.preview || "新会话"}</span><small>{s.message_count ?? ""}</small></button>)}</nav>
      <div className="hermes-sidebar-foot"><span className="status-dot" />{status}</div>
    </aside>
    <section className="hermes-main">
      <header className="hermes-top"><div><span className="eyebrow">HERMES AGENT</span><strong>{selected ? sessions.find((s) => s.id === selected)?.title || "对话" : "新建对话"}</strong></div><label className="hermes-model">模型 <select value={modelName} onChange={(e) => setModelName(e.target.value)}><option value={modelName}>{modelName}</option></select></label></header>
      <div className="hermes-messages" ref={scrollRef}>
        {loading ? <div className="hermes-empty">正在读取 Hermes 会话…</div> : messages.length === 0 ? <div className="hermes-empty"><div className="hero-orb">✳</div><h1>和 Hermes 开始对话</h1><p>你的助手已准备好。输入问题，或让它帮你完成一项任务。</p><div className="suggestions"><button onClick={() => setDraft("概览一下当前项目结构")}>概览项目结构 <span>→</span></button><button onClick={() => setDraft("帮我制定一个清晰的下一步计划")}>制定下一步计划 <span>→</span></button><button onClick={() => setDraft("我可以让你帮我做什么？")}>探索 Hermes 能力 <span>→</span></button></div></div> : <div className="message-list">{messages.map((m,i) => <article className={`message ${m.role}`} key={`${i}-${m.role}`}><div className="message-avatar">{m.role === "user" ? "你" : "H"}</div><div className="message-body"><div className="message-role">{m.role === "user" ? "你" : "Hermes"}</div><div className="message-text">{m.text || (busy && i === messages.length-1 ? <span className="typing">思考中…</span> : "")}</div></div></article>)}</div>}
        {tools.length > 0 && <div className="tool-activity">{tools.slice(-3).map((t,i)=><div key={i}><span className="tool-dot"/> {t}</div>)}</div>}
        {approval && <div className="approval-card"><strong>Hermes 需要你的确认</strong><pre>{approval.command || "即将执行一项受保护的操作。"}</pre><div><button onClick={()=>void respondApproval("deny")}>拒绝</button><button className="approve" onClick={()=>void respondApproval("once")}>允许一次</button></div></div>}
        {error && <div className="error-banner">{error}</div>}
      </div>
      <div className="composer-wrap"><div className="composer"><textarea value={draft} onChange={(e)=>setDraft(e.target.value)} onKeyDown={(e)=>{if(e.key==="Enter"&&!e.shiftKey){e.preventDefault();void send();}}} placeholder="向 Hermes 发送消息…" rows={2}/><div className="composer-bottom"><span>Enter 发送 · Shift + Enter 换行</span>{busy?<button className="send-button stop" onClick={()=>void stop()}>停止</button>:<button className="send-button" disabled={!draft.trim()} onClick={()=>void send()}>发送 <span>↑</span></button>}</div></div><p className="composer-note">Hermes 可能会出错，请核对重要信息。</p></div>
    </section>
  </main>;
}
