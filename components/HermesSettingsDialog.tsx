"use client";

import { useHermesI18n } from "@/hooks/useHermesI18n";

import { useEffect, useLayoutEffect, useRef, useState } from "react";
import { Activity, AudioLines, BookOpen, Bot, Brain, ChartNoAxesCombined, ChevronRight, Clock, Cpu, FileSliders, Globe, KeyRound, ListTree, Logs, MessageSquare, MessagesSquare, Network, Package, UserCheck, Webhook, Workflow, Palette, Plug, Settings2, ShieldCheck, SlidersHorizontal, Sparkles, Store, Terminal, TextCursor, UserRound, Wrench, type LucideIcon } from "lucide-react";
import { focusModalPanel, listenForPanelEscape } from "@/lib/stacked-dialog";
import { SearchIcon } from "./SidebarIcons";
import { HermesUiIcon } from "./HermesSidebar";
import { HermesAdvancedModules, type AdvancedSection } from "./HermesAdvancedModules";
import { HermesManagement, type HermesPage } from "./HermesManagement";
import { commonConfigFields } from "@/lib/hermes-settings-fields";
import { HermesConfigEditor } from "./HermesConfigEditor";
import { HermesGeneralPreferences, HermesThemePreferences, HermesFontPreferences, HermesChatDisplayPreferences } from "./HermesPreferences";
import { HermesMemoryContent } from "./HermesMemoryContent";
import { HermesModelsConfig } from "./HermesModelsConfig";

export type HermesSettingsSection = Exclude<HermesPage, "chat"> | "models" | "general" | "memory" | "compression" | "terminal" | "security" | "browser" | "voice" | "agent" | "memory-content" | "theme" | "fonts" | "delegation" | "chat-display" | AdvancedSection;
const configCategories: Partial<Record<HermesSettingsSection, string[]>> = { memory: ["memory"], compression: ["compression"], terminal: ["terminal"], security: ["security"], browser: ["browser"], voice: ["voice", "tts", "stt"], agent: ["agent"], delegation: ["delegation"] };
const settingsSections: { id: HermesSettingsSection; label: string; group: string; description: string }[] = [
  { id: "plugins", label: "插件", group: "模型与工具", description: "管理 Hermes 插件。" },
  { id: "pairing", label: "配对审批", group: "运行管理", description: "管理渠道访问权限。" },
  { id: "webhooks", label: "Webhooks", group: "运行管理", description: "管理事件订阅。" },
  { id: "agents", label: "多智能体任务", group: "对话与任务", description: "查看任务状态和运行输出。" },
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
  { id: "terminal", label: "终端与工作区", group: "工作区与安全", description: "设置命令执行环境、默认目录和超时。项目目录在聊天中选择。" },
  { id: "security", label: "安全与审批", group: "工作区与安全", description: "管理操作审批、密钥脱敏和访问规则。" },
  { id: "browser", label: "浏览器", group: "工作区与安全", description: "配置浏览器后端与访问策略。" },
  { id: "voice", label: "语音", group: "工作区与安全", description: "设置 Hermes 语音工具使用的识别与合成服务。" },
  { id: "skills", label: "技能", group: "模型与工具", description: "查看技能说明，编辑内容并管理启用状态。" },
  { id: "skills-hub", label: "技能市场", group: "模型与工具", description: "浏览、搜索、安装和更新官方与社区技能。" },
  { id: "mcp", label: "MCP 连接", group: "模型与工具", description: "管理外部工具服务器、连接测试和账号授权。" },
  { id: "channels", label: "消息渠道", group: "运行管理", description: "按配置档案连接消息平台，管理凭据和渠道状态。" },
  { id: "profiles", label: "配置档案", group: "运行管理", description: "为不同任务管理独立的配置、模型、技能与记忆。" },
  { id: "tools", label: "工具", group: "模型与工具", description: "管理 Hermes 可用的工具集。" },
  { id: "cron", label: "定时任务", group: "运行管理", description: "创建、编辑和运行定时任务，查看执行记录。" },
  { id: "status", label: "运行状态", group: "运行管理", description: "查看服务连接、版本和运行信息。" },
  { id: "logs", label: "日志", group: "运行管理", description: "查看助手、网关与错误日志。" },
  { id: "usage", label: "用量统计", group: "运行管理", description: "查看调用次数、令牌用量和费用。" },
  { id: "keys", label: "接口密钥", group: "工作区与安全", description: "管理服务商密钥和环境变量，已保存的密钥以脱敏形式显示。" },
  { id: "config", label: "高级配置", group: "高级", description: "编辑 Hermes 的配置文件。" },
];

const sectionIcons = {
  general: Settings2, theme: Palette, fonts: TextCursor, "chat-display": MessageSquare,
  models: Cpu, skills: Sparkles, "skills-hub": Store, mcp: Plug, tools: Wrench,
  "memory-content": BookOpen, memory: Brain, compression: ListTree,
  delegation: Network, agent: Bot, terminal: Terminal, security: ShieldCheck,
  browser: Globe, voice: AudioLines, keys: KeyRound, channels: MessagesSquare,
  profiles: UserRound, cron: Clock, status: Activity, logs: Logs,
  usage: ChartNoAxesCombined, config: FileSliders,
  plugins: Package, pairing: UserCheck, webhooks: Webhook, agents: Workflow,
} satisfies Record<HermesSettingsSection, LucideIcon>;
const groupIcons: Record<string, LucideIcon> = {
  "偏好设置": SlidersHorizontal, "模型与工具": Cpu, "记忆与上下文": Brain,
  "对话与任务": MessagesSquare, "工作区与安全": ShieldCheck, "运行管理": Activity, "高级": FileSliders,
};

