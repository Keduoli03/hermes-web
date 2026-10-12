"use client";

import { useHermesI18n } from "@/hooks/useHermesI18n";

import { useCallback, useMemo, useEffect, useEffectEvent, useRef, useState, type CSSProperties } from "react";
import { hermesApi as api } from "@/lib/hermes-client";
import { HermesSessionInfo, type HermesSessionDetail } from "./HermesSessionInfo";
import { HermesSettingsDialog, type HermesSettingsSection } from "./HermesSettingsDialog";
import { HermesSidebar, HermesUiIcon, type HermesSessionRow } from "./HermesSidebar";
import { ChatInput, type AttachedImage, type ChatInputHandle } from "./ChatInput";
import { FileViewer } from "./FileViewer";
import { TerminalPanel } from "./TerminalPanel";
import { newTerminalTab, type TerminalTab } from "./terminal-tab-state";
import { hermesJson } from "@/lib/hermes-client";
import { PencilIcon } from "./SidebarIcons";
import { ChatMinimap } from "./ChatMinimap";
import type { AgentMessage } from "@/lib/types";
import { MessageView } from "./MessageView";
import { I18nProvider } from "@/hooks/useI18n";
import { useFontPreferences } from "@/hooks/useFontPreferences";
import { useHermesFontSizes } from "@/hooks/useHermesFontSizes";
import { useHermesChatDisplay } from "@/hooks/useHermesChatDisplay";
import { MarkdownBody } from "./MarkdownBody";
import { useTheme } from "@/hooks/useTheme";
import { useViewportHeight } from "@/hooks/useViewportHeight";
import { useIsMobile } from "@/hooks/useIsMobile";

type HermesSession = HermesSessionRow;
type ThinkingLevel = "auto" | "off" | "minimal" | "low" | "medium" | "high" | "xhigh" | "max";
type ChatMessage = { role: "user" | "assistant" | "tool"; text: string; reasoning?: string; images?: { data: string; mimeType: string }[] };
type RunEvent = { event?: string; run_id?: string; session_id?: string; delta?: string; text?: string; output?: string; status?: string; tool?: string; preview?: string; error?: string; approval?: { request_id?: string; command?: string; description?: string; choices?: string[] } };

