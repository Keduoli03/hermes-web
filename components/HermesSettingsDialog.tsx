"use client";

import { useHermesI18n } from "@/hooks/useHermesI18n";

import { useEffect, useLayoutEffect, useRef, useState } from "react";
import { focusModalPanel, listenForPanelEscape } from "@/lib/stacked-dialog";
import { SearchIcon } from "./SidebarIcons";
import { HermesUiIcon } from "./HermesSidebar";
import { HermesManagement, type HermesPage } from "./HermesManagement";
import { commonConfigFields } from "@/lib/hermes-settings-fields";
import { HermesConfigEditor } from "./HermesConfigEditor";
import { HermesGeneralPreferences, HermesThemePreferences, HermesFontPreferences, HermesChatDisplayPreferences } from "./HermesPreferences";
import { HermesMemoryContent } from "./HermesMemoryContent";
import { HermesModelsConfig } from "./HermesModelsConfig";

export type HermesSettingsSection = Exclude<HermesPage, "chat"> | "models" | "general" | "memory" | "compression" | "terminal" | "security" | "browser" | "voice" | "agent" | "memory-content" | "theme" | "fonts" | "delegation" | "chat-display";
const configCategories: Partial<Record<HermesSettingsSection, string[]>> = { memory: ["memory"], compression: ["compression"], terminal: ["terminal"], security: ["security"], browser: ["browser"], voice: ["voice", "tts", "stt"], agent: ["agent"], delegation: ["delegation"] };
const settingsSections: { id: HermesSettingsSection; label: string; group: string; description: string }[] = [
  { id: "general", label: "常规", group: "偏好设置", description: "调整语言和聊天习惯，修改会立即生效。" },
  { id: "theme", label: "主题", group: "偏好设置", description: "选择界面配色。" },
  { id: "fonts", label: "字体与缩放", group: "偏好设置", description: "调整字体、字号和内容宽度。" },
  { id: "models", label: "模型", group: "模型与工具", description: "选择当前对话使用的模型。" },
  { id: "memory-content", label: "记忆内容", group: "记忆与上下文", description: "查看、编辑我的笔记、用户画像和灵魂。" },
  { id: "memory", label: "持久记忆", group: "记忆与上下文", description: "管理持久记忆、用户画像、记忆预算与提供方。" },
  { id: "compression", label: "上下文与压缩", group: "记忆与上下文", description: "调整上下文压缩、保留策略和触发阈值。" },
  { id: "chat-display", label: "聊天显示", group: "偏好设置", description: "调整推理过程、工具调用和消息显示。" },
  { id: "delegation", label: "子任务", group: "对话与任务", description: "设置任务拆分后的模型、并行数量和运行限制。" },
  { id: "agent", label: "任务执行", group: "对话与任务", description: "设置任务步数、接口重试和模型输出方式。" },
  { id: "terminal", label: "终端与工作区", group: "工作区与安全", description: "选择执行后端、工作目录与终端超时。" },
  { id: "security", label: "安全与审批", group: "工作区与安全", description: "管理操作审批、密钥脱敏和访问规则。" },
  { id: "browser", label: "浏览器", group: "工作区与安全", description: "配置浏览器后端与访问策略。" },
  { id: "voice", label: "语音", group: "工作区与安全", description: "选择语音识别和合成提供方、模型与音色。" },
  { id: "skills", label: "技能", group: "模型与工具", description: "查看技能说明，编辑内容并管理启用状态。" },
  { id: "tools", label: "工具", group: "模型与工具", description: "管理 Hermes 可用的工具集。" },
  { id: "cron", label: "定时任务", group: "运行管理", description: "创建、编辑和运行定时任务，查看执行记录。" },
  { id: "status", label: "运行状态", group: "运行管理", description: "查看服务连接、版本和运行信息。" },
  { id: "logs", label: "日志", group: "运行管理", description: "查看助手、网关与错误日志。" },
  { id: "usage", label: "用量统计", group: "运行管理", description: "查看调用次数、令牌用量和费用。" },
  { id: "keys", label: "接口密钥", group: "工作区与安全", description: "管理服务商密钥和环境变量，已保存的密钥以脱敏形式显示。" },
  { id: "config", label: "高级配置", group: "高级", description: "编辑 Hermes 的配置文件。" },
];

