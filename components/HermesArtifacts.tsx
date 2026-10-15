"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { Download, FolderOpen, Search, Code2, FileText, ImageIcon, Film, Music2, RefreshCw, LoaderCircle, X, Play, Maximize2, ChevronLeft, ChevronRight, MessagesSquare, TriangleAlert, ChevronDown } from "lucide-react";
import ReactMarkdown from "react-markdown";
import remarkGfm from "remark-gfm";
import { useHermesI18n } from "@/hooks/useHermesI18n";
import { hermesJson } from "@/lib/hermes-client";
import { artifactMediaUrl, artifactDocumentUrl, collectHermesArtifacts, type ArtifactKind, type ArtifactSession, type HermesArtifact } from "@/lib/hermes-artifacts";
import { FileExplorer } from "./FileExplorer";
import { FileViewer } from "./FileViewer";
import { DirectoryPicker } from "./DirectoryPicker";
import { ConfigButton, ConfigEmptyState, ConfigNotice } from "./SettingsUi";
import { openStackedDialog } from "@/lib/stacked-dialog";
import { HermesArtifactVersions } from "./HermesArtifactVersions";

const kinds = { image: "图片", video: "视频", audio: "音频", code: "代码", file: "文件" } as const;
const icons = { image: ImageIcon, video: Film, audio: Music2, code: Code2, file: FileText };

