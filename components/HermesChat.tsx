"use client";

import { useHermesI18n } from "@/hooks/useHermesI18n";

import { useCallback, useMemo, useEffect, useEffectEvent, useRef, useState, type CSSProperties } from "react";
import { hermesChat } from "@/lib/hermes-chat-client";
import { HermesSessionInfo, HermesSessionUsageButton, type HermesSessionDetail } from "./HermesSessionInfo";
import { HermesSystemPrompt } from "./HermesSystemPrompt";
import { FileText } from "lucide-react";
import { HermesSettingsDialog, type HermesSettingsSection } from "./HermesSettingsDialog";
import { HermesSidebar, HermesUiIcon, type HermesSessionRow } from "./HermesSidebar";
import { ChatInput, type AttachedImage, type ChatInputHandle } from "./ChatInput";
import { HermesRightPanel, type HermesRightPanelHandle } from "./HermesRightPanel";
import { HermesActivityRail, type HermesWorkspaceView } from "./HermesActivityRail";
import { HermesWorkspacePage } from "./HermesWorkspacePage";
import { hermesApi as api, hermesJson } from "@/lib/hermes-client";
import { PencilIcon } from "./SidebarIcons";
import { ChatMinimap, useMessageRefs } from "./ChatMinimap";
import type { AgentMessage } from "@/lib/types";
import { MessageView } from "./MessageView";
import { HermesToolMessage } from "./HermesToolMessage";
import { hermesChatMessages, type HermesChatMessage } from "@/lib/hermes-chat-messages";
import { I18nProvider } from "@/hooks/useI18n";
import { useFontPreferences } from "@/hooks/useFontPreferences";
import { useHermesFontSizes } from "@/hooks/useHermesFontSizes";
import { useHermesChatDisplay } from "@/hooks/useHermesChatDisplay";
import { MarkdownBody } from "./MarkdownBody";
import { useTheme } from "@/hooks/useTheme";
import { useViewportHeight } from "@/hooks/useViewportHeight";
import { useIsMobile } from "@/hooks/useIsMobile";
import { loadCurrentHermesProject, rememberHermesProject } from "@/lib/hermes-project-preferences";
import { readHermesRun, rememberRun, rememberedRun, type RunRecord } from "@/lib/hermes-run-stream";
import { listHermesConversations } from "@/lib/hermes-conversations";
import { loadHermesModelSelection, rememberHermesModelSelection, forgetHermesModelSelection, sessionHermesModelSelection, type HermesModelSelection } from "@/lib/hermes-model-preferences";
import { hermesModelOptionsPath, hermesEndpointModels, sameHermesProvider, type HermesModelEndpoint, type HermesModelOptions } from "@/lib/hermes-model-catalog";
import { HermesClarify, type ClarifyRequest } from "./HermesClarify";
import { HermesAvatar } from "./HermesAvatar";
import { HERMES_COMMANDS, runHermesCommand } from "@/lib/hermes-commands";
import { matchesHermesSearch, type HermesSearchMatch } from "@/lib/hermes-search";
import { useHermesAttachments } from "@/hooks/useHermesAttachments";
import { useDragDrop } from "@/hooks/useDragDrop";
import { DirectoryPicker } from "./DirectoryPicker";
import { copyText } from "@/lib/clipboard";
import { buildAtMentionText } from "@/lib/file-fuzzy";
import { RefreshCw, X } from "lucide-react";

type HermesSession = HermesSessionRow;
type ThinkingLevel = "auto" | "off" | "minimal" | "low" | "medium" | "high" | "xhigh" | "max";
type ChatMessage = HermesChatMessage;
type RunEvent = { event?: string; run_id?: string; session_id?: string; delta?: string; text?: string; reasoning?: string; tools?: string[]; clarify?: ClarifyRequest | null; request_id?: string; output?: string; status?: string; tool?: string; preview?: string; error?: string; approval?: { request_id?: string; command?: string; description?: string; choices?: string[] } };