function SectionIcon({ section }: { section: HermesSettingsSection }) {
  if (section === "models" || section === "skills" || section === "tools") return <HermesUiIcon name={section} />;
  if (section === "general" || section === "config") return <HermesUiIcon name="settings" />;
  return <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.7" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">{
    section === "cron" ? <><circle cx="12" cy="12" r="9" /><path d="M12 7v5l3 2" /></> :
    section === "status" ? <><path d="M3 12h4l3-8 4 16 3-8h4" /></> :
    section === "keys" ? <><circle cx="8" cy="9" r="5" /><path d="m12 13 8 8m-3-3 3-3m-6 0 3-3" /></> :
    section === "memory" || section === "memory-content" ? <><path d="M12 4a4 4 0 0 0-7 3 4 4 0 0 0-2 7 4 4 0 0 0 9 5V4m0 0a4 4 0 0 1 7 3 4 4 0 0 1 2 7 4 4 0 0 1-9 5M8 8l4 2m4-2-4 2M7 15l5-1m5 1-5-1" /></> :
    section === "compression" ? <><rect x="5" y="3" width="14" height="18" rx="2" /><path d="M8 8h8M8 12h8m-8 4h5" /></> :
    section === "terminal" ? <><rect x="3" y="4" width="18" height="15" rx="2" /><path d="m7 8 3 3-3 3m6 0h4" /></> :
    section === "security" ? <><path d="m12 3 8 3v6c0 5-8 9-8 9s-8-4-8-9V6l8-3m-4 9 3 3 5-6" /></> :
    section === "browser" ? <><circle cx="12" cy="12" r="9" /><ellipse cx="12" cy="12" rx="4" ry="9" /><path d="M3 12h18" /></> :
    section === "voice" ? <><rect x="9" y="3" width="6" height="12" rx="3" /><path d="M5 10v2a7 7 0 0 0 14 0v-2m-7 9v3m-4 0h8" /></> :
    section === "logs" ? <><path d="M7 3h10l3 3v15H4V3h3M8 9h8M8 13h8M8 17h5" /></> : <><path d="M4 20V10M10 20V4M16 20v-8M22 20H2" /></>
  }</svg>;
}