function textFromMessage(item: Record<string, unknown>): string {
  const content = item.content ?? item.text;
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

function reasoningFromMessage(item: Record<string, unknown>): string {
  if (typeof item.reasoning_content === "string") return item.reasoning_content;
  if (Array.isArray(item.content)) return item.content.filter(part => part && typeof part === "object" && part.type === "thinking").map(part => String(part.thinking ?? "")).join("\n");
  return "";
}

export function HermesChat() {
  return <I18nProvider initialLocale="zh-CN" storageKey="hermes-web-locale"><HermesWorkspace /></I18nProvider>;
}

function HermesWorkspace() {
  const { ht } = useHermesI18n();
  useTheme();
  const display = useHermesChatDisplay();
  useFontPreferences();
  useHermesFontSizes();
  const isMobile = useIsMobile();
  useViewportHeight();
  const [page, setPage] = useState<HermesSettingsSection | null>(null);
  const [sidebarOpen, setSidebarOpen] = useState(false);
  const [desktopSidebarOpen, setDesktopSidebarOpen] = useState(true);
  const [cwd, setCwd] = useState<string | null>(null);
  const [filePath, setFilePath] = useState<string | null>(null);
  const [terminal, setTerminal] = useState<TerminalTab | null>(null);
  const [fileRefreshKey, setFileRefreshKey] = useState(0);
  const [modelCatalog,setModelCatalog]=useState<{id:string;name:string;provider:string;input?:string[]}[]>([]);
  const [modelProvider,setModelProvider]=useState("");
  const [models, setModels] = useState<string[]>([]);
  const [managementDirty, setManagementDirty] = useState(false);
  const [sessionActionBusy,setSessionActionBusy]=useState(false);
  const [sessionTotal,setSessionTotal]=useState(0);
  const [infoOpen,setInfoOpen]=useState(false);
  const [detail,setDetail]=useState<HermesSessionDetail|null>(null);
  const [infoError,setInfoError]=useState("");
  const [infoRevision,setInfoRevision]=useState(0);
  const [thinking,setThinking]=useState<ThinkingLevel>("auto");
  const [compacting,setCompacting]=useState(false);
  const [compactNotice,setCompactNotice]=useState("");
  const compactRef=useRef<AbortController|null>(null);
  const selectedRef=useRef<string|null>(null);
  const detailSessionRef=useRef<string|null>(null);
  const [sessions, setSessions] = useState<HermesSession[]>([]);
  const [messages, setMessages] = useState<ChatMessage[]>([]);
  const [selected, setSelected] = useState<string | null>(null);
  useEffect(()=>{selectedRef.current=selected;},[selected]);
  useEffect(()=>{if(detailSessionRef.current!==selected)setDetail(null);setInfoError("");if(!selected){detailSessionRef.current=null;return;}const controller=new AbortController();hermesJson<HermesSessionDetail>(`/api/sessions/${encodeURIComponent(selected)}`,{signal:controller.signal}).then(data=>{if(controller.signal.aborted)return;setDetail(data);if(detailSessionRef.current!==selected){if(data.model)setModelName(data.model);let config:Record<string,unknown>={};try{config=typeof data.model_config === "string" ? JSON.parse(data.model_config) : data.model_config ?? {};}catch{}setModelProvider(typeof config.provider === "string" ? config.provider : data.billing_provider ?? "");detailSessionRef.current=selected;}}).catch(e=>{if(!controller.signal.aborted)setInfoError(e.message);});return()=>controller.abort();},[selected,infoRevision]);
  const [busy, setBusy] = useState(false);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [status, setStatus] = useState(ht("连接 Hermes…"));
  const [tools, setTools] = useState<string[]>([]);
  const [approval, setApproval] = useState<{ runId: string; requestId?: string; command?: string } | null>(null);
  const [modelName, setModelName] = useState("hermes-agent");
  const streamRef = useRef<AbortController | null>(null);
  const activeRunIdRef = useRef<string | null>(null);
  const messageRefs=useRef<(HTMLDivElement|null)[]>([]);
  const minimapMessages=useMemo(()=>messages.map(m=>({role:m.role === "tool" ? "custom" : m.role,content:m.role === "assistant" ? [{type:"text",text:m.text}] : m.text,customType:"hermes-tool",display:true} as AgentMessage)),[messages]);
  const scrollRef = useRef<HTMLDivElement>(null);
  const openSessionRef=useRef<(id:string)=>Promise<void>>(async()=>{});
  const historyRef = useRef<AbortController | null>(null);
  const chatInputRef = useRef<ChatInputHandle>(null);
  const navigatePage = (next: HermesSettingsSection | null) => {
    if (next !== page && managementDirty && !window.confirm(ht("放弃未保存的修改？"))) return;
    if (next !== page) setManagementDirty(false);
    setPage(next); setSidebarOpen(false);
  };

  const refreshSessions = useCallback(async () => {
    const response = await api(`/api/sessions?limit=50&archived=include&order=recent&offset=0`);
    const data = await response.json() as { sessions?: HermesSession[]; total?:number };
    setSessions(data.sessions ?? []);setSessionTotal(data.total ?? data.sessions?.length ?? 0);
  }, []);

  const loadMoreSessions = async()=>{try{const data=await hermesJson<{sessions:HermesSession[];total:number}>(`/api/sessions?limit=50&archived=include&order=recent&offset=${sessions.length}`);setSessions(previous=>[...new Map([...previous,...data.sessions].map(row=>[row.id,row])).values()]);setSessionTotal(data.total);}catch(e){setError(e instanceof Error?e.message:String(e));}};
  const updateSessionFlag = async(session:HermesSessionRow,flag:"pinned"|"archived")=>{if(sessionActionBusy)return;setSessionActionBusy(true);try{await hermesJson(`/api/sessions/${encodeURIComponent(session.id)}`,{method:"PATCH",body:JSON.stringify({[flag]:!session[flag]})});await refreshSessions();}catch(e){setError(e instanceof Error?e.message:String(e));}finally{setSessionActionBusy(false);}};
  const compactSession = async()=>{
    if(!selected || busy || compacting || loading)return;
    setCompacting(true);setError("");setCompactNotice("");
    const controller=new AbortController();compactRef.current=controller;
    try{const response=await fetch("/api/hermes-session/compact",{method:"POST",headers:{"Content-Type":"application/json"},body:JSON.stringify({session_id:selected}),signal:controller.signal});const result=await response.json();if(!response.ok)throw new Error(result.error || ht("压缩失败"));
      const latest=await hermesJson<{session_id?:string}>(`/api/sessions/${encodeURIComponent(selected)}/latest-descendant`);
      compactRef.current=null;await openSession(latest.session_id ?? selected);setInfoRevision(v=>v+1);await refreshSessions();setCompactNotice(ht("压缩完成：{before} → {after} 个令牌",{before:result.before_tokens ?? "—",after:result.after_tokens ?? "—"}));
    }catch(e){if(!controller.signal.aborted)setError(e instanceof Error?e.message:String(e));else setCompactNotice(ht("已请求停止压缩，请刷新会话确认结果。"));}finally{setCompacting(false);compactRef.current=null;}
  };
  useEffect(()=>{const controller=new AbortController();hermesJson<{providers:{slug:string;models?:string[]}[]}>("/api/model/options",{signal:controller.signal}).then(data=>{if(!controller.signal.aborted)setModelCatalog((data.providers ?? []).flatMap(provider=>(provider.models ?? []).map(id=>({id,name:id,provider:provider.slug,input:["text","image"]}))));}).catch(()=>{});return()=>controller.abort();},[page]);
  const bootTranslation = useEffectEvent((message: string) => ht(message));
  useEffect(() => {
    let alive = true;
    Promise.all([
      api("/api/status").then((r) => r.json()),
      api("/v1/models").then((r) => r.json()).catch(async () => {
        const info = await hermesJson<{ model?: string }>("/api/model/info");
        return { data: info.model ? [{ id: info.model }] : [], dashboardOnly: true };
      }),
      refreshSessions(),
    ]).then(([system, models]) => {
      if (!alive) return;
      const first = models.data?.[0]?.id;
      setModels((models.data ?? []).map((model: { id: string }) => model.id));
      if (first) setModelName(first);
      const sessionParam=new URLSearchParams(location.search).get("session");if(sessionParam)void openSessionRef.current(sessionParam);
      setStatus(`Hermes ${system.version ?? ""} · ${bootTranslation(models.dashboardOnly ? "管理服务已连接" : "接口已连接")}`);
      setError(models.dashboardOnly ? bootTranslation("管理功能已连接；聊天接口尚未配置，请配置 Hermes API 服务地址和密钥。") : "");
    }).catch((e: unknown) => { if (alive) { setError(e instanceof Error ? e.message : String(e)); setStatus(bootTranslation("无法连接 Hermes")); } })
      .finally(() => { if (alive) setLoading(false); });
    return () => { alive = false; streamRef.current?.abort(); historyRef.current?.abort(); compactRef.current?.abort(); };
  }, [refreshSessions]);

  useEffect(() => { scrollRef.current?.scrollTo({ top: scrollRef.current.scrollHeight, behavior: "smooth" }); }, [messages]);

  const openSession = useCallback(async (id: string) => {
    if (streamRef.current || compactRef.current) return;
    if (managementDirty && !window.confirm(ht("放弃未保存的修改？"))) return;
    setManagementDirty(false);
    historyRef.current?.abort();
    const controller = new AbortController(); historyRef.current = controller;
    setPage(null); setSidebarOpen(false);
    history.replaceState(null,"",`?session=${encodeURIComponent(id)}`);setThinking("auto"); setCompactNotice("");setSelected(id); setBusy(false); setApproval(null); setTools([]); setError("");
    setLoading(true);
    try {
      const response = await api(`/api/sessions/${encodeURIComponent(id)}/messages?limit=100&order=latest`, { signal: controller.signal });
      const body = await response.json() as { messages?: Record<string, unknown>[] };
      const rows = (body.messages ?? []).filter((row) => ["user", "assistant", "tool", "toolResult"].includes(String(row.role))).map((row) => ({ role: row.role === "user" ? "user" as const : row.role === "tool" || row.role === "toolResult" ? "tool" as const : "assistant" as const, text: textFromMessage(row), reasoning: reasoningFromMessage(row) })).filter((m) => m.text);
      if (controller.signal.aborted) return;
      setMessages(rows);
    } catch (e) { if (!controller.signal.aborted) { setError(e instanceof Error ? e.message : String(e)); setMessages([]); } }
    finally { if (!controller.signal.aborted) setLoading(false); }
  }, [managementDirty, ht]);

  useEffect(()=>{openSessionRef.current=openSession;},[openSession]);

  const send = useCallback(async (inputText: string, images?: AttachedImage[]) => {
    const prompt = inputText.trim();
    if ((!prompt && !images?.length) || busy || loading || streamRef.current) { chatInputRef.current?.restoreSubmission(prompt, images); return; }
    setError(""); setBusy(true); setTools([]); setApproval(null);
    setMessages((old) => [...old, { role: "user", text: prompt, images: images?.map(({ data, mimeType }) => ({ data, mimeType })) }, { role: "assistant", text: "" }]);
    const controller = new AbortController(); streamRef.current = controller;
    let runId = ""; let finalOutput = ""; let deltaText = "";
    try {
      const input = images?.length ? [{ role: "user", content: [{ type: "text", text: prompt }, ...images.map((image) => ({ type: "image_url", image_url: { url: `data:${image.mimeType};base64,${image.data}` } }))] }] : prompt;
      const response = await api("/v1/runs", { method: "POST", signal: controller.signal, body: JSON.stringify({ input, model: modelName, ...(modelProvider ? {provider:modelProvider}:{}), ...(thinking === "auto" ? {} : {model_options:{reasoning_effort:thinking === "off" ? "none" : thinking}}), ...(selected ? { session_id: selected } : {}) }) });
      const created = await response.json() as { run_id: string; session_id?: string };
      runId = created.run_id;
      activeRunIdRef.current = runId;
      if (!selected) setSelected(created.session_id ?? created.run_id);
      const eventsResponse = await api(`/v1/runs/${encodeURIComponent(runId)}/events`, { headers: { Accept: "text/event-stream" }, signal: controller.signal });
      if (!eventsResponse.body) throw new Error(ht("Hermes 没有返回事件流"));
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
          if (event.session_id) setSelected(event.session_id);
          if (event.event === "message.delta" && typeof event.delta === "string") {
            deltaText += event.delta;
            setMessages((old) => old.map((m, i) => i === old.length - 1 ? { ...m, text: deltaText } : m));
          } else if (event.event === "reasoning.available" && typeof event.text === "string") {
            setMessages(old => old.map((message, index) => index === old.length - 1 ? {...message, reasoning:event.text} : message));
          } else if (event.event === "tool.started") {
            setTools((old) => [...old, `${event.tool ?? ht("工具")}${event.preview ? `：${event.preview}` : ""}`]);
          } else if (event.event === "approval.request") {
            setApproval({ runId, requestId: event.approval?.request_id, command: event.approval?.command ?? event.approval?.description });
          } else if (["run.completed", "run.failed", "run.interrupted", "run.cancelled"].includes(event.event ?? "")) {
            terminal = true;
            if (event.event === "run.completed") finalOutput = event.output ?? deltaText;
            else if (event.event === "run.failed") throw new Error(event.error ?? ht("运行失败"));
          }
        }
      }
      if (!terminal) throw new Error(ht("事件流已断开；请重新打开会话查看运行结果。"));
      await reader.cancel();
      const answer = finalOutput || deltaText;
      if (answer) setMessages((old) => old.map((m, i) => i === old.length - 1 ? { ...m, text: answer } : m));
      setStatus(ht("Hermes 就绪"));
      await refreshSessions();setInfoRevision(v=>v+1);
      setFileRefreshKey((key) => key + 1);
    } catch (e) {
      if (!controller.signal.aborted) setError(e instanceof Error ? e.message : String(e));
      if (!deltaText) setMessages((old) => old.filter((m, i) => i !== old.length - 1 || Boolean(m.text)));
    } finally { controller.abort(); setBusy(false); streamRef.current = null; activeRunIdRef.current = null; setApproval(null); }
  }, [busy, loading, modelName, modelProvider, thinking, refreshSessions, selected, ht]);

  const stop = useCallback(async () => {
    const runId = activeRunIdRef.current;
    if (runId) {
      try { await api(`/v1/runs/${encodeURIComponent(runId)}/stop`, { method: "POST", body: JSON.stringify({}) }); }
      catch (e) { setError(e instanceof Error ? e.message : String(e)); return; }
    }
    streamRef.current?.abort();
  }, []);

  const respondApproval = useCallback(async (choice: "once" | "deny") => {
    if (!approval) return;
    try {
      await api(`/v1/runs/${encodeURIComponent(approval.runId)}/approval`, { method: "POST", body: JSON.stringify({ choice, ...(approval.requestId ? { request_id: approval.requestId } : {}) }) });
      setApproval(null);
    } catch (e) { setError(e instanceof Error ? e.message : String(e)); }
  }, [approval]);

  const newChat = () => { if (streamRef.current || compactRef.current) return; if (managementDirty && !window.confirm(ht("放弃未保存的修改？"))) return; setManagementDirty(false); historyRef.current?.abort(); setPage(null); setSidebarOpen(false); history.replaceState(null,"",location.pathname);setSelected(null); setThinking("auto"); setMessages([]); setBusy(false); setLoading(false); setTools([]); setApproval(null); setError(""); };

  const renameSession = async (session: HermesSessionRow) => {
    const title = window.prompt(ht("会话标题"), session.title ?? "");
    if (title === null) return;
    try { await hermesJson(`/api/sessions/${encodeURIComponent(session.id)}`, { method: "PATCH", body: JSON.stringify({ title }) }); await refreshSessions(); }
    catch (e) { setError(e instanceof Error ? e.message : String(e)); }
  };
  const deleteSession = async (session: HermesSessionRow) => {
    if (!window.confirm(ht("删除会话「{name}」？", { name: session.title || session.id }))) return;
    try { await hermesJson(`/api/sessions/${encodeURIComponent(session.id)}`, { method: "DELETE" }); if (selectedRef.current === session.id) newChat(); await refreshSessions(); }
    catch (e) { setError(e instanceof Error ? e.message : String(e)); }
  };
  const loadFullHistory = async () => {
    if (!selected || busy) return;
    historyRef.current?.abort();
    const controller = new AbortController(); historyRef.current = controller;
    setLoading(true); setError("");
    try {
      const rows: Record<string, unknown>[] = [];
      for (let offset = 0; ; offset += 500) {
        const body = await hermesJson<{ messages?: Record<string, unknown>[] }>(`/api/sessions/${encodeURIComponent(selected)}/messages?limit=500&order=oldest&offset=${offset}`, { signal: controller.signal });
        const pageRows = body.messages ?? [];
        rows.push(...pageRows);
        if (pageRows.length < 500) break;
      }
      if (!controller.signal.aborted) setMessages(rows.filter((row) => ["user", "assistant", "tool", "toolResult"].includes(String(row.role))).map((row) => ({ role: row.role === "user" ? "user" : row.role === "assistant" ? "assistant" : "tool", text: textFromMessage(row), reasoning: reasoningFromMessage(row) })));
    } catch (e) { if (!controller.signal.aborted) setError(e instanceof Error ? e.message : String(e)); }
    finally { if (!controller.signal.aborted) setLoading(false); }
  };
  const loadSkillDormancy = useCallback(async () => {
    const skills = await hermesJson<{ name: string; enabled?: boolean }[]>("/api/skills");
    return Object.fromEntries(skills.map((skill) => [skill.name, skill.enabled === false]));
  }, []);
  const openFile = (path: string) => { setFilePath(path); setSidebarOpen(false); };

  return <main className={`hermes-layout ${sidebarOpen ? "sidebar-visible" : ""} ${!desktopSidebarOpen ? "sidebar-desktop-hidden" : ""}`}>
    {sidebarOpen && <button className="hermes-sidebar-backdrop" aria-label={ht("关闭侧栏")} onClick={() => setSidebarOpen(false)} />}
    <div className="hermes-sidebar-host" inert={page !== null}>
      <HermesSidebar sessions={sessions} selected={selected} busy={busy || compacting || sessionActionBusy} loading={loading} onPin={session=>void updateSessionFlag(session,"pinned")} onArchive={session=>void updateSessionFlag(session,"archived")} hasMore={sessions.length < sessionTotal} onLoadMore={()=>void loadMoreSessions()} cwd={cwd} onCwdChange={setCwd} onNew={newChat} onSelect={(id) => void openSession(id)} onSettings={navigatePage} onOpenFile={openFile} onOpenTerminal={(dir) => { if (!terminal) setTerminal(newTerminalTab(dir)); setSidebarOpen(false); }} onMention={(path) => chatInputRef.current?.insertText(`@${path} `)} onRename={(session) => void renameSession(session)} onDelete={(session) => void deleteSession(session)} onClose={() => setSidebarOpen(false)} refreshKey={fileRefreshKey} />
    </div>
    <section className="hermes-main" inert={page !== null}>
      <header className="hermes-top"><button className="hermes-toolbar-icon" aria-label={isMobile || !desktopSidebarOpen ? ht("打开侧栏") : ht("收起侧栏")} onClick={() => isMobile ? setSidebarOpen(true) : setDesktopSidebarOpen(!desktopSidebarOpen)}><HermesUiIcon name="sidebar" /></button>
        <button className="hermes-toolbar-action" disabled={!selected || busy || loading} onClick={() => void loadFullHistory()}><HermesUiIcon name="history" /><span>{ht("完整历史")}</span></button>
        <button className="hermes-toolbar-action" disabled={!selected || busy} onClick={() => { const session = sessions.find((s) => s.id === selected); if (session) void renameSession(session); }}><PencilIcon /><span>{ht("重命名")}</span></button>
        <button className="hermes-toolbar-action" onClick={() => navigatePage("config")}><HermesUiIcon name="settings" /><span>{ht("系统")}</span></button>
        <button className="hermes-toolbar-action" onClick={() => navigatePage("tools")}><HermesUiIcon name="tools" /><span>{ht("工具")}</span></button>
        <span className="hermes-top-status" title={status}>{busy ? ht("运行中…") : compacting ? ht("正在压缩…") : ""}</span><button className="hermes-usage-button" aria-label={ht("会话信息与用量")} aria-expanded={infoOpen} onClick={()=>setInfoOpen(!infoOpen)}><span>↑ {detail?.input_tokens?.toLocaleString() ?? "—"}</span><span>↓ {detail?.output_tokens?.toLocaleString() ?? "—"}</span><span>{ht("缓存")} {detail?.cache_read_tokens?.toLocaleString() ?? "—"}</span><span>{(detail?.actual_cost_usd ?? detail?.estimated_cost_usd) == null ? "—" : `$${(detail?.actual_cost_usd ?? detail?.estimated_cost_usd)!.toFixed(4)}`}</span><HermesUiIcon name="sidebar"/></button>
      </header>
      {infoOpen && <HermesSessionInfo detail={detail} sessionId={selected} cwd={cwd} error={infoError} onRefresh={()=>setInfoRevision(v=>v+1)}/>}
      <div className={`hermes-chat ${!messages.length ? "is-empty" : ""}`} dir={display.direction} style={{"--hermes-user-transparency":`${display.bubbleTransparency}%`} as CSSProperties}>
        <div className="hermes-messages" ref={scrollRef}>
          {loading ? <div className="hermes-muted">{ht("正在读取 Hermes 会话…")}</div> : <div className="hermes-message-list">{messages.map((m, i) => <div ref={element=>{messageRefs.current[i]=element;}} key={`${i}-${m.role}`} className={m.role === "user" ? "hermes-user-row" : "hermes-assistant-row"}>{display.showReasoning && m.reasoning && <details className="hermes-reasoning" open={!display.collapseReasoning}><summary>{ht("推理过程")}</summary><MarkdownBody>{m.reasoning}</MarkdownBody></details>}<MessageView message={m.role === "user" ? { role: "user", content: m.images?.length ? [{ type: "text", text: m.text }, ...m.images.map((image) => ({ type: "image" as const, source: { type: "base64" as const, media_type: image.mimeType, data: image.data } }))] : m.text } : m.role === "tool" ? { role: "custom", customType: "hermes-tool", display: true, content: m.text } : { role: "assistant", content: [{ type: "text", text: m.text || (busy ? ht("思考中…") : "") }], model: modelName, provider: "hermes" }} isStreaming={busy && i === messages.length - 1} onOpenFile={openFile} cwd={cwd ?? undefined} /></div>)}</div>}
          {tools.length > 0 && <details className="hermes-tool-activity" open={busy}><summary>{ht("工具活动 ·")}{tools.length}</summary>{tools.map((tool, i) => <pre key={i}>{display.toolDetails ? tool : tool.split("：")[0]}</pre>)}</details>}
          {approval && <div className="hermes-approval"><strong>{ht("Hermes 需要你的确认")}</strong><pre>{approval.command || ht("即将执行一项受保护的操作。")}</pre><div><button onClick={() => void respondApproval("deny")}>{ht("拒绝")}</button><button onClick={() => void respondApproval("once")}>{ht("允许一次")}</button></div></div>}
          {compactNotice && <div className="hermes-compact-notice" role="status">{compactNotice}</div>}{error && <div className="hermes-error" role="alert">{error}</div>}
        </div>
        {!loading && !messages.length && <div className="hermes-new-session-brand"><div className="new-session-brand"><span className="hermes-logo" aria-hidden="true">H</span><div className="new-session-brand-text"><span className="new-session-brand-name">Hermes Web</span><span className="new-session-meta">Hermes Agent · Pi Web</span></div></div></div>}
        <ChatMinimap messages={minimapMessages} getStreamingMessage={()=>null} scrollContainer={scrollRef} messageRefs={messageRefs} onRevealHistory={()=>void loadFullHistory()} turnsBefore={0}/>
        <ChatInput ref={chatInputRef} onSend={(text, images) => void send(text, images)} onAbort={() => compacting ? compactRef.current?.abort() : void stop()} isStreaming={busy || compacting} thinkingAutoLabel={ht("跟随默认")} isAutoThinkingSelection={thinking === "auto"} thinkingLevel={thinking} onThinkingLevelChange={setThinking} availableThinkingLevels={["off","minimal","low","medium","high","xhigh","max"]} thinkingLevelMap={{off:ht("关闭"),minimal:ht("最低"),low:ht("低"),medium:ht("中"),high:ht("高"),xhigh:ht("很高"),max:ht("最高")}} onCompact={selected && !loading ? ()=>void compactSession() : undefined} model={{ provider: modelProvider || "hermes", modelId: modelName }} modelList={[...modelCatalog,...models.filter(id=>!modelCatalog.some(item=>item.id === id)).map((id) => ({ id, name: id, provider: "hermes", input: ["text", "image"] }))]} onModelChange={(provider,id) => {setModelName(id);setModelProvider(provider === "hermes" ? "" : provider);}} draftKey={`hermes:${selected ?? "new"}`} cwd={cwd} loadSkillDormancy={loadSkillDormancy} />
      </div>
    </section>
    {filePath && <aside className="hermes-file-panel" aria-label={ht("文件预览")} inert={page !== null}><header><span>{filePath.split(/[\\/]/).at(-1)}</span><button aria-label={ht("关闭文件预览")} onClick={() => setFilePath(null)}>×</button></header><FileViewer filePath={filePath} cwd={cwd ?? undefined} onOpenFile={openFile} /></aside>}
    {terminal && <aside className="hermes-file-panel" aria-label={ht("终端")} inert={page !== null}><header><span>{ht("终端 ·")}{terminal.cwd}</span><button aria-label={ht("关闭终端")} onClick={() => setTerminal({ ...terminal, closing: "close" })}>×</button></header><TerminalPanel tab={terminal} active onRestart={() => setTerminal({ ...terminal, closing: "restart" })} onClosed={() => setTerminal(terminal.closing === "restart" ? newTerminalTab(terminal.cwd) : null)} onCloseError={() => { setTerminal({ ...terminal, closing: undefined }); setError(ht("关闭终端失败")); }} /></aside>}
    {page && <HermesSettingsDialog section={page} onSectionChange={navigatePage} onClose={() => navigatePage(null)} onDirtyChange={setManagementDirty} models={models} model={modelName} onModelChange={id=>{setModelName(id);setModelProvider("");}} modelBusy={busy || compacting} />}
  </main>;
}
