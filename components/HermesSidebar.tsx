"use client";

import { useHermesI18n } from "@/hooks/useHermesI18n";

import { useRef, useState, useEffect } from "react";
import { useResizablePanel } from "@/hooks/useResizablePanel";
import { DirectoryPicker } from "./DirectoryPicker";
import { FileExplorer, type FileExplorerHandle } from "./FileExplorer";
import { BranchIcon, ChevronIcon, FolderIcon, PencilIcon, PlusIcon, RefreshIcon, SearchIcon, TerminalIcon, TrashIcon, UploadIcon } from "./SidebarIcons";
import type { HermesSettingsSection } from "./HermesSettingsDialog";

export type HermesSessionRow = { id: string; title?: string | null; preview?: string; message_count?: number; last_active?: number; cwd?:string; git_branch?:string; pinned?:boolean; archived?:boolean };
export function HermesUiIcon({ name }: { name: "models" | "skills" | "settings" | "sidebar" | "history" | "tools" }) {
  return <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">{
    name === "models" ? <><rect x="4" y="4" width="16" height="16" rx="2" /><rect x="9" y="9" width="6" height="6" /><path d="M9 1v3M15 1v3M9 20v3M15 20v3M20 9h3M20 15h3M1 9h3M1 15h3" /></> :
    name === "skills" ? <><path d="m12 2-10 5 10 5 10-5-10-5Z" /><path d="m2 12 10 5 10-5M2 17l10 5 10-5" /></> :
    name === "settings" ? <><path d="M20 7h-9M14 17H5" /><circle cx="7" cy="7" r="3" /><circle cx="17" cy="17" r="3" /></> :
    name === "sidebar" ? <><rect x="3" y="3" width="18" height="18" rx="2" /><path d="M9 3v18" /></> :
    name === "history" ? <><path d="M3 11a9 9 0 1 1 2 7M3 4v7h7M12 7v5l3 2" /></> : <path d="M14 6a5 5 0 0 0-6 6L2 18l4 4 6-6a5 5 0 0 0 6-6l-3 3-4-4 3-3Z" />
  }</svg>;
}