export function HermesSettingsDialog({ section, onSectionChange, onClose, onDirtyChange, models, model, onModelChange, modelBusy }: {
  section: HermesSettingsSection;
  onSectionChange: (section: HermesSettingsSection) => void;
  onClose: () => void;
  onDirtyChange: (dirty: boolean) => void;
  models: string[];
  model: string;
  onModelChange: (model: string) => void;
  modelBusy: boolean;
}) {
  const { ht } = useHermesI18n();
  const dialogRef = useRef<HTMLDivElement>(null);
  const closeRef = useRef(onClose);
  const searchRef = useRef<HTMLInputElement>(null);
  const menuRef = useRef<HTMLButtonElement>(null);
  const [configCategory, setConfigCategory] = useState("general");
  const [categoryOptions, setCategoryOptions] = useState<{id:string;label:string}[]>([]);
  const [expandedGroups, setExpandedGroups] = useState<Record<string, boolean>>({});
  const [search, setSearch] = useState("");
  const [navigationOpen, setNavigationOpen] = useState(false);
  const wasNavigationOpen = useRef(false);
  useLayoutEffect(() => {
    if (navigationOpen) searchRef.current?.focus();
    else if (wasNavigationOpen.current) menuRef.current?.focus();
    wasNavigationOpen.current = navigationOpen;
  }, [navigationOpen]);
  useLayoutEffect(() => { closeRef.current = onClose; });
  useLayoutEffect(() => focusModalPanel(document, dialogRef.current), []);
  useEffect(() => listenForPanelEscape(document, () => {
    if (navigationOpen) setNavigationOpen(false);
    else closeRef.current();
  }), [navigationOpen]);
  const query = search.trim().toLowerCase();
  const filtered = settingsSections.filter((item) => `${item.id} ${item.id === "keys" ? "api keys env" : ""} ${ht(item.label)} ${ht(item.description)}`.toLowerCase().includes(query));
  const current = settingsSections.find((item) => item.id === section)!;

  return <div ref={dialogRef} role="dialog" aria-modal="true" aria-label={ht("Hermes 设置")} tabIndex={-1} className={`settings-dialog-backdrop hermes-settings ${navigationOpen ? "is-settings-nav-open" : ""}`} onClick={(e) => { if (e.target === e.currentTarget) onClose(); }} onKeyDown={(event) => {
    if (event.key !== "Tab") return;
    const controls = Array.from(dialogRef.current?.querySelectorAll<HTMLElement>('button:not(:disabled), input:not(:disabled), textarea:not(:disabled), select:not(:disabled), summary, a[href], [tabindex="0"]') ?? []).filter((el) => el.getClientRects().length && !el.closest("[inert]"));
    const first = controls[0], last = controls.at(-1);
    if (!first) return;
    if (event.shiftKey && (document.activeElement === first || document.activeElement === dialogRef.current)) { event.preventDefault(); last?.focus(); }
    else if (!event.shiftKey && (document.activeElement === last || document.activeElement === dialogRef.current)) { event.preventDefault(); first.focus(); }
  }}>
    <div className="settings-dialog-surface">
      <aside className="hermes-settings-sidebar" aria-label={ht("设置菜单")}><h1>{ht("设置")}</h1><div className="hermes-settings-search"><SearchIcon size={15} /><input ref={searchRef} aria-label={ht("搜索设置")} placeholder={ht("搜索设置…")} value={search} onChange={(event) => setSearch(event.target.value)} /></div>
        <nav aria-label={ht("设置分类")}>{[...new Set(filtered.map(item => item.group))].map(group => {
          const open = Boolean(query) || (expandedGroups[group] ?? group === current.group);
          const items = filtered.filter(item => item.group === group);
          return <div className="hermes-settings-menu-group" key={group}><button type="button" className="hermes-settings-group-toggle" aria-expanded={open} onClick={() => setExpandedGroups(previous => ({...previous, [group]: !open}))}><SectionIcon section={items[0].id} /><span>{ht(group)}</span><svg className={open ? "is-open" : ""} width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.7" aria-hidden="true"><path d="m9 6 6 6-6 6" /></svg></button><div className="hermes-settings-menu-children" hidden={!open}>{items.map(item => <div key={item.id}><button type="button" aria-current={section === item.id ? "page" : undefined} onClick={() => { if (section !== item.id) setConfigCategory("general"); onSectionChange(item.id); setNavigationOpen(false); }}><SectionIcon section={item.id} /><span>{ht(item.label)}</span></button>{section === item.id && (section === "config" || (configCategories[section]?.length ?? 0) > 1) && categoryOptions.length > 0 && <div className="hermes-settings-config-categories">{categoryOptions.filter(option => section !== "config" || !["agent", "delegation", "memory", "compression", "terminal", "security", "browser", "voice", "tts", "stt", "display"].includes(option.id)).map(option => <button key={option.id} type="button" aria-current={(categoryOptions.some(entry => entry.id === configCategory) ? configCategory : categoryOptions[0].id) === option.id ? "page" : undefined} onClick={() => { setConfigCategory(option.id); setNavigationOpen(false); }}>{option.label}</button>)}</div>}</div>)}</div></div>;
        })}{!filtered.length && <p className="hermes-settings-no-results">{ht("没有找到匹配的设置")}</p>}</nav>
      </aside>
      {navigationOpen && <button className="hermes-settings-nav-backdrop" aria-label={ht("收起设置菜单")} onClick={() => setNavigationOpen(false)} />}
      <section className="hermes-settings-content" inert={navigationOpen}><header className="hermes-settings-content-header"><button type="button" ref={menuRef} className="hermes-settings-mobile-menu" aria-label={ht("打开设置菜单")} onClick={() => setNavigationOpen(true)}><HermesUiIcon name="sidebar" /></button><div><nav className="hermes-settings-breadcrumb" aria-label={ht("设置路径")}><span>{ht("设置")}</span><span aria-hidden="true">›</span><span>{ht(current.group)}</span><span aria-hidden="true">›</span><span>{ht(current.label)}</span>{(section === "config" || (configCategories[section]?.length ?? 0) > 1) && categoryOptions.length > 0 && <><span aria-hidden="true">›</span><span aria-current="page">{categoryOptions.find(item => item.id === configCategory)?.label ?? categoryOptions[0].label}</span></>}</nav><h2 className="hermes-settings-page-title">{ht(current.label)}</h2><p className="hermes-settings-description">{ht(current.description)}</p></div><button type="button" className="config-close-button" aria-label={ht("关闭设置")} onClick={onClose}>×</button></header>
        <div className="hermes-settings-section">
          {section === "general" ? <HermesGeneralPreferences /> : section === "theme" ? <HermesThemePreferences /> : section === "fonts" ? <HermesFontPreferences /> : section === "chat-display" ? <HermesChatDisplayPreferences /> : section === "memory-content" ? <HermesMemoryContent onDirtyChange={onDirtyChange} /> : section === "config" || configCategories[section] ? <HermesConfigEditor key={section} allowedCategories={configCategories[section]} visibleKeys={commonConfigFields[section]} category={configCategory} onCategoriesChange={setCategoryOptions} onDirtyChange={onDirtyChange} /> : section === "models" ? <HermesModelsConfig models={models} model={model} onModelChange={onModelChange} modelBusy={modelBusy} onDirtyChange={onDirtyChange} /> : <HermesManagement key={section} page={section as Exclude<HermesPage, "chat">} onDirtyChange={onDirtyChange} />}
        </div>
      </section>
    </div>
  </div>;
}