const revealRenderedHistory = () => {};

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
  const [workspaceView,setWorkspaceView]=useState<HermesWorkspaceView>("home");
  const [sidebarOpen, setSidebarOpen] = useState(false);
  const [desktopSidebarOpen, setDesktopSidebarOpen] = useState(true);
  const [cwd, setCwd] = useState<string | null>(null);
  const [projectBranch, setProjectBranch] = useState("");
  const [projectBusy, setProjectBusy] = useState(false);
  const projectBusyRef = useRef(false);
  const [directoryUnavailable, setDirectoryUnavailable] = useState(false);
  const [mappedProject, setMappedProject] = useState(false);
  const [rightPanelExpanded,setRightPanelExpanded]=useState(false);
  const [rightPanelOpen,setRightPanelOpen]=useState(false);
  const rightPanelRef=useRef<HermesRightPanelHandle>(null);
  const [fileRefreshKey, setFileRefreshKey] = useState(0);
  const [modelCatalog,setModelCatalog]=useState<{id:string;name:string;provider:string;input?:string[]}[]>([]);
  const [modelProvider,setModelProvider]=useState("");
  const defaultModelRef = useRef<HermesModelSelection>({ model: "hermes-agent", provider: "" });
  const [models, setModels] = useState<string[]>([]);
  const [managementDirty, setManagementDirty] = useState(false);
  const [sessionActionBusy,setSessionActionBusy]=useState(false);
  const [sessionTotal,setSessionTotal]=useState(0);
  const [infoOpen,setInfoOpen]=useState(false);
  const [systemOpen,setSystemOpen]=useState(false);
  const systemButtonRef=useRef<HTMLButtonElement>(null);
  const closeSystemPrompt=useCallback(()=>setSystemOpen(false),[]);
  const [detail,setDetail]=useState<HermesSessionDetail|null>(null);
  const [detailOwner,setDetailOwner]=useState<string|null>(null);
  const usageButtonRef=useRef<HTMLButtonElement>(null);
  const closeSessionInfo=useCallback(()=>setInfoOpen(false),[]);
  const [infoError,setInfoError]=useState("");
  const [infoRevision,setInfoRevision]=useState(0);
  const [thinking,setThinking]=useState<ThinkingLevel>("auto");
  const [compacting,setCompacting]=useState(false);
  const [compactNotice,setCompactNotice]=useState("");
  const compactRef=useRef<AbortController|null>(null);
  const selectedRef=useRef<string|null>(null);
  const detailSessionRef=useRef<string|null>(null);
  const [sessions, setSessions] = useState<HermesSession[]>([]);
  const [sessionsRevision, setSessionsRevision] = useState(0);
  const [messages, setMessages] = useState<ChatMessage[]>([]);
  const [searchFocus, setSearchFocus] = useState<{ index: number; query: string } | null>(null);
  const attachmentBusyRef = useRef(false);
  const [selected, setSelected] = useState<string | null>(null);
  const [drafts, setDrafts] = useState<HermesSessionRow[]>([]);
  const [activeDraftId, setActiveDraftId] = useState<string | null>(null);
  const currentDetail=detailOwner===selected ? detail : null;
  useEffect(()=>{selectedRef.current=selected;},[selected]);
  useEffect(()=>{
    if(detailSessionRef.current!==selected)setDetail(null);
    setInfoError("");
    if(!selected){detailSessionRef.current=null;return;}
    const controller=new AbortController();
    hermesJson<HermesSessionDetail>(`/api/sessions/${encodeURIComponent(selected)}`,{signal:controller.signal}).then(data=>{
      if(controller.signal.aborted)return;
      setDetail(data);setDetailOwner(selected);
      if(detailSessionRef.current!==selected){
        const choice = loadHermesModelSelection(selected) ?? sessionHermesModelSelection(data);
        if (choice) applyModelSelection(choice);
        detailSessionRef.current=selected;
      }
    }).catch(e=>{if(!controller.signal.aborted)setInfoError(e.message);});
    return()=>controller.abort();
  },[selected,infoRevision]);
  const [busy, setBusy] = useState(false);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [status, setStatus] = useState(ht("连接 Hermes…"));
  const [tools, setTools] = useState<string[]>([]);
  const [approval, setApproval] = useState<{ runId: string; requestId?: string; command?: string } | null>(null);
  const [clarify, setClarify] = useState<ClarifyRequest | null>(null);
  const restoreRunRef = useRef<() => Promise<void>>(async () => {});
  const [modelName, setModelName] = useState("hermes-agent");
  function applyModelSelection(choice: HermesModelSelection) {
    setModelName(choice.model); setModelProvider(choice.provider);
  }
  function changeModel(model: string, provider = "", asDefault = false) {
    if (busy || compacting || loading) return;
    const choice = { model, provider: provider === "hermes" ? "" : provider };
    rememberHermesModelSelection(selected ?? activeDraftId, choice);
    if (asDefault) defaultModelRef.current = choice;
    if (asDefault || !selected) rememberHermesModelSelection(null, choice);
    applyModelSelection(choice);
  }
  const streamRef = useRef<AbortController | null>(null);
  const activeRunIdRef = useRef<string | null>(null);
  const projectRunRef = useRef(false);
  const minimapMessages=useMemo(()=>messages.filter(m=>m.role!=="tool").map(m=>({role:m.role,content:m.role === "assistant" ? [{type:"text",text:m.text}] : m.text} as AgentMessage)),[messages]);
  const minimapHistory=useMemo(()=>busy && minimapMessages.at(-1)?.role==="assistant" ? minimapMessages.slice(0,-1) : minimapMessages,[busy,minimapMessages]);
  const getMinimapStreamingMessage=useCallback(()=>busy && minimapMessages.at(-1)?.role==="assistant" ? minimapMessages.at(-1)! : null,[busy,minimapMessages]);
  // Pi's minimap consumes refs for user/assistant entries only, skipping tool output.
  const minimapRefIndexes=useMemo(()=>{let index=0;return messages.map(m=>m.role==="tool" ? null : index++);},[messages]);
  const messageRefs=useMessageRefs(minimapMessages.length);
  const followTailRef=useRef(true);
  const scrollRef = useRef<HTMLDivElement>(null);
  const openSessionRef=useRef<(id:string)=>Promise<void>>(async()=>{});
  const historyRef = useRef<AbortController | null>(null);
  const chatInputRef = useRef<ChatInputHandle>(null);
  const navigatePage = (next: HermesSettingsSection | null) => {
    if (next !== page && managementDirty && !window.confirm(ht("放弃未保存的修改？"))) return;
    if (next !== page) setManagementDirty(false);
    if(next)setWorkspaceView("home");
    setPage(next); setSidebarOpen(false); setSystemOpen(false);
  };
  const navigateWorkspace=(next:HermesWorkspaceView)=>{
    if(next===workspaceView)return;
    if(managementDirty && !window.confirm(ht("放弃未保存的修改？")))return;
    setManagementDirty(false);setWorkspaceView(next);setSidebarOpen(false);setSystemOpen(false);
  };

  const refreshSessions = useCallback(async () => {
    const data = await listHermesConversations<HermesSession>();
    setSessions(data.sessions ?? []);setSessionTotal(data.total ?? data.sessions?.length ?? 0);setSessionsRevision(value=>value+1);
  }, []);

  const loadMoreSessions = async()=>{try{const data=await listHermesConversations<HermesSession>(sessions.length);setSessions(previous=>[...new Map([...previous,...data.sessions].map(row=>[row.id,row])).values()]);setSessionTotal(data.total);}catch(e){setError(e instanceof Error?e.message:String(e));}};
  const updateSessionFlag = async(session:HermesSessionRow,flag:"pinned"|"archived")=>{if(sessionActionBusy)return;setSessionActionBusy(true);try{await hermesJson(`/api/sessions/${encodeURIComponent(session.id)}`,{method:"PATCH",body:JSON.stringify({[flag]:!session[flag]})});await refreshSessions();}catch(e){setError(e instanceof Error?e.message:String(e));}finally{setSessionActionBusy(false);}};
  const compactSession = async()=>{
    if(!selected || busy || compacting || loading || attachmentBusyRef.current)return false;
    setCompacting(true);setError("");setCompactNotice("");
    const controller=new AbortController();compactRef.current=controller;
    try{const response=await fetch("/api/hermes-session/compact",{method:"POST",headers:{"Content-Type":"application/json"},body:JSON.stringify({session_id:selected}),signal:controller.signal});const result=await response.json();if(!response.ok)throw new Error(result.error || ht("压缩失败"));
      const latest=await hermesJson<{session_id?:string}>(`/api/sessions/${encodeURIComponent(selected)}/latest-descendant`);
      compactRef.current=null;await openSession(latest.session_id ?? selected);setInfoRevision(v=>v+1);await refreshSessions();setCompactNotice(ht("压缩完成：{before} → {after} 个令牌",{before:result.before_tokens ?? "—",after:result.after_tokens ?? "—"}));return true;
    }catch(e){if(!controller.signal.aborted)setError(e instanceof Error?e.message:String(e));else setCompactNotice(ht("已请求停止压缩，请刷新会话确认结果。"));return false;}finally{setCompacting(false);compactRef.current=null;}
  };
  useEffect(() => {
    const controller = new AbortController();
    Promise.all([
      hermesJson<HermesModelOptions>(hermesModelOptionsPath(), { signal: controller.signal }),
      hermesJson<{ endpoints: HermesModelEndpoint[] }>("/api/providers/custom-endpoints", { signal: controller.signal }).catch(() => ({ endpoints: [] })),
    ]).then(([options, saved]) => {
      if (controller.signal.aborted) return;
      setModelCatalog([
        ...saved.endpoints.flatMap(endpoint => hermesEndpointModels(endpoint, options.providers ?? []).map(id => ({ id, name: id, provider: endpoint.id, input: ["text", "image"] }))),
        ...(options.providers ?? []).filter(provider => !saved.endpoints.some(endpoint => sameHermesProvider(endpoint.id, provider.slug))).flatMap(provider => (provider.models ?? []).map(id => ({ id, name: id, provider: provider.slug, input: ["text", "image"] }))),
      ]);
    }).catch(() => {});
    return () => controller.abort();
  }, [page]);
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
      hermesJson<HermesModelOptions>(hermesModelOptionsPath()).catch(() => null),
    ]).then(async ([system, models, , defaults]) => {
      if (!alive) return;
      const first = models.data?.[0]?.id;
      setModels((models.data ?? []).map((model: { id: string }) => model.id));
      defaultModelRef.current = { model: defaults?.model || first || "hermes-agent", provider: defaults?.provider ?? "" };
      applyModelSelection(loadHermesModelSelection(null) ?? defaultModelRef.current);
      const sessionParam=new URLSearchParams(location.search).get("session");if(sessionParam)await openSessionRef.current(sessionParam);
      setStatus(`Hermes ${system.version ?? ""} · ${bootTranslation(models.dashboardOnly ? "管理服务已连接" : "接口已连接")}`);
      setError(models.dashboardOnly ? bootTranslation("普通聊天尚未配置接口服务；选择项目文件夹后可通过 Hermes 桌面服务聊天。") : "");
      const savedProject = loadCurrentHermesProject();
      if (!sessionParam && !rememberedRun() && savedProject) {
        try {
          const project = await hermesChat.bindProject<{cwd:string;branch?:string;mapped?:boolean}>({cwd:savedProject});
          if (!alive) return;
          setCwd(project.cwd);setProjectBranch(project.branch ?? "");setMappedProject(Boolean(project.mapped));
          rememberHermesProject(project.cwd);
        } catch {
          if (!alive) return;
          rememberHermesProject(null);
          setError(bootTranslation("上次使用的文件夹无法访问，请重新选择文件夹。"));
        }
      }
      if (alive) await restoreRunRef.current();
    }).catch((e: unknown) => { if (alive) { setError(e instanceof Error ? e.message : String(e)); setStatus(bootTranslation("无法连接 Hermes")); } })
      .finally(() => { if (alive) setLoading(false); });
    return () => { alive = false; streamRef.current?.abort(); historyRef.current?.abort(); compactRef.current?.abort(); };
  }, [refreshSessions]);

  useEffect(() => {
    if (!loading && followTailRef.current) scrollRef.current?.scrollTo({ top: scrollRef.current.scrollHeight });
  }, [messages, loading]);

  const openSession = useCallback(async (id: string, match?: HermesSearchMatch) => {
    if (streamRef.current || compactRef.current || projectBusyRef.current || attachmentBusyRef.current) return;
    if (managementDirty && !window.confirm(ht("放弃未保存的修改？"))) return;
    setManagementDirty(false);
    historyRef.current?.abort();
    const controller = new AbortController(); historyRef.current = controller;
    followTailRef.current=!match;setSearchFocus(null);
    setPage(null); setWorkspaceView("home"); setSidebarOpen(false); setSystemOpen(false);
    history.replaceState(null,"",`?session=${encodeURIComponent(id)}`);setInfoOpen(false);setThinking("auto"); setCompactNotice("");setSelected(id);setActiveDraftId(null); setBusy(false); setApproval(null); setTools([]); setError("");
    setLoading(true);
    setCwd(null); setProjectBranch(""); setDirectoryUnavailable(true); setMappedProject(false);
    let historyLoaded = false;
    try {
      const [response, session] = await Promise.all([
        api(`/api/sessions/${encodeURIComponent(id)}/messages?${match ? "limit=500&order=oldest&include_compacted=true&offset=0" : "limit=100&order=latest"}`, { signal: controller.signal }),
        hermesJson<HermesSessionDetail>(`/api/sessions/${encodeURIComponent(id)}`, { signal: controller.signal }),
      ]);
      const body = await response.json() as { messages?: Record<string, unknown>[] };
      const history = [...(body.messages ?? [])];
      if (match && history.length === 500) {
        for (let offset = 500; ; offset += 500) {
          const page = await hermesJson<{messages?:Record<string,unknown>[]}>(`/api/sessions/${encodeURIComponent(id)}/messages?limit=500&order=oldest&include_compacted=true&offset=${offset}`, {signal:controller.signal});
          history.push(...(page.messages ?? []));
          if ((page.messages?.length ?? 0) < 500) break;
        }
      }
      const rows = hermesChatMessages(history);
      if (controller.signal.aborted) return;
      setMessages(rows);
      if (match) {
        const index = rows.findIndex(row => matchesHermesSearch(row.text, match.query));
        if (index >= 0) setSearchFocus({ index, query: match.query });
        else setCompactNotice(ht("已打开会话，未在当前历史中定位到匹配消息。"));
      }
      historyLoaded = true;
      if (session.cwd) {
        const validation = await fetch("/api/cwd/validate", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ cwd: session.cwd, hermes: true }), signal: controller.signal });
        const directory = await validation.json();
        if (!validation.ok || !directory.cwd) throw new Error(ht("此会话的项目文件夹无法访问，请重新选择文件夹。"));
        if (controller.signal.aborted) return;
        setCwd(directory.cwd); setProjectBranch(session.git_branch ?? ""); setMappedProject(Boolean(directory.mapped));
        rememberHermesProject(directory.cwd);
      }
      else rememberHermesProject(null);
      setDirectoryUnavailable(false);
    } catch (e) { if (!controller.signal.aborted) { setError(e instanceof Error ? e.message : String(e)); if (!historyLoaded) setMessages([]); } }
    finally { if (!controller.signal.aborted) setLoading(false); }
  }, [managementDirty, ht]);

  useEffect(()=>{openSessionRef.current=openSession;},[openSession]);
  useEffect(() => {
    if (!searchFocus || loading) return;
    const frame = requestAnimationFrame(() => scrollRef.current?.querySelector("[data-search-match=true]")?.scrollIntoView({ block: "center" }));
    return () => cancelAnimationFrame(frame);
  }, [searchFocus, loading]);

  const changeProjectDirectory = async (path: string | null) => {
    if (projectBusyRef.current || streamRef.current || compactRef.current || loading || attachmentBusyRef.current) throw new Error(ht("请等待当前操作完成后再切换项目文件夹。"));
    if (!path) {
      if (selected) throw new Error(ht("已有会话需要选择有效的项目文件夹。"));
      setCwd(null); setProjectBranch(""); setDirectoryUnavailable(false); setMappedProject(false); rememberHermesProject(null); return;
    }
    projectBusyRef.current = true; setProjectBusy(true);
    try {
      const result = await hermesChat.bindProject<{ cwd: string; branch?: string; mapped?: boolean }>({ cwd: path, ...(selected ? { session_id: selected } : {}) });
      setCwd(result.cwd); setProjectBranch(result.branch ?? ""); setDirectoryUnavailable(false); setMappedProject(Boolean(result.mapped));
      rememberHermesProject(result.cwd);
      if (activeDraftId) setDrafts(previous => previous.map(draft => draft.id === activeDraftId ? {...draft,cwd:result.cwd,git_branch:result.branch} : draft));
      setFileRefreshKey(key => key + 1); setInfoRevision(key => key + 1);
      setError("");
    } finally { projectBusyRef.current = false; setProjectBusy(false); }
  };

  const consumeRun = useCallback(async (response: Response, controller: AbortController, run: RunRecord, progress?: (text: string) => void, modelSelection?: HermesModelSelection) => {
    let text = "", failure = "", terminal = false, promoted = false;
    const showText = (reasoning?: string) => {
      progress?.(text);
      setMessages(old => old.map((message, index) => index === old.length - 1 ? { ...message, text, ...(reasoning === undefined ? {} : { reasoning }) } : message));
    };
    await readHermesRun<RunEvent>(response, controller.signal, cursor => hermesChat.observe(run, controller.signal, cursor), event => {
      if (event.run_id) { run.runId = event.run_id; progress?.(text); }
      if (event.session_id) {
        if (modelSelection) rememberHermesModelSelection(event.session_id, modelSelection);
        run.sessionId = event.session_id; setSelected(event.session_id); history.replaceState(null, "", `?session=${encodeURIComponent(event.session_id)}`);
        if (activeDraftId && !promoted) {
          promoted = true;
          const draft = drafts.find(item => item.id === activeDraftId);
          setDrafts(previous => previous.filter(item => item.id !== activeDraftId));setActiveDraftId(null);
          if (draft) setSessions(previous => [{...draft,id:event.session_id!,draft:false},...previous.filter(item => item.id !== event.session_id)]);
        }
      }
      activeRunIdRef.current = run.runId;
      if (run.runId && run.sessionId) rememberRun(run);
      if (event.event === "run.snapshot") {
        text = event.text ?? ""; showText(event.reasoning ?? ""); setTools(event.tools ?? []);
        setApproval(event.approval ? { runId: run.runId, requestId: event.approval.request_id, command: event.approval.command ?? event.approval.description } : null);
        setClarify(event.clarify ?? null);
        terminal = event.status !== "running"; failure = event.error ?? (event.status === "run.failed" ? ht("运行失败") : "");
      } else if (event.event === "message.delta") { text += event.delta ?? ""; showText(); }
      else if (event.event === "reasoning.available") showText(event.text ?? "");
      else if (event.event === "tool.started") setTools(old => [...old, `${event.tool ?? ht("工具")}${event.preview ? `：${event.preview}` : ""}`]);
      else if (event.event === "approval.request") setApproval({ runId: run.runId, requestId: event.approval?.request_id, command: event.approval?.command ?? event.approval?.description });
      else if (event.event === "clarify.request") setClarify(event.clarify ?? null);
      else if (event.event === "request.cancel") { setClarify(old => old?.request_id === event.request_id ? null : old); setApproval(old => old?.requestId === event.request_id ? null : old); }
      else if (["run.completed", "run.failed", "run.interrupted", "run.cancelled"].includes(event.event ?? "")) {
        terminal = true; failure = event.error ?? (event.event === "run.failed" ? ht("运行失败") : "");
        if (event.output !== undefined) { text = event.output; showText(); }
      }
    }, () => setStatus(ht("连接已断开，正在恢复…")));
    if (terminal) {
      rememberRun(null);
      if (!failure && run.sessionId) forgetHermesModelSelection(run.sessionId);
    }
    if (failure) throw new Error(failure);
    return text;
  }, [ht, activeDraftId, drafts]);

  useEffect(() => {
    restoreRunRef.current = async () => {
      const run = rememberedRun();
      if (!run || streamRef.current) return;
      const requested = new URLSearchParams(location.search).get("session");
      if (requested && requested !== run.sessionId) return;
      await openSessionRef.current(run.sessionId);
      const controller = new AbortController(); streamRef.current = controller;
      projectRunRef.current = run.project; activeRunIdRef.current = run.runId;
      setBusy(true); setLoading(false); setError("");
      setMessages(old => old.at(-1)?.role === "assistant" ? old : [...old, { role: "assistant", text: "" }]);
      try {
        const response = await hermesChat.observe(run, controller.signal);
        if (response.status === 404) { rememberRun(null); throw new Error(ht("运行恢复记录已过期，已显示保存的会话。")); }
        await consumeRun(response, controller, run); setStatus(ht("Hermes 就绪")); await refreshSessions();
      } catch (error) { if (!controller.signal.aborted) setError(error instanceof Error ? error.message : String(error)); }
      finally { controller.abort(); streamRef.current = null; activeRunIdRef.current = null; projectRunRef.current = false; setBusy(false); setApproval(null); setClarify(null); setInfoRevision(v => v + 1); }
    };
  }, [consumeRun, ht, refreshSessions]);

  const send = useCallback(async (inputText: string, images?: AttachedImage[]) => {
    const prompt = inputText.trim();
    if (images?.length && /^\/[A-Za-z][A-Za-z0-9-]*(?:\s|$)/.test(prompt)) {
      setError(ht("命令不能与图片附件一起发送，请先移除图片。")); chatInputRef.current?.restoreSubmission(prompt, images); return;
    }
    if ((!prompt && !images?.length) || busy || loading || streamRef.current || projectBusyRef.current || directoryUnavailable || attachmentBusyRef.current) { chatInputRef.current?.restoreSubmission(prompt, images); return; }
    const draftTitle=drafts.find(draft=>draft.id===activeDraftId)?.title;
    setError(""); setSearchFocus(null); setBusy(true); setTools([]); setApproval(null); setClarify(null);
    followTailRef.current=true;
    setMessages((old) => [...old, { role: "user", text: prompt, images: images?.map(({ data, mimeType }) => ({ data, mimeType })) }, { role: "assistant", text: "" }]);
    const controller = new AbortController(); streamRef.current = controller;
    let finalOutput = ""; let deltaText = ""; let runStarted = false;
    try {
      projectRunRef.current = Boolean(cwd);
      const { response: eventsResponse, run: record } = await hermesChat.start({ text: prompt, cwd, model: modelName, provider: modelProvider, thinking, sessionId: selected, images }, controller.signal, run => {
        runStarted = true;
        activeRunIdRef.current = run.runId;
        rememberRun(run);
        rememberHermesModelSelection(run.sessionId, { model: modelName, provider: modelProvider });
        if (!selected) setSelected(run.sessionId);
      });
      finalOutput = await consumeRun(eventsResponse, controller, record, text => { deltaText = text; runStarted = true; }, { model: modelName, provider: modelProvider });
      const answer = finalOutput || deltaText;
      if (answer) setMessages((old) => old.map((m, i) => i === old.length - 1 ? { ...m, text: answer } : m));
      if (draftTitle && draftTitle!==ht("新会话")) {
        try {await hermesJson(`/api/sessions/${encodeURIComponent(record.sessionId)}`,{method:"PATCH",body:JSON.stringify({title:draftTitle})});}
        catch (error) {setError(error instanceof Error?error.message:String(error));}
      }
      setStatus(ht("Hermes 就绪"));
      await refreshSessions();
      setFileRefreshKey((key) => key + 1);
    } catch (e) {
      if (!controller.signal.aborted) setError(e instanceof Error ? e.message : String(e));
      if (!runStarted) { setMessages(old => old.slice(0, -2)); chatInputRef.current?.restoreSubmission(prompt, images); }
      else if (!deltaText) setMessages((old) => old.filter((m, i) => i !== old.length - 1 || Boolean(m.text)));
    } finally { controller.abort(); setBusy(false); streamRef.current = null; activeRunIdRef.current = null; projectRunRef.current = false; setApproval(null); setClarify(null); setInfoRevision(v=>v+1); }
  }, [busy, loading, cwd, directoryUnavailable, modelName, modelProvider, thinking, refreshSessions, selected, ht, consumeRun, activeDraftId, drafts]);

  const stop = useCallback(async () => {
    const runId = activeRunIdRef.current;
    if (runId) {
      try { await hermesChat.stop({ runId, project: projectRunRef.current }); }
      catch (e) { setError(e instanceof Error ? e.message : String(e)); return; }
    }
    rememberRun(null); streamRef.current?.abort();
  }, []);

  const respondApproval = useCallback(async (choice: "once" | "deny") => {
    if (!approval) return;
    try {
      await hermesChat.approve({ runId: approval.runId, project: projectRunRef.current }, choice, approval.requestId);
      setApproval(null);
    } catch (e) { setError(e instanceof Error ? e.message : String(e)); }
  }, [approval]);

  const resetChat = () => {
    setManagementDirty(false);historyRef.current?.abort();setPage(null);setWorkspaceView("home");setSidebarOpen(false);
    history.replaceState(null,"",location.pathname);setSelected(null);setActiveDraftId(null);setInfoOpen(false);setSystemOpen(false);
    applyModelSelection(loadHermesModelSelection(null) ?? defaultModelRef.current);
    setThinking("auto");setMessages([]);setSearchFocus(null);setBusy(false);setLoading(false);setDirectoryUnavailable(false);setTools([]);setApproval(null);setClarify(null);setError("");setCompactNotice("");
  };
  const newChat = () => {
    if (streamRef.current || compactRef.current || projectBusyRef.current || attachmentBusyRef.current) return;
    if (managementDirty && !window.confirm(ht("放弃未保存的修改？"))) return;
    resetChat();
  };
  const activateProjectDraft = async (directory: string, draft?: HermesSessionRow) => {
    if (loading || streamRef.current || compactRef.current || projectBusyRef.current || attachmentBusyRef.current) return;
    if (managementDirty && !window.confirm(ht("放弃未保存的修改？"))) return;
    projectBusyRef.current=true;setProjectBusy(true);
    try {
      // Confirm a fresh draft's directory without changing the previous stored session.
      const project=await hermesChat.bindProject<{cwd:string;branch?:string;mapped?:boolean}>({cwd:directory});
      resetChat();setCwd(project.cwd);setProjectBranch(project.branch ?? "");setMappedProject(Boolean(project.mapped));
      rememberHermesProject(project.cwd);
      const row={...draft,id:draft?.id ?? `draft:${crypto.randomUUID()}`,title:draft?.title || ht("新会话"),cwd:project.cwd,git_branch:project.branch,message_count:0,last_active:Date.now()/1000,draft:true};
      setDrafts(previous=>[row,...previous.filter(item=>item.id!==row.id)]);setActiveDraftId(row.id);
      applyModelSelection(loadHermesModelSelection(row.id) ?? loadHermesModelSelection(null) ?? defaultModelRef.current);
    } finally {projectBusyRef.current=false;setProjectBusy(false);}
  };
  const selectChat = (id: string, match?: HermesSearchMatch) => {
    const draft=drafts.find(item=>item.id===id);
    if (draft?.cwd) {if (id!==activeDraftId || selected) void activateProjectDraft(draft.cwd,draft).catch(e=>setError(e instanceof Error?e.message:String(e)));}
    else void openSession(id, match);
  };

  const renameSession = async (session: HermesSessionRow) => {
    const title = window.prompt(ht("会话标题"), session.title ?? "");
    if (title === null) return;
    if (session.draft) {setDrafts(previous=>previous.map(item=>item.id===session.id?{...item,title:title.trim() || ht("新会话")}:item));return;}
    try { await hermesJson(`/api/sessions/${encodeURIComponent(session.id)}`, { method: "PATCH", body: JSON.stringify({ title }) }); await refreshSessions(); }
    catch (e) { setError(e instanceof Error ? e.message : String(e)); }
  };
  const deleteSession = async (session: HermesSessionRow) => {
    if (session.draft) {setDrafts(previous=>previous.filter(item=>item.id!==session.id));if(activeDraftId===session.id)newChat();return;}
    if (!window.confirm(ht("删除会话「{name}」？", { name: session.title || session.id }))) return;
    try { await hermesJson(`/api/sessions/${encodeURIComponent(session.id)}`, { method: "DELETE" }); if (selectedRef.current === session.id) newChat(); await refreshSessions(); }
    catch (e) { setError(e instanceof Error ? e.message : String(e)); }
  };
  const loadFullHistory = async () => {
    if (!selected || busy) return;
    setSearchFocus(null);
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
      if (!controller.signal.aborted) setMessages(hermesChatMessages(rows));
    } catch (e) { if (!controller.signal.aborted) setError(e instanceof Error ? e.message : String(e)); }
    finally { if (!controller.signal.aborted) setLoading(false); }
  };
  const loadSkillDormancy = useCallback(async () => {
    const skills = await hermesJson<{ name: string; enabled?: boolean }[]>("/api/skills");
    return Object.fromEntries(skills.map((skill) => [skill.name, skill.enabled === false]));
  }, []);
  const attachments = useHermesAttachments({
    cwd, draftKey: `hermes:${selected ?? activeDraftId ?? "new"}`, blocked: busy || compacting || loading || projectBusy,
    onImages: files => chatInputRef.current?.addImages(files),
    onMention: text => chatInputRef.current?.insertText(text),
    onUploaded: () => setFileRefreshKey(value => value + 1),
    onBusyChange: value => { attachmentBusyRef.current = value; },
    selectDirectory: path => changeProjectDirectory(path),
  });
  const drop = useDragDrop(attachments.attach);
  const handleCommand = async (message: string) => {
    setError("");
    const result = await runHermesCommand(message, {
      busy: busy || compacting || loading || projectBusy || attachments.busy,
      hasSession: Boolean(selected || activeDraftId),
      compact: async () => { if (!selected) return false; void compactSession(); return true; },
      rename: async title => {
        if (activeDraftId) setDrafts(previous => previous.map(item => item.id === activeDraftId ? { ...item, title } : item));
        else if (selected) { await hermesJson(`/api/sessions/${encodeURIComponent(selected)}`, { method: "PATCH", body: JSON.stringify({ title }) }); await refreshSessions(); }
      },
      copy: async () => {
        const answer = messages.findLast(item => item.role === "assistant" && item.text)?.text;
        if (!answer) throw new Error("暂无可复制的助手回复。");
        await copyText(answer);
      },
      info: () => { if (!selected) throw new Error("请先选择一个已保存的会话。"); setSystemOpen(false); setInfoOpen(true); setInfoRevision(value => value + 1); },
    });
    if (result.handled && result.error) setError(ht(result.error));
    return result;
  };
  const openFile = (path: string) => {
    if (!mappedProject) { rightPanelRef.current?.openFile(path); setSidebarOpen(false); return; }
    void fetch("/api/hermes-session/path", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ path }) }).then(async response => { const result = await response.json(); if (!response.ok) throw new Error(result.error); rightPanelRef.current?.openFile(result.path); setSidebarOpen(false); }).catch(error => setError(error.message));
  };

  return <main className={`hermes-layout ${sidebarOpen ? "sidebar-visible" : ""} ${!desktopSidebarOpen ? "sidebar-desktop-hidden" : ""}`}>
    <HermesActivityRail view={workspaceView} inert={page!==null} onNavigate={navigateWorkspace} onSettings={()=>navigatePage("general")} onProfiles={()=>navigatePage("profiles")}/>
    {sidebarOpen && <button className="hermes-sidebar-backdrop" aria-label={ht("关闭侧栏")} onClick={() => setSidebarOpen(false)} />}
    <div className="hermes-sidebar-host" hidden={workspaceView!=="home"} inert={page !== null || workspaceView!=="home"}>
      <HermesSidebar directoryBusy={projectBusy || attachments.busy} sessionRevision={sessionsRevision} sessions={[...drafts,...sessions]} selected={selected ?? activeDraftId} busy={busy || compacting || sessionActionBusy || projectBusy || attachments.busy} loading={loading} onPin={session=>void updateSessionFlag(session,"pinned")} onArchive={session=>void updateSessionFlag(session,"archived")} hasMore={sessions.length < sessionTotal} onLoadMore={()=>void loadMoreSessions()} cwd={cwd} branch={projectBranch} onCwdChange={changeProjectDirectory} onNew={activateProjectDraft} onSelect={selectChat} onSettings={navigatePage} onOpenFile={openFile} onOpenTerminal={(dir) => { rightPanelRef.current?.openTerminal(dir); setSidebarOpen(false); }} onMention={(path) => chatInputRef.current?.insertText(buildAtMentionText(path,false))} onRename={(session) => void renameSession(session)} onDelete={(session) => void deleteSession(session)} onClose={() => setSidebarOpen(false)} refreshKey={fileRefreshKey} />
    </div>
    <section className="hermes-main" hidden={workspaceView!=="home"} inert={page !== null || workspaceView!=="home" || rightPanelExpanded && rightPanelOpen}>
      <header className="hermes-top"><button className="hermes-toolbar-icon" aria-label={isMobile || !desktopSidebarOpen ? ht("打开侧栏") : ht("收起侧栏")} onClick={() => isMobile ? setSidebarOpen(true) : setDesktopSidebarOpen(!desktopSidebarOpen)}><HermesUiIcon name="sidebar" /></button>
        <button className="hermes-toolbar-action" title={ht("完整历史")} aria-label={ht("完整历史")} disabled={!selected || busy || loading} onClick={() => void loadFullHistory()}><HermesUiIcon name="history" /><span>{ht("完整历史")}</span></button>
        <button className="hermes-toolbar-action" title={ht("重命名")} aria-label={ht("重命名")} disabled={!selected || busy} onClick={() => { const session = sessions.find((s) => s.id === selected); if (session) void renameSession(session); }}><PencilIcon /><span>{ht("重命名")}</span></button>
        <button ref={systemButtonRef} className="hermes-toolbar-action" title={ht("系统")} aria-label={ht("系统")} disabled={!selected} aria-expanded={systemOpen && Boolean(selected)} aria-controls="hermes-system-prompt" onClick={() => { setInfoOpen(false); setSystemOpen(!systemOpen); }}><FileText size={14} aria-hidden="true" /><span>{ht("系统")}</span></button>
        <button className="hermes-toolbar-action" title={ht("工具")} aria-label={ht("工具")} onClick={() => navigatePage("tools")}><HermesUiIcon name="tools" /><span>{ht("工具")}</span></button>
        <span className="hermes-top-status" title={status}>{busy ? ht("运行中…") : compacting ? ht("正在压缩…") : ""}</span>{selected && <HermesSessionUsageButton detail={currentDetail} open={infoOpen} buttonRef={usageButtonRef} onClick={()=>{setSystemOpen(false);if(!infoOpen)setInfoRevision(v=>v+1);setInfoOpen(!infoOpen);}}/>}<button className="hermes-right-panel-toggle" aria-label={ht(rightPanelOpen ? "隐藏右侧面板" : "显示右侧面板")} aria-expanded={rightPanelOpen} aria-controls="hermes-right-panel" onClick={()=>setRightPanelOpen(!rightPanelOpen)}><HermesUiIcon name="right-sidebar"/></button>
      </header>
      {selected && infoOpen && !page && workspaceView==="home" && !(rightPanelExpanded && rightPanelOpen) && <HermesSessionInfo detail={currentDetail} sessionId={selected} cwd={cwd} error={infoError} onRefresh={()=>setInfoRevision(v=>v+1)} onClose={closeSessionInfo} buttonRef={usageButtonRef}/>}
      {selected && systemOpen && !page && workspaceView==="home" && !(rightPanelExpanded && rightPanelOpen) && <HermesSystemPrompt key={selected} sessionId={selected} refreshKey={infoRevision} onClose={closeSystemPrompt} buttonRef={systemButtonRef}/>}
      <div className={`hermes-chat ${!messages.length ? "is-empty" : ""}`} dir={display.direction} style={{"--hermes-user-transparency":`${display.bubbleTransparency}%`} as CSSProperties} onDragEnter={drop.handleDragEnter} onDragOver={drop.handleDragOver} onDragLeave={drop.handleDragLeave} onDrop={drop.handleDrop}>
        {drop.isDragOver && <div className="hermes-drop-overlay" aria-live="polite">{ht("添加附件")}</div>}
        <div className="hermes-transcript" dir="ltr">
        <div className="hermes-messages" dir={display.direction} ref={scrollRef} onScroll={event=>{const el=event.currentTarget;followTailRef.current=el.scrollHeight-el.scrollTop-el.clientHeight<48;}}>
          {loading ? <div className="hermes-muted">{ht("正在读取 Hermes 会话…")}</div> : <div className="hermes-message-list">{messages.map((m, i) => <div ref={element=>{const index=minimapRefIndexes[i];if(index!==null)messageRefs.current[index]=element;}} key={`${i}-${m.role}`} data-search-match={searchFocus?.index === i} className={m.role === "user" ? "hermes-user-row" : "hermes-assistant-row"}>
            {display.showReasoning && m.reasoning && <details className="hermes-reasoning" open={!display.collapseReasoning}><summary>{ht("推理过程")}</summary><MarkdownBody>{m.reasoning}</MarkdownBody></details>}
            {m.role === "tool" ? <HermesToolMessage key={`${selected ?? activeDraftId}:${m.tool?.id ?? i}`} message={m} scope={selected ?? activeDraftId ?? "new"} onOpenFile={openFile} cwd={cwd ?? undefined} /> : <MessageView message={m.role === "user" ? { role: "user", content: m.images?.length ? [{ type: "text", text: m.text }, ...m.images.map((image) => ({ type: "image" as const, source: { type: "base64" as const, media_type: image.mimeType, data: image.data } }))] : m.text } : { role: "assistant", content: [{ type: "text", text: m.text || (busy ? ht("思考中…") : "") }], model: modelName, provider: "hermes" }} isStreaming={busy && i === messages.length - 1} onOpenFile={openFile} cwd={cwd ?? undefined} />}
          </div>)}</div>}
          {tools.length > 0 && <details className="hermes-tool-activity" open={display.toolDetails}><summary>{ht("工具活动 ·")}{tools.length}</summary>{tools.map((tool, i) => <pre key={i}>{display.toolDetails ? tool : tool.split("：")[0]}</pre>)}</details>}
          {approval && <div className="hermes-approval"><strong>{ht("Hermes 需要你的确认")}</strong><pre>{approval.command || ht("即将执行一项受保护的操作。")}</pre><div><button onClick={() => void respondApproval("deny")}>{ht("拒绝")}</button><button onClick={() => void respondApproval("once")}>{ht("允许一次")}</button></div></div>}
          {clarify && <HermesClarify key={clarify.request_id} request={clarify} onAnswer={async answers => { await hermesChat.clarify(activeRunIdRef.current, clarify.request_id, answers); setClarify(null); }} />}
          {compactNotice && <div className="hermes-compact-notice" role="status">{compactNotice}</div>}{error && <div className="hermes-error" role="alert">{error}</div>}
        </div>
        {!isMobile && !loading && messages.length>0 && <ChatMinimap key={selected ?? "new"} messages={minimapHistory} getStreamingMessage={getMinimapStreamingMessage} scrollContainer={scrollRef} messageRefs={messageRefs} onRevealHistory={revealRenderedHistory} turnsBefore={0}/>}
        </div>
        {!loading && !messages.length && <div className="hermes-new-session-brand"><div className="new-session-brand"><HermesAvatar size={40} className="hermes-logo" /><div className="new-session-brand-text"><span className="new-session-brand-name">Hermes Web</span><span className="new-session-meta">Hermes Agent</span></div></div></div>}
        {(attachments.busy || attachments.pending.length > 0 || attachments.notice || attachments.error || attachments.foldersSkipped) && <div className="hermes-attachments-status" aria-label={ht("附件上传")}>
          {attachments.busy && <><span role="status">{ht("正在上传附件…")}</span><progress max={100} value={attachments.progress} aria-label={ht("附件上传进度")} /></>}
          {!attachments.busy && attachments.pending.length > 0 && <span>{attachments.pending.map(file=>file.name).join(", ")}</span>}
          {attachments.notice && <span role="status">{ht(attachments.notice)}</span>}
          {attachments.foldersSkipped && <span role="status">{ht("暂不支持上传文件夹，请选择文件。")}</span>}
          {attachments.error && <span role="alert">{ht(attachments.error)}</span>}
          {!attachments.busy && attachments.pending.length > 0 && <button type="button" title={ht("重试上传")} aria-label={ht("重试上传")} onClick={attachments.retry}><RefreshCw size={15} /></button>}
          {!attachments.busy && <button type="button" title={ht("清除附件提示")} aria-label={ht("清除附件提示")} onClick={attachments.dismiss}><X size={15} /></button>}
        </div>}
        <ChatInput ref={chatInputRef} builtinCommands={HERMES_COMMANDS} onBuiltinCommand={handleCommand} submissionDisabled={attachments.busy || projectBusy || loading} onAttachFiles={files=>attachments.attach(files.map(file=>({kind:"file",file})))} onSend={(text, images) => void send(text, images)} onAbort={() => compacting ? compactRef.current?.abort() : void stop()} isStreaming={busy || compacting} thinkingAutoLabel={ht("跟随默认")} isAutoThinkingSelection={thinking === "auto"} thinkingLevel={thinking} onThinkingLevelChange={setThinking} availableThinkingLevels={["off","minimal","low","medium","high","xhigh","max"]} thinkingLevelMap={{off:ht("关闭"),minimal:ht("最低"),low:ht("低"),medium:ht("中"),high:ht("高"),xhigh:ht("很高"),max:ht("最高")}} onCompact={selected && !loading ? ()=>void compactSession() : undefined} model={{ provider: modelProvider || "hermes", modelId: modelName }} modelList={[...modelCatalog,...models.filter(id=>!modelCatalog.some(item=>item.id === id)).map((id) => ({ id, name: id, provider: "hermes", input: ["text", "image"] }))]} onModelChange={(provider,id) => changeModel(id,provider)} draftKey={`hermes:${selected ?? activeDraftId ?? "new"}`} cwd={cwd} loadSkillDormancy={loadSkillDormancy} />
      </div>
    </section>
    {workspaceView!=="home" && <div className="hermes-workspace-host" inert={page!==null}><HermesWorkspacePage key={workspaceView} view={workspaceView} dirty={managementDirty} onDirtyChange={setManagementDirty} cwd={cwd} onCwdChange={changeProjectDirectory} messages={messages} sessionId={selected} refreshKey={fileRefreshKey}/></div>}
    <HermesRightPanel ref={rightPanelRef} open={rightPanelOpen && workspaceView==="home"} cwd={cwd} isMobile={isMobile} inert={page !== null} onOpen={()=>setRightPanelOpen(true)} onHide={()=>setRightPanelOpen(false)} onError={setError} onExpandedChange={setRightPanelExpanded}/>
    {page && <HermesSettingsDialog section={page} onSectionChange={navigatePage} onClose={() => navigatePage(null)} onDirtyChange={setManagementDirty} models={models} model={modelName} modelProvider={modelProvider} onModelChange={changeModel} modelBusy={busy || compacting || loading} />}
    {attachments.pickerOpen && <DirectoryPicker initialPath={cwd ?? undefined} busy={attachments.picking} error={attachments.error} onCancel={attachments.cancelPicker} onSelect={path=>void attachments.selectDirectory(path)} />}
  </main>;
}