function useArtifactMediaSource(artifact: HermesArtifact, enabled = true) {
  const [fallback, setFallback] = useState("");
  const [state, setState] = useState<"loading" | "ready" | "error">("loading");
  const [attempt, setAttempt] = useState(0);
  const [fallbackNeeded, setFallbackNeeded] = useState(false);
  useEffect(() => {
    if (!enabled || !fallbackNeeded) return;
    const controller = new AbortController();
    hermesJson<{ data_url: string }>(`/api/media?${new URLSearchParams({ path: artifact.source })}`, { signal: controller.signal })
      .then(body => { if (!controller.signal.aborted) { if (!/^data:image\//.test(body.data_url)) throw new Error("Invalid image"); setFallback(body.data_url); } })
      .catch(() => { if (!controller.signal.aborted) setState("error"); });
    return () => controller.abort();
  }, [artifact.source, fallbackNeeded, enabled]);
  const fail = () => {
    if (artifact.kind === "image" && !fallbackNeeded && !/^(https?:|data:)/i.test(artifact.source)) setFallbackNeeded(true);
    else setState("error");
  };
  const src = fallback || artifactMediaUrl(artifact.source);
  return { src, state, attempt, fail, ready: () => setState("ready"), retry: () => { setFallback(""); setFallbackNeeded(false); setState("loading"); setAttempt(value => value + 1); } };
}

function HermesArtifactThumbnail({ artifact }: { artifact: HermesArtifact }) {
  const { ht } = useHermesI18n();
  const ref = useRef<HTMLSpanElement>(null);
  const [visible, setVisible] = useState(false);
  const media = useArtifactMediaSource(artifact, visible);
  const Icon = icons[artifact.kind];
  useEffect(() => {
    if (!ref.current) return;
    if (typeof IntersectionObserver === "undefined") { setVisible(true); return; }
    const observer = new IntersectionObserver(entries => {
      if (entries.some(entry => entry.isIntersecting)) { setVisible(true); observer.disconnect(); }
    }, { rootMargin: "160px" });
    observer.observe(ref.current);
    return () => observer.disconnect();
  }, []);
  return <span ref={ref} className={`hermes-artifact-thumbnail is-${artifact.kind}`}>
    {artifact.kind === "code" ? <pre aria-hidden="true">{artifact.content.slice(0, 500)}</pre>
      : (artifact.kind === "image" || artifact.kind === "video") && visible && media.state !== "error" ? <>
        {artifact.kind === "image" ? /* eslint-disable-next-line @next/next/no-img-element */
          <img src={media.src} alt="" loading="lazy" decoding="async" referrerPolicy="no-referrer" onLoad={media.ready} onError={media.fail} />
          : <video src={media.src} muted playsInline preload="metadata" aria-hidden="true" onLoadedMetadata={media.ready} onError={media.fail} />}
        {media.state === "loading" && <LoaderCircle size={20} className="hermes-artifact-spinner hermes-artifact-thumbnail-loading" />}
        {artifact.kind === "video" && media.state === "ready" && <span className="hermes-artifact-video-play"><Play size={24} fill="currentColor" /></span>}
      </> : <span className="hermes-artifact-thumbnail-placeholder"><Icon size={32} strokeWidth={1.4} />{media.state === "error" && <small>{ht("预览不可用")}</small>}</span>}
    <span className="hermes-artifact-kind-tag"><Icon size={12} />{ht(kinds[artifact.kind])}</span>
    <Maximize2 size={16} className="hermes-artifact-card-expand" />
  </span>;
}

function HermesArtifactMedia({ artifact }: { artifact: HermesArtifact }) {
  const { ht } = useHermesI18n();
  const { src, state, attempt, fail, ready, retry } = useArtifactMediaSource(artifact);
  return <div className="hermes-artifact-media">
    {state === "loading" && <div className="hermes-artifact-media-state" role="status"><LoaderCircle size={18} className="hermes-artifact-spinner" />{ht("正在加载预览…")}</div>}
    {state === "error" ? <ConfigEmptyState><FileText size={28} /><span>{ht("无法预览此产物，文件可能已移动、过期或不在服务允许的目录内。")}</span><ConfigButton onClick={retry}><RefreshCw size={15} />{ht("重试")}</ConfigButton></ConfigEmptyState>
      : artifact.kind === "image" ? /* eslint-disable-next-line @next/next/no-img-element */
        <img key={attempt} src={src} alt={artifact.title} referrerPolicy="no-referrer" onLoad={ready} onError={fail} />
      : artifact.kind === "video" ? <video key={attempt} src={src} controls playsInline preload="metadata" onLoadedMetadata={ready} onError={fail} />
      : <audio key={attempt} src={src} controls preload="metadata" onLoadedMetadata={ready} onError={fail} />}
  </div>;
}

function HermesArtifactDocument({ artifact, preview }: { artifact: HermesArtifact; preview: boolean }) {
  const { ht } = useHermesI18n();
  const [text, setText] = useState<string | null>(artifact.kind === "code" ? artifact.content : null);
  const [error, setError] = useState(false);
  const [attempt, setAttempt] = useState(0);
  useEffect(() => {
    if (artifact.kind === "code") return;
    const controller = new AbortController();
    setText(null); setError(false);
    async function read() {
      const response = await fetch(artifactMediaUrl(artifact.source), { signal: controller.signal, credentials: /^https?:/i.test(artifact.source) ? "omit" : "same-origin", referrerPolicy: "no-referrer" });
      if (!response.ok || Number(response.headers.get("content-length")) > 1024 * 1024) {
        await response.body?.cancel();
        throw new Error("Preview unavailable");
      }
      const reader = response.body?.getReader();
      if (!reader) throw new Error("Preview unavailable");
      const decoder = new TextDecoder();
      let result = "", bytes = 0;
      try {
        while (true) {
          const chunk = await reader.read();
          if (chunk.done) break;
          bytes += chunk.value.byteLength;
          if (bytes > 1024 * 1024) throw new Error("Preview too large");
          result += decoder.decode(chunk.value, { stream: true });
        }
        result += decoder.decode();
        if (result.includes("\0")) throw new Error("Binary content");
        if (!controller.signal.aborted) setText(result);
      } finally { await reader.cancel().catch(() => {}); }
    }
    void read().catch(() => { if (!controller.signal.aborted) setError(true); });
    return () => controller.abort();
  }, [artifact.kind, artifact.source, attempt]);
  if (error) return <ConfigEmptyState><FileText size={28} /><span>{ht("无法预览此文件，可能已移动、不可访问或超过 1 MB。你仍可尝试下载。")}</span><ConfigButton onClick={() => setAttempt(value => value + 1)}><RefreshCw size={15} />{ht("重试")}</ConfigButton></ConfigEmptyState>;
  if (text === null) return <ConfigEmptyState><LoaderCircle size={24} className="hermes-artifact-spinner" /><span>{ht("正在加载预览…")}</span></ConfigEmptyState>;
  const markdown = /^(md|markdown|mdown)$/i.test(artifact.language) || /\.(md|markdown|mdown)(?:[?#]|$)/i.test(artifact.source);
  if (!markdown || !preview) return <pre>{text}</pre>;
  return <div className="hermes-artifact-document markdown-body"><ReactMarkdown remarkPlugins={[remarkGfm]} urlTransform={url => artifactDocumentUrl(url, artifact.source)} components={{ a: ({ children, href }) => <a href={href} target="_blank" rel="noopener noreferrer">{children}</a>, img: ({ src, alt }) => {
    // eslint-disable-next-line @next/next/no-img-element
    return <img src={src} alt={alt || ""} loading="lazy" referrerPolicy="no-referrer" />;
  } }}>{text}</ReactMarkdown></div>;
}

function HermesArtifactDialog({ artifact, onClose, onDownload, onPrevious, onNext, position, total }: { artifact: HermesArtifact; onClose: () => void; onDownload: () => void; onPrevious?: () => void; onNext?: () => void; position: number; total: number }) {
  const { ht } = useHermesI18n();
  const ref = useRef<HTMLDialogElement>(null);
  const [preview, setPreview] = useState(true);
  const html = artifact.kind === "code" && ["html", "svg"].includes(artifact.language.toLowerCase());
  const markdown = /^(md|markdown|mdown)$/i.test(artifact.language) || /\.(md|markdown|mdown)(?:[?#]|$)/i.test(artifact.source);
  const textFile = artifact.kind === "file" && /\.(md|markdown|mdown|txt|json|csv|tsv|ya?ml|xml|log|css|jsx?|tsx?|py|html)(?:[?#]|$)/i.test(artifact.source);
  useEffect(() => {
    const dialog = ref.current;
    if (!dialog) return;
    const cleanup = openStackedDialog(document, dialog, onClose);
    dialog.showModal();
    return () => { dialog.close(); cleanup(); };
  }, [onClose]);
  return <dialog ref={ref} className="hermes-artifact-dialog" aria-label={ht("产物预览")} onCancel={event => { event.preventDefault(); event.stopPropagation(); onClose(); }} onClick={event => { if (event.target === event.currentTarget) onClose(); }} onKeyDown={event => {
    if (event.target instanceof Element && event.target.closest("video,audio,input,textarea,[contenteditable=true]")) return;
    if (event.key === "ArrowLeft" && onPrevious) { event.preventDefault(); onPrevious(); }
    if (event.key === "ArrowRight" && onNext) { event.preventDefault(); onNext(); }
  }}>
    <div className="hermes-artifact-dialog-shell">
      <header><div><strong>{artifact.title}</strong><small>{artifact.sessionTitle}</small></div>{(html || markdown) && <button type="button" aria-pressed={preview} onClick={() => setPreview(!preview)}>{ht(preview ? "查看源码" : "预览")}</button>}<button type="button" aria-label={ht("下载产物")} title={ht("下载产物")} onClick={onDownload}><Download size={17} /></button><button type="button" aria-label={ht("关闭预览")} title={ht("关闭预览")} onClick={onClose}><X size={18} /></button></header>
      <div className="hermes-artifact-preview">{textFile || (artifact.kind === "code" && markdown) ? <HermesArtifactDocument artifact={artifact} preview={preview} /> : artifact.kind === "code" ? html && preview ? <iframe title={ht("产物预览")} sandbox="" srcDoc={`<meta http-equiv="Content-Security-Policy" content="default-src 'none'; style-src 'unsafe-inline'; img-src data: blob:; font-src data:">${artifact.content}`} /> : <pre>{artifact.content}</pre>
        : artifact.kind === "file" ? <ConfigEmptyState><FileText size={36} /><span>{artifact.title}</span><ConfigButton onClick={onDownload}><Download size={16} />{ht("下载产物")}</ConfigButton></ConfigEmptyState> : <HermesArtifactMedia key={artifact.id} artifact={artifact} />}</div>
      <HermesArtifactVersions artifact={artifact}/>
      <footer><button type="button" disabled={!onPrevious} aria-label={ht("上一个产物")} title={ht("上一个产物")} onClick={onPrevious}><ChevronLeft size={18} /></button><span>{position > 0 ? `${position} / ${total}` : ht(kinds[artifact.kind])}</span><button type="button" disabled={!onNext} aria-label={ht("下一个产物")} title={ht("下一个产物")} onClick={onNext}><ChevronRight size={18} /></button></footer>
    </div>
  </dialog>;
}

export function HermesArtifacts({ cwd, onCwdChange, messages, sessionId, refreshKey }: { cwd: string | null; onCwdChange: (cwd: string | null) => Promise<void>; messages: { role: string; text: string }[]; sessionId: string | null; refreshKey: number }) {
  const { ht } = useHermesI18n();
  const [mode, setMode] = useState<"generated" | "files">("generated");
  const [scope, setScope] = useState("all");
  const [sessions, setSessions] = useState<ArtifactSession[] | null>(null);
  const [listError, setListError] = useState("");
  const [revision, setRevision] = useState(0);
  const forcedRevision = useRef(0);
  const [loaded, setLoaded] = useState<{ owner: string; items: HermesArtifact[]; loading: boolean; failed: number; done: number; total: number }>({ owner: "", items: [], loading: false, failed: 0, done: 0, total: 0 });
  const [selected, setSelected] = useState<HermesArtifact | null>(null);
  const [query, setQuery] = useState("");
  const [kind, setKind] = useState<"all" | ArtifactKind>("all");
  const [file, setFile] = useState("");
  const [picker, setPicker] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const target = scope === "current" ? sessionId : scope === "all" ? null : scope.slice(8);
  const owner = `${revision}:${refreshKey}`;

  useEffect(() => {
    const controller = new AbortController();
    if (mode !== "generated") return;
    const force = revision !== forcedRevision.current;
    async function load() {
      setLoaded(previous => ({ ...previous, owner, loading: true }));
      try {
        const response = await fetch(`/api/hermes-artifacts${force ? "?refresh=1" : ""}`, { signal: controller.signal, cache: "no-store" });
        if (!response.ok) throw new Error("Artifacts unavailable");
        const body: { sessions: ArtifactSession[]; artifacts: HermesArtifact[]; failed: number } = await response.json();
        if (!controller.signal.aborted) {
          forcedRevision.current = revision;
          setSessions(body.sessions); setListError("");
          setLoaded({ owner, items: body.artifacts, loading: false, failed: body.failed, done: body.sessions.length, total: body.sessions.length });
        }
      } catch {
        if (!controller.signal.aborted) { setListError("无法读取会话产物，请检查 Hermes 服务后重试。"); setLoaded(previous => ({ ...previous, owner, loading: false })); }
      }
    }
    void load();
    return () => controller.abort();
  }, [mode, revision, refreshKey, owner]);

  const live = useMemo(() => sessionId ? collectHermesArtifacts(sessions?.find(row => row.id === sessionId) ?? { id: sessionId, cwd: cwd ?? undefined }, messages) : [], [messages, sessionId, sessions, cwd]);
  const artifacts = useMemo(() => {
    const items = (loaded.owner === owner ? loaded.items : []).filter(item => scope === "all" || item.sessionId === target);
    const includeLive = scope === "all" || target === sessionId;
    return [...new Map([...items, ...(includeLive ? live : [])].map(item => [item.id, item])).values()];
  }, [loaded, owner, scope, target, sessionId, live]);
  const filtered = artifacts.filter(item => (kind === "all" || item.kind === kind) && `${item.title} ${item.language} ${item.sessionTitle}`.toLowerCase().includes(query.trim().toLowerCase()));
  const selectedIndex = filtered.findIndex(item => item.id === selected?.id);
  const closePreview = useCallback(() => setSelected(null), []);
  const loading = mode === "generated" && !(scope === "all" && !sessions && listError) && (loaded.owner !== owner ? Boolean(target || scope === "all") : loaded.loading);
  const failed = loaded.owner === owner ? loaded.failed : 0;
  async function chooseDirectory(path: string) { setBusy(true); setError(""); try { await onCwdChange(path); setFile(""); setPicker(false); } catch (e) { setError(e instanceof Error ? e.message : String(e)); } finally { setBusy(false); } }
  function download(artifact: HermesArtifact) {
    const link = document.createElement("a");
    if (artifact.kind !== "code") { link.href = artifactMediaUrl(artifact.source, true); link.download = artifact.title; link.target = "_blank"; link.rel = "noopener noreferrer"; link.click(); return; }
    const extensions: Record<string, string> = { javascript: "js", typescript: "ts", python: "py", markdown: "md", text: "txt" };
    const ext = extensions[artifact.language] || (/^[a-z0-9]+$/i.test(artifact.language) ? artifact.language : "txt");
    const url = URL.createObjectURL(new Blob([artifact.content], { type: "text/plain;charset=utf-8" }));
    link.href = url; link.download = `artifact-${artifact.id.split(":").pop()}.${ext}`; link.click(); setTimeout(() => URL.revokeObjectURL(url), 1000);
  }
  return <div className="hermes-artifacts">
    <header className="hermes-artifacts-header">
      <div className="hermes-artifacts-toolbar"><h1>{ht("产物")}</h1><nav aria-label={ht("产物分类")}>{([["generated", "会话产物"], ["files", "工作区文件"]] as const).map(([id, label]) => <button type="button" key={id} aria-pressed={mode === id} onClick={() => { closePreview(); setMode(id); }}>{ht(label)}</button>)}</nav>
        {mode === "generated" ? <><span className="hermes-artifact-count" role="status">{loading ? <><LoaderCircle size={13} className="hermes-artifact-spinner" />{ht("正在加载…")}</> : ht("{count} 个产物", { count: filtered.length })}</span><label className="hermes-artifact-search"><Search size={15} /><input aria-label={ht("搜索产物")} placeholder={ht("搜索产物…")} value={query} onChange={e => { closePreview(); setQuery(e.target.value); }} /></label><button type="button" className="hermes-artifact-refresh" onClick={() => { closePreview(); setRevision(value => value + 1); }} title={ht("刷新产物")} aria-label={ht("刷新产物")}><RefreshCw size={16} /></button></> : <ConfigButton onClick={() => setPicker(true)}><FolderOpen size={16} />{ht("选择文件夹")}</ConfigButton>}
      </div>
      {mode === "generated" && <div className="hermes-artifacts-controls">
        <nav className="hermes-artifact-kind-tabs" aria-label={ht("产物类型")}><button type="button" aria-pressed={kind === "all"} onClick={() => { closePreview(); setKind("all"); }}>{ht("全部类型")}</button>{Object.entries(kinds).map(([id, label]) => { const Icon = icons[id as ArtifactKind]; return <button type="button" key={id} aria-pressed={kind === id} onClick={() => { closePreview(); setKind(id as ArtifactKind); }}><Icon size={14} />{ht(label)}</button>; })}</nav>
        <label className="hermes-artifact-session-select"><MessagesSquare size={14} /><select aria-label={ht("产物会话范围")} value={scope} onChange={event => { closePreview(); setScope(event.target.value); }}><option value="all">{ht("全部会话")}</option><option value="current" disabled={!sessionId}>{ht("当前会话")}</option>{sessions?.map(row => <option key={row.id} value={`session:${row.id}`}>{row.title || row.preview || row.id}</option>)}</select><ChevronDown size={13} /></label>
      </div>}
    </header>
    {mode === "generated" ? <>
      <div className="hermes-artifacts-gallery-scroll">
        {(listError || failed > 0) && <div className="hermes-artifacts-notice" role="status"><TriangleAlert size={15} /><span>{listError ? ht(listError) : ht("有 {count} 个会话读取失败，已显示其余结果。", { count: failed })}</span><button type="button" onClick={() => setRevision(value => value + 1)}>{ht("重试")}</button></div>}
        {filtered.length > 0 ? <div className="hermes-artifact-grid" role="list" aria-label={ht("会话产物列表")}>{filtered.map(item => <article key={`${item.id}:${revision}:${refreshKey}`} className="hermes-artifact-card" role="listitem" aria-label={item.title}>
          <button type="button" className="hermes-artifact-card-open" aria-label={ht("预览 {name}", { name: item.title })} aria-haspopup="dialog" onClick={() => setSelected(item)}><HermesArtifactThumbnail artifact={item} /><span className="hermes-artifact-card-info"><strong title={item.title}>{item.title}</strong><small title={item.sessionTitle}>{item.sessionTitle}</small></span></button>
          <button type="button" className="hermes-artifact-card-download" aria-label={ht("下载 {name}", { name: item.title })} title={ht("下载产物")} onClick={() => download(item)}><Download size={15} /></button>
        </article>)}</div> : <ConfigEmptyState>{loading ? <LoaderCircle size={28} className="hermes-artifact-spinner" /> : <ImageIcon size={28} />}<span>{ht(loading ? "正在读取会话产物…" : artifacts.length ? "没有匹配的产物" : scope === "current" && !sessionId ? "选择一个会话，或切换到全部会话查看产物。" : "生成的图片、视频、音频、文件和代码会显示在这里。")}</span></ConfigEmptyState>}
      </div>
      {selected && <HermesArtifactDialog key={selected.id} artifact={selected} onClose={closePreview} onDownload={() => download(selected)} onPrevious={selectedIndex > 0 ? () => setSelected(filtered[selectedIndex - 1]) : undefined} onNext={selectedIndex >= 0 && selectedIndex < filtered.length - 1 ? () => setSelected(filtered[selectedIndex + 1]) : undefined} position={selectedIndex + 1} total={filtered.length} />}
    </> : <>{cwd && <div className="hermes-artifact-directory" title={cwd}>{cwd}</div>}<div className="hermes-artifacts-layout">{cwd ? <><aside className="hermes-artifact-files"><FileExplorer cwd={cwd} changesCollapsed onOpenFile={path => setFile(path)} refreshKey={refreshKey} /></aside><div className="hermes-artifact-preview">{file ? <FileViewer key={file} filePath={file} cwd={cwd} onOpenFile={setFile} /> : <ConfigEmptyState>{ht("选择文件进行预览或下载。")}</ConfigEmptyState>}</div></> : <ConfigEmptyState><ConfigButton onClick={() => setPicker(true)}><FolderOpen size={17} />{ht("选择文件夹")}</ConfigButton></ConfigEmptyState>}</div></>}
    {!picker && error && <ConfigNotice>{error}</ConfigNotice>}{picker && <DirectoryPicker initialPath={cwd ?? undefined} busy={busy} error={error} onCancel={() => setPicker(false)} onSelect={path => void chooseDirectory(path)} />}
  </div>;
}
