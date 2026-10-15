"use client";

import { useState } from "react";
import { Plus, RefreshCw, Search } from "lucide-react";
import { useHermesI18n } from "@/hooks/useHermesI18n";
import { ConfigEmptyState, ConfigSidebar, ConfigSidebarList, ConfigSwitch } from "./SettingsUi";

export type HermesSkill = { name: string; description?: string; category?: string; enabled?: boolean; provenance?: string; usage?: number };

export function skillCategory(category?: string) {
  const names: Record<string, string> = {
    development: "开发", "software-development": "软件开发", productivity: "效率", creative: "创作",
    research: "研究", devops: "运维", general: "通用", "autonomous-ai-agents": "自主智能体",
    "data-science": "数据科学", email: "邮件", gaming: "游戏", github: "代码协作", media: "媒体",
    business: "商业", finance: "财务", social: "社交", tools: "工具", web: "网页", security: "安全",
  };
  return category ? names[category.toLowerCase()] ?? category : "通用";
}

export function skillSource(provenance?: string) {
  return ({ bundled: "内置", agent: "本地", hub: "技能市场", external: "外部挂载" } as Record<string, string>)[provenance ?? ""];
}

export function HermesSkillList({ skills, query, selected, busy, loading, onSelect, onToggle, onQueryChange, onCreate, onRefresh }: {
  skills: HermesSkill[];
  query: string;
  selected: string;
  busy: boolean;
  loading: boolean;
  onSelect: (skill: HermesSkill) => void;
  onToggle: (skill: HermesSkill, enabled: boolean) => void;
  onQueryChange: (query: string) => void;
  onCreate: () => void;
  onRefresh: () => void;
}) {
  const { ht } = useHermesI18n();
  const [sort, setSort] = useState("usage");
  const search = query.toLowerCase().trim();
  const visible = skills.filter(skill => `${skill.name} ${skill.description ?? ""} ${skill.category ?? ""} ${ht(skillCategory(skill.category))}`.toLowerCase().includes(search)).sort((a, b) => {
    if (sort === "usage") return (b.usage ?? -1) - (a.usage ?? -1) || a.name.localeCompare(b.name);
    if (sort === "category") return ht(skillCategory(a.category)).localeCompare(ht(skillCategory(b.category))) || a.name.localeCompare(b.name);
    return a.name.localeCompare(b.name);
  });
  return <ConfigSidebar>
    <div className="hermes-skill-list-toolbar">
      <label className="hermes-skills-search"><Search size={16} aria-hidden="true"/><input aria-label={ht("搜索技能")} placeholder={ht("搜索技能名称、说明或分类…")} value={query} onChange={event=>onQueryChange(event.target.value)}/></label>
      <button className="hermes-skill-list-action" type="button" aria-label={ht("＋ 新建技能")} title={ht("新建技能")} disabled={busy} onClick={onCreate}><Plus size={17}/></button>
      <button className="hermes-skill-list-action" type="button" aria-label={ht("刷新")} title={ht("刷新")} disabled={loading || busy} onClick={onRefresh}><RefreshCw size={16}/></button>
    </div>
    <div className="hermes-skill-list-heading"><span>{ht("{count} 个技能", { count: visible.length })}</span>
      <select aria-label={ht("技能排序")} value={sort} onChange={event => setSort(event.target.value)}>
        <option value="usage">{ht("最常用")}</option><option value="name">{ht("按名称")}</option><option value="category">{ht("按分类")}</option>
      </select>
    </div>
    <ConfigSidebarList>
      {visible.map(skill => <div className="hermes-skill-row" key={skill.name} data-selected={selected === skill.name}>
        <button type="button" className="hermes-skill-select" aria-label={skill.name} aria-current={selected === skill.name ? "page" : undefined} disabled={busy} onClick={() => onSelect(skill)}>
          <strong>{skill.name}</strong><span className="hermes-skill-meta"><span>{ht(skillCategory(skill.category))}</span>{skillSource(skill.provenance) && <small>{ht(skillSource(skill.provenance))}</small>}</span>
        </button>
        <span className="hermes-skill-usage" aria-label={skill.usage === undefined ? ht("暂无使用统计") : ht("已使用 {count} 次", { count: skill.usage })} title={skill.usage === undefined ? ht("暂无使用统计") : ht("已使用 {count} 次", { count: skill.usage })}>{skill.usage === undefined ? "—" : `×${skill.usage}`}</span>
        <ConfigSwitch label={ht("启用 {name}", { name: skill.name })} checked={skill.enabled !== false} disabled={busy} onChange={enabled => onToggle(skill, enabled)} />
      </div>)}
      {!loading && !visible.length && <ConfigEmptyState>{ht(skills.length ? "没有匹配的技能" : "暂无技能")}</ConfigEmptyState>}
    </ConfigSidebarList>
  </ConfigSidebar>;
}