export function HermesSidebar({ sessions, selected, busy, loading, cwd, onCwdChange, onNew, onSelect, onSettings, onOpenFile, onOpenTerminal, onMention, onRename, onDelete, onPin, onArchive, hasMore, onLoadMore, onClose, refreshKey }: {
  sessions: HermesSessionRow[]; selected: string | null; busy: boolean; loading: boolean;
  cwd: string | null; onCwdChange: (cwd: string) => void;
  onNew: () => void; onSelect: (id: string) => void; onSettings: (section: HermesSettingsSection) => void;
  onOpenFile: (path: string) => void; onOpenTerminal: (cwd: string) => void; onMention: (path: string) => void;
  onRename: (session: HermesSessionRow) => void; onDelete: (session: HermesSessionRow) => void;
  onPin:(session:HermesSessionRow)=>void; onArchive:(session:HermesSessionRow)=>void; hasMore:boolean; onLoadMore:()=>void;
  onClose: () => void; refreshKey: number;
}) {
  const { ht } = useHermesI18n();
  const [archivedOpen,setArchivedOpen]=useState(false);
  const [menuId,setMenuId]=useState<string|null>(null);
  useEffect(()=>{const close=(e:KeyboardEvent)=>{if(e.key === "Escape")setMenuId(null);};document.addEventListener("keydown",close);return()=>document.removeEventListener("keydown",close);},[]);
  const [searchOpen, setSearchOpen] = useState(false);
  const [search, setSearch] = useState("");
  const [pickerOpen, setPickerOpen] = useState(false);
  const [pickerBusy, setPickerBusy] = useState(false);
  const [pickerError, setPickerError] = useState("");
  const [filesOpen, setFilesOpen] = useState(true);
  const [fileSearch, setFileSearch] = useState(false);
  const [fileRevision, setFileRevision] = useState(0);
  const filesHeightRef=useRef(300);
  const filesPanel=useResizablePanel({ariaLabel:ht("调整文件区高度"),axis:"vertical",cssVariable:"--hermes-files-height",defaultWidth:300,getMaxWidth:()=>Math.max(100,window.innerHeight-300),growthDirection:"up",maxWidth:700,minWidth:100,persistClamp:false,storageKey:"hermes-files-height",widthRef:filesHeightRef});
  const explorerRef = useRef<FileExplorerHandle>(null);
  async function selectDirectory(path: string) {
    setPickerBusy(true); setPickerError("");
    try {
      const response = await fetch("/api/cwd/validate", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ cwd: path }) });
      const body = await response.json() as { cwd?: string; error?: string };
      if (!response.ok || !body.cwd) throw new Error(body.error ?? "无法打开目录");
      onCwdChange(body.cwd); setPickerOpen(false);
    } catch (e) { setPickerError(e instanceof Error ? e.message : String(e)); }
    finally { setPickerBusy(false); }
  }
  return <aside className="hermes-sidebar" aria-label={ht("会话侧栏")}>
    <div className="hermes-sidebar-toolbar"><strong>Hermes Web</strong><button className="hermes-new-button" aria-label={ht("新建对话")} disabled={busy} onClick={onNew}><PlusIcon size={15} />{ht("新建")}</button><button aria-label={ht("搜索会话")} title={ht("搜索会话")} onClick={() => setSearchOpen(!searchOpen)}><SearchIcon size={16} /></button><button className="hermes-mobile-close" aria-label={ht("关闭侧栏")} onClick={onClose}>×</button></div>
    <div className="hermes-project-picker"><button title={cwd ?? ht("选择文件工作区")} onClick={() => { setPickerError(""); setPickerOpen(true); }}><FolderIcon /><span>{cwd ?? ht("选择项目目录…")}</span></button><div className="hermes-project-branch"><BranchIcon /><span>{ht("文件工作区")}</span></div></div>
    {searchOpen && <input autoFocus className="hermes-session-search" aria-label={ht("搜索会话")} placeholder={ht("搜索会话…")} value={search} onChange={(e) => setSearch(e.target.value)} />}
    <div className="hermes-session-view-tabs"><button aria-pressed={!archivedOpen} onClick={()=>setArchivedOpen(false)}>{ht("会话")}</button><button aria-pressed={archivedOpen} onClick={()=>setArchivedOpen(true)}>{ht("已归档")}</button></div>
    <nav className="hermes-sessions" aria-label={ht("会话")}>{[...sessions].filter(s=>Boolean(s.archived)===archivedOpen && `${s.title ?? ""} ${s.preview ?? ""}`.toLowerCase().includes(search.toLowerCase())).sort((a,b)=>Number(Boolean(b.pinned))-Number(Boolean(a.pinned)) || (b.last_active ?? 0)-(a.last_active ?? 0)).map(s=><div key={s.id} className={`hermes-session-row ${selected === s.id ? "active" : ""}`}><button className="hermes-session" disabled={busy} onClick={()=>onSelect(s.id)}><span>{s.pinned && <span aria-label={ht("已置顶")}>⌖ </span>}{s.title || s.preview || ht("新会话")}</span><small>{s.last_active ? new Date(s.last_active*1000).toLocaleDateString() + " · " : ""}{ht("{count} 条消息",{count:s.message_count ?? 0})}</small>{s.cwd && <small className="hermes-session-project">{s.cwd.split(/[\\/]/).filter(Boolean).at(-1)}{s.git_branch ? ` · ${s.git_branch}` : ""}</small>}</button><div className="hermes-session-row-actions"><button aria-label={ht("重命名 {name}",{name:s.title || s.id})} disabled={busy} onClick={()=>onRename(s)}><PencilIcon/></button><button aria-label={ht("会话操作 {name}",{name:s.title || s.id})} disabled={busy} aria-expanded={menuId === s.id} onClick={()=>setMenuId(menuId === s.id ? null:s.id)}>⋯</button></div>{menuId === s.id && <div className="hermes-session-menu" role="group" aria-label={ht("会话操作")}><button onClick={()=>{setMenuId(null);onPin(s);}}>{ht(s.pinned ? "取消置顶" : "置顶")}</button><button onClick={()=>{setMenuId(null);onArchive(s);}}>{ht(s.archived ? "取消归档" : "归档")}</button><button onClick={()=>{setMenuId(null);void navigator.clipboard.writeText(`${location.origin}/?session=${encodeURIComponent(s.id)}`);}}>{ht("复制会话链接")}</button><button className="is-danger" onClick={()=>{setMenuId(null);onDelete(s);}}><TrashIcon/>{ht("删除会话")}</button></div>}</div>)}{!loading && !sessions.some(s=>Boolean(s.archived)===archivedOpen) && <small className="hermes-muted">{ht(archivedOpen ? "暂无归档会话" : "暂无会话")}</small>}{hasMore && <button className="hermes-load-more" disabled={busy || loading} onClick={onLoadMore}>{ht("加载更多会话")}</button>}</nav>
    <div className="hermes-files-resizer" {...filesPanel.separatorProps}/><div ref={filesPanel.panelRef} role="region" className={`hermes-files ${filesOpen ? "" : "is-collapsed"}`} aria-label={ht("文件浏览器")}><div className="hermes-files-toolbar"><button className="hermes-files-heading" aria-expanded={filesOpen} onClick={() => setFilesOpen(!filesOpen)}><ChevronIcon className={filesOpen ? "is-open" : ""} />{ht("文件浏览器")}</button><button title={ht("打开终端")} aria-label={ht("打开终端")} disabled={!cwd} onClick={() => cwd && onOpenTerminal(cwd)}><TerminalIcon /></button><button title={ht("搜索文件")} aria-label={ht("搜索文件")} disabled={!cwd} onClick={() => { setFilesOpen(true); setFileSearch(!fileSearch); }}><SearchIcon /></button><button title={ht("上传文件")} aria-label={ht("上传文件")} disabled={!cwd} onClick={() => explorerRef.current?.openUploadPicker()}><UploadIcon /></button><button title={ht("刷新文件")} aria-label={ht("刷新文件")} disabled={!cwd} onClick={() => setFileRevision((n) => n + 1)}><RefreshIcon /></button></div>
      <div className="hermes-files-body" hidden={!filesOpen}>{cwd ? <FileExplorer ref={explorerRef} cwd={cwd} changesCollapsed refreshKey={fileRevision + refreshKey} fileSearchOpen={fileSearch} onFileSearchOpenChange={setFileSearch} onOpenFile={onOpenFile} onAtMention={onMention} /> : <button className="hermes-pick-files" onClick={() => setPickerOpen(true)}>{ht("选择目录以浏览文件")}</button>}</div>
    </div>
    <nav className="hermes-sidebar-footer" aria-label={ht("工作区设置")}><button onClick={() => onSettings("models")}><HermesUiIcon name="models" />{ht("模型")}</button><button onClick={() => onSettings("skills")}><HermesUiIcon name="skills" />{ht("技能")}</button><button onClick={() => onSettings("general")}><HermesUiIcon name="settings" />{ht("设置")}</button></nav>
    {pickerOpen && <DirectoryPicker initialPath={cwd ?? undefined} busy={pickerBusy} error={pickerError} onCancel={() => setPickerOpen(false)} onSelect={(path) => void selectDirectory(path)} />}
  </aside>;
}