function SectionIcon({ section }: { section: HermesSettingsSection }) {
  const Icon = sectionIcons[section];
  return <Icon size={16} strokeWidth={1.7} aria-hidden="true" />;
}

export function HermesSettingsDialog({ section, onSectionChange, onClose, onDirtyChange, models, model, modelProvider, onModelChange, modelBusy }: {
  section: HermesSettingsSection;
  onSectionChange: (section: HermesSettingsSection) => void;
  onClose: () => void;
  onDirtyChange: (dirty: boolean) => void;
  models: string[];
  model: string;
  modelProvider?: string;
  onModelChange: (model: string, provider?: string, asDefault?: boolean) => void;
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
  const filtered = settingsSections.filter((item) => item.id !== "profiles" && `${item.id} ${item.id === "keys" ? "api keys env" : ""} ${ht(item.label)} ${ht(item.description)}`.toLowerCase().includes(query));
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
          const GroupIcon = groupIcons[group];
          return <div className="hermes-settings-menu-group" key={group}>
            <button type="button" className="hermes-settings-group-toggle" aria-expanded={open} onClick={() => setExpandedGroups(previous => ({...previous, [group]: !open}))}>
              <GroupIcon size={16} strokeWidth={1.7} aria-hidden="true" /><span>{ht(group)}</span><ChevronRight className={open ? "is-open" : ""} size={13} strokeWidth={1.7} aria-hidden="true" />
            </button>
            <div className="hermes-settings-menu-children" hidden={!open}>{items.map(item => <div key={item.id}>
              <button type="button" aria-current={section === item.id ? "page" : undefined} onClick={() => { if (section !== item.id) setConfigCategory("general"); onSectionChange(item.id); setNavigationOpen(false); }}><SectionIcon section={item.id} /><span>{ht(item.label)}</span></button>
              {section === item.id && (section === "config" || (configCategories[section]?.length ?? 0) > 1) && categoryOptions.length > 0 && <div className="hermes-settings-config-categories">{categoryOptions.map(option => <button key={option.id} type="button" aria-current={(categoryOptions.some(entry => entry.id === configCategory) ? configCategory : categoryOptions[0].id) === option.id ? "page" : undefined} onClick={() => { setConfigCategory(option.id); setNavigationOpen(false); }}>{option.label}</button>)}</div>}
            </div>)}</div>
          </div>;
        })}{!filtered.length && <p className="hermes-settings-no-results">{ht("没有找到匹配的设置")}</p>}</nav>
      </aside>
      {navigationOpen && <button className="hermes-settings-nav-backdrop" aria-label={ht("收起设置菜单")} onClick={() => setNavigationOpen(false)} />}
      <section className="hermes-settings-content" inert={navigationOpen}><header className="hermes-settings-content-header"><button type="button" ref={menuRef} className="hermes-settings-mobile-menu" aria-label={ht("打开设置菜单")} onClick={() => setNavigationOpen(true)}><HermesUiIcon name="sidebar" /></button><div><nav className="hermes-settings-breadcrumb" aria-label={ht("设置路径")}><span>{ht("设置")}</span><span aria-hidden="true">›</span><span>{ht(current.group)}</span><span aria-hidden="true">›</span><span>{ht(current.label)}</span>{(section === "config" || (configCategories[section]?.length ?? 0) > 1) && categoryOptions.length > 0 && <><span aria-hidden="true">›</span><span aria-current="page">{categoryOptions.find(item => item.id === configCategory)?.label ?? categoryOptions[0].label}</span></>}</nav><h2 className="hermes-settings-page-title">{ht(current.label)}</h2><p className="hermes-settings-description">{ht(current.description)}</p></div><button type="button" className="config-close-button" aria-label={ht("关闭设置")} onClick={onClose}>×</button></header>
        <div className="hermes-settings-section">
          {["skills-hub","mcp","channels","profiles","plugins","pairing","webhooks","agents"].includes(section) ? <HermesAdvancedModules key={section} section={section as AdvancedSection} onDirtyChange={onDirtyChange}/> : section === "general" ? <HermesGeneralPreferences /> : section === "theme" ? <HermesThemePreferences /> : section === "fonts" ? <HermesFontPreferences /> : section === "chat-display" ? <HermesChatDisplayPreferences /> : section === "memory-content" ? <HermesMemoryContent onDirtyChange={onDirtyChange} /> : section === "config" || configCategories[section] ? <HermesConfigEditor key={section} allowedCategories={configCategories[section]} visibleKeys={commonConfigFields[section]} category={configCategory} onCategoriesChange={setCategoryOptions} onDirtyChange={onDirtyChange} /> : section === "models" ? <HermesModelsConfig models={models} model={model} modelProvider={modelProvider} onModelChange={onModelChange} modelBusy={modelBusy} onDirtyChange={onDirtyChange} /> : <HermesManagement key={section} page={section as Exclude<HermesPage, "chat">} onDirtyChange={onDirtyChange} />}
        </div>
      </section>
    </div>
  </div>;
}
