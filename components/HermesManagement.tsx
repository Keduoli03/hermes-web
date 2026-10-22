"use client";

import { useHermesI18n } from "@/hooks/useHermesI18n";

import { useEffect, useState } from "react";
import { ArrowLeft, CircleAlert, Clock3, FolderCog, History, Pause, Pencil, Play, Plus, RefreshCw, Save, Search, Trash2 } from "lucide-react";
import { hermesDate, hermesLabel, hermesSchedule, hermesValue } from "@/lib/hermes-display";
import { hermesJson } from "@/lib/hermes-client";
import { MarkdownBody } from "./MarkdownBody";
import { HermesSkillList, skillCategory, skillSource, type HermesSkill } from "./HermesSkillList";
import { ConfigButton, ConfigDetail, ConfigDetailActions, ConfigDetailHeader, ConfigDetailHeaderInfo, ConfigDetailTitle, ConfigEmptyState, ConfigField, ConfigFooter, ConfigNotice, ConfigPanelShell, ConfigSidebar, ConfigSidebarItem, ConfigSidebarList, ConfigSplitView, ConfigSwitch } from "./SettingsUi";

export type HermesPage = "chat" | "status" | "cron" | "skills" | "config" | "keys" | "logs" | "usage" | "tools";
export const hermesPages: { id: HermesPage; label: string; icon: string }[] = [
  { id: "chat", label: "聊天", icon: "◫" }, { id: "status", label: "运行状态", icon: "◉" },
  { id: "cron", label: "定时任务", icon: "◷" }, { id: "skills", label: "技能", icon: "◇" },
  { id: "config", label: "配置", icon: "⚙" }, { id: "keys", label: "接口密钥", icon: "⚿" },
  { id: "logs", label: "日志", icon: "≡" }, { id: "usage", label: "用量统计", icon: "▥" },
  { id: "tools", label: "工具", icon: "⚒" },
];
type Job = { id: string; name?: string; prompt?: string; schedule?: string | { display?: string; value?: string; kind?: string; expr?: string; minutes?: number; run_at?: string }; paused?: boolean; next_run_at?: string; last_status?: string; profile?: string; deliver?: string; model?: string; provider?: string; skills?: string[]; script?: string; workdir?: string; no_agent?: boolean };
type Skill = HermesSkill;
type EnvEntry = { is_set?: boolean; redacted_value?: string; description?: string; category?: string };
const scheduleText = (job: Job) => hermesSchedule(job.schedule);
const scheduleInput = (job: Job) => {
  if (typeof job.schedule === "string") return job.schedule;
  const schedule = job.schedule;
  if (schedule?.kind === "cron") return schedule.expr ?? schedule.value ?? "";
  if (schedule?.kind === "interval") return `every ${schedule.minutes}m`;
  if (schedule?.kind === "once") return schedule.run_at ?? "";
  return schedule?.value ?? scheduleText(job);
};
const pretty = (value: unknown) => JSON.stringify(value, null, 2);
const initialJob = { name: "", schedule: "0 9 * * *", prompt: "", deliver: "local", model: "", provider: "", skills: "", script: "", workdir: "", no_agent: false };

export function HermesManagement({ page, onDirtyChange }: { page: Exclude<HermesPage, "chat">; onDirtyChange: (dirty: boolean) => void }) {
  const { ht } = useHermesI18n();
  // Page is keyed by the workspace, so in-flight responses cannot populate a different panel.
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState("");
  const [notice, setNotice] = useState("");
  const [revision, setRevision] = useState(0);
  const [jobs, setJobs] = useState<Job[]>([]);
  const [skills, setSkills] = useState<Skill[]>([]);
  const [env, setEnv] = useState<Record<string, EnvEntry>>({});
  const [data, setData] = useState<unknown>(null);
  const [filter, setFilter] = useState("");
  const [selected, setSelected] = useState("");
  const [text, setText] = useState("");
  const [savedText, setSavedText] = useState("");
  const [configPath, setConfigPath] = useState("");
  const [keyName, setKeyName] = useState("");
  const [keyValue, setKeyValue] = useState("");
  const [jobDraft, setJobDraft] = useState(initialJob);
  const [editingJob, setEditingJob] = useState<string | null>(null);
  const [showJobForm, setShowJobForm] = useState(false);
  const [cronDetailOpen, setCronDetailOpen] = useState(false);
  const [newSkill, setNewSkill] = useState(false);
  const [skillName, setSkillName] = useState("");
  const [preview, setPreview] = useState(false);
  const [logFile, setLogFile] = useState("agent");
  const [days, setDays] = useState("30");
  const [deleteTarget, setDeleteTarget] = useState<string | null>(null);
  const [runsRevision, setRunsRevision] = useState(0);
  const dirty = saving || ((page === "skills" || page === "config") && text !== savedText) || Boolean(keyValue) || showJobForm;
  useEffect(() => { onDirtyChange(dirty); }, [dirty, onDirtyChange]);

  useEffect(() => {
    const controller = new AbortController();
    const load = async () => {
      setLoading(true); setError("");
      try {
        const path = page === "cron" ? "/api/cron/jobs" : page === "skills" ? "/api/skills" : page === "keys" ? "/api/env" : page === "config" ? "/api/config/raw" : page === "logs" ? `/api/logs?file=${logFile}&lines=200` : page === "usage" ? `/api/analytics/usage?days=${days}` : page === "tools" ? "/api/tools/toolsets" : "/api/status";
        const body = await hermesJson<unknown>(path, { signal: controller.signal, ...(revision ? { cache: "reload" } : {}) });
        if (controller.signal.aborted) return;
        if (page === "cron") setJobs(Array.isArray(body) ? body : (body as { jobs?: Job[] }).jobs ?? []);
        else if (page === "skills") setSkills(Array.isArray(body) ? body : (body as { skills?: Skill[] }).skills ?? []);
        else if (page === "keys") setEnv(body as Record<string, EnvEntry>);
        else if (page === "config") { const raw = body as { yaml: string; path?: string }; setText(raw.yaml); setSavedText(raw.yaml); setConfigPath(raw.path ?? "config.yaml"); }
        else setData(body);
      } catch (e) { if (!controller.signal.aborted) setError(e instanceof Error ? e.message : String(e)); }
      finally { if (!controller.signal.aborted) setLoading(false); }
    };
    void load();
    return () => controller.abort();
  }, [page, revision, logFile, days]);

  useEffect(() => {
    if (page !== "skills" || !selected || newSkill) return;
    const controller = new AbortController();
    setText(""); setSavedText(""); setLoading(true);
    hermesJson<{ content: string }>(`/api/skills/content?name=${encodeURIComponent(selected)}`, { signal: controller.signal })
      .then((body) => { if (!controller.signal.aborted) { setText(body.content); setSavedText(body.content); } })
      .catch((e: unknown) => { if (!controller.signal.aborted) setError(e instanceof Error ? e.message : String(e)); })
      .finally(() => { if (!controller.signal.aborted) setLoading(false); });
    return () => controller.abort();
  }, [page, selected, newSkill]);

  useEffect(() => {
    if (text === savedText && !keyValue) return;
    const warn = (event: BeforeUnloadEvent) => { event.preventDefault(); };
    window.addEventListener("beforeunload", warn);
    return () => window.removeEventListener("beforeunload", warn);
  }, [text, savedText, keyValue]);

  async function mutate(path: string, method: string, body?: unknown, success = "已保存", after?: () => void) {
    setSaving(true); setError(""); setNotice("");
    try {
      await hermesJson(path, { method, ...(body === undefined ? {} : { body: JSON.stringify(body) }) });
      after?.(); setNotice(success); setRevision((n) => n + 1); setDeleteTarget(null);
    } catch (e) { setError(e instanceof Error ? e.message : String(e)); }
    finally { setSaving(false); }
  }
  const jobPath = (job: Job, action = "") => `/api/cron/jobs/${encodeURIComponent(job.id)}${action}?profile=${encodeURIComponent(job.profile ?? "default")}`;
  const job = jobs.find((j) => j.id === selected);
  const skill = skills.find((s) => s.name === selected);
  const matches = (value: string) => value.toLowerCase().includes(filter.toLowerCase());
  const visibleJobs = jobs.filter(item => matches(`${item.name ?? ""} ${item.prompt ?? ""} ${item.profile ?? ""} ${scheduleText(item)}`));
  const canSaveJob = !saving && Boolean(jobDraft.schedule.trim() && (jobDraft.prompt.trim() || jobDraft.skills.trim() || jobDraft.script.trim()) && (!jobDraft.no_agent || jobDraft.script.trim()));
  const jobStatus = (value?: string) => value === "delivery_failed" ? ht("投递失败") : ht(hermesValue(value));
  function editJob(item?: Job) {
    if (saving || showJobForm && !window.confirm(ht("放弃未保存的修改？"))) return;
    setEditingJob(item?.id ?? null); setShowJobForm(true);setCronDetailOpen(true);
    setJobDraft(item ? { name: item.name ?? "", schedule: scheduleInput(item), prompt: item.prompt ?? "", deliver: item.deliver ?? "local", model: item.model ?? "", provider: item.provider ?? "", skills: item.skills?.join(", ") ?? "", script: item.script ?? "", workdir: item.workdir ?? "", no_agent: item.no_agent ?? false } : initialJob);
  }
  function saveJob() {
    if (!canSaveJob) return;
    const payload = { ...jobDraft, skills: jobDraft.skills.split(",").map((s) => s.trim()).filter(Boolean), model: jobDraft.model || null, provider: jobDraft.provider || null, script: jobDraft.script || null, workdir: jobDraft.workdir || null };
    const existing = jobs.find((j) => j.id === editingJob);
    void mutate(existing ? jobPath(existing) : "/api/cron/jobs", existing ? "PUT" : "POST", existing ? { updates: payload } : payload, "定时任务已保存", () => {setShowJobForm(false);if(!existing)setCronDetailOpen(false);});
  }
  function createSkill() {
    if (text !== savedText && !window.confirm(ht("放弃未保存的技能内容？"))) return;
    setNewSkill(true); setSelected(""); setSkillName("");
    setText(ht("---\nname: my-skill\ndescription: 技能说明\n---\n\n# 使用说明\n")); setPreview(false);
  }

  return <ConfigPanelShell embedded title={hermesPages.find((p) => p.id === page)?.label ?? page} onClose={() => {}}>
    <div className={`hermes-management${page === "skills" ? " hermes-skills" : page === "cron" ? ` hermes-cron${cronDetailOpen ? " is-cron-detail-open" : ""}` : ""}`}>
      {page !== "skills" && page !== "cron" && <div className="hermes-management-toolbar">
        {["cron", "keys", "logs"].includes(page) && <input aria-label={ht("筛选")} placeholder={page === "keys" ? ht("搜索提供商或变量…") : ht("筛选…")} value={filter} onChange={(e) => setFilter(e.target.value)} />}
        {page === "logs" && <select aria-label={ht("日志文件")} value={logFile} onChange={(e) => setLogFile(e.target.value)}><option value="agent">{ht("助手日志")}</option><option value="gateway">{ht("网关日志")}</option><option value="errors">{ht("错误日志")}</option></select>}
        {page === "usage" && <select aria-label={ht("统计天数")} value={days} onChange={(e) => setDays(e.target.value)}><option value="7">{ht("7 天")}</option><option value="30">{ht("30 天")}</option><option value="90">{ht("90 天")}</option></select>}
        <ConfigButton disabled={loading || saving || (page === "config" && text !== savedText)} onClick={() => setRevision((n) => n + 1)}>{ht("刷新")}</ConfigButton>
      </div>}
      {error && <div role="alert"><ConfigNotice>{error}</ConfigNotice></div>}
      {notice && <div role="status"><ConfigNotice>{notice}</ConfigNotice></div>}
      {loading && <ConfigNotice>{ht("正在读取 Hermes…")}</ConfigNotice>}
      {page === "cron" && <ConfigSplitView><ConfigSidebar>
        <div className="hermes-cron-list-toolbar">
          <label className="hermes-cron-search"><Search size={15} aria-hidden="true"/><input aria-label={ht("筛选")} placeholder={ht("搜索任务…")} value={filter} onChange={event=>setFilter(event.target.value)}/></label>
          <ConfigButton className="hermes-cron-icon-button" title={ht("新建任务")} aria-label={ht("新建任务")} disabled={loading || saving} onClick={()=>editJob()}><Plus size={16} aria-hidden="true"/></ConfigButton>
          <ConfigButton className="hermes-cron-icon-button" title={ht("刷新")} aria-label={ht("刷新")} disabled={loading || saving || showJobForm} onClick={()=>setRevision(value=>value+1)}><RefreshCw size={15} aria-hidden="true"/></ConfigButton>
        </div>
        <div className="hermes-cron-list-count">{ht("任务列表")}<span>{visibleJobs.length} / {jobs.length}</span></div>
        <ConfigSidebarList>
        {visibleJobs.map(item=><ConfigSidebarItem key={item.id} className="hermes-cron-task" title={item.name || item.id} disabled={saving} active={showJobForm ? editingJob===item.id : selected===item.id} onClick={()=>{
          if(showJobForm && !window.confirm(ht("放弃未保存的修改？")))return;
          setSelected(item.id);setShowJobForm(false);setCronDetailOpen(true);setDeleteTarget(null);
        }}>
          {item.paused ? <Pause size={16} aria-hidden="true"/> : <Clock3 size={16} aria-hidden="true"/>}
          <span className="hermes-cron-task-info"><span className="hermes-cron-task-name">{item.name || item.id}</span><code title={scheduleText(item)}>{scheduleText(item)}</code><span className="hermes-cron-task-meta"><span className="hermes-cron-state" data-paused={Boolean(item.paused)}>{ht(item.paused ? "已暂停" : "已启用")}</span><span title={item.profile ?? "default"}>{hermesValue(item.profile ?? "default")}</span></span></span>
        </ConfigSidebarItem>)}
        {!loading && !visibleJobs.length && <ConfigEmptyState>{ht(jobs.length ? "没有匹配的任务" : "暂无定时任务")}</ConfigEmptyState>}
      </ConfigSidebarList></ConfigSidebar><ConfigDetail>
        {showJobForm ? <form className="hermes-cron-editor" aria-label={ht(editingJob ? "编辑任务" : "新建任务")} onSubmit={event=>{event.preventDefault();saveJob();}}>
          <header className="hermes-cron-editor-header"><button type="button" className="hermes-cron-back" onClick={()=>setCronDetailOpen(false)}><ArrowLeft size={15} aria-hidden="true"/>{ht("返回任务列表")}</button><h2>{ht(editingJob ? "编辑任务" : "新建任务")}</h2>{editingJob && <p>{jobs.find(item=>item.id===editingJob)?.name || editingJob}</p>}</header>
          <fieldset><legend>{ht("基本信息")}</legend><div className="hermes-cron-form-grid">
            {([ ["name", ht("名称")], ["schedule", ht("执行计划")], ["deliver", ht("结果投递（本地 / 平台）")] ] as const).map(([key,label])=><ConfigField key={key} label={label}><input aria-label={label} value={jobDraft[key]} disabled={saving} onChange={event=>setJobDraft({...jobDraft,[key]:event.target.value})}/></ConfigField>)}
          </div></fieldset>
          <ConfigField label={ht("任务提示词")}><textarea aria-label={ht("任务提示词")} rows={10} disabled={saving} value={jobDraft.prompt} onChange={event=>setJobDraft({...jobDraft,prompt:event.target.value})}/></ConfigField>
          <details className="hermes-cron-advanced"><summary>{ht("高级选项")}</summary><div className="hermes-cron-form-grid">
            {([ ["model", ht("模型（留空使用默认）")], ["provider", ht("提供商")], ["skills", ht("技能（逗号分隔）")], ["script", ht("脚本（脚本目录内）")], ["workdir", ht("工作目录")] ] as const).map(([key,label])=><ConfigField key={key} label={label}><input aria-label={label} disabled={saving} value={jobDraft[key]} onChange={event=>setJobDraft({...jobDraft,[key]:event.target.value})}/></ConfigField>)}
            <ConfigField label={ht("仅执行脚本")}><ConfigSwitch checked={jobDraft.no_agent} disabled={saving} label={ht("仅执行脚本")} onChange={no_agent=>setJobDraft({...jobDraft,no_agent})}/></ConfigField>
          </div></details>
          <ConfigFooter><ConfigButton disabled={saving} onClick={()=>{setShowJobForm(false);if(!editingJob)setCronDetailOpen(false);}}>{ht("取消")}</ConfigButton><ConfigButton type="submit" variant="primary" disabled={!canSaveJob}><Save size={15} aria-hidden="true"/>{ht("保存任务")}</ConfigButton></ConfigFooter>
        </form> : job ? <article className="hermes-cron-detail" aria-label={ht("任务详情")}>
          <header className="hermes-cron-detail-header">
            <button type="button" className="hermes-cron-back" onClick={()=>setCronDetailOpen(false)}><ArrowLeft size={15} aria-hidden="true"/>{ht("返回任务列表")}</button>
            <ConfigDetailHeader className="hermes-detail-heading is-top-aligned">
              <ConfigDetailHeaderInfo><div><h2>{job.name || job.id}</h2><div className="hermes-cron-heading-meta"><span className="hermes-cron-state" data-paused={Boolean(job.paused)}>{ht(job.paused ? "已暂停" : "已启用")}</span><span><FolderCog size={14} aria-hidden="true"/>{hermesValue(job.profile ?? "default")}</span>{job.no_agent && <span>{ht("仅执行脚本")}</span>}</div></div></ConfigDetailHeaderInfo>
              <ConfigDetailActions><ConfigButton variant="primary" disabled={saving} onClick={()=>editJob(job)}><Pencil size={14} aria-hidden="true"/>{ht("编辑")}</ConfigButton></ConfigDetailActions>
            </ConfigDetailHeader>
            <div className="hermes-detail-toolbar hermes-cron-actions">
              <ConfigButton className="hermes-detail-danger" variant="danger" disabled={saving} onClick={()=>setDeleteTarget(job.id)}><Trash2 size={14} aria-hidden="true"/>{ht("删除")}</ConfigButton>
              <ConfigDetailActions>
                <ConfigButton disabled={saving} onClick={()=>void mutate(jobPath(job,job.paused?"/resume":"/pause"),"POST",undefined,job.paused?ht("已恢复"):ht("已暂停"))}>{job.paused ? <Play size={14} aria-hidden="true"/> : <Pause size={14} aria-hidden="true"/>}{ht(job.paused?"恢复":"暂停")}</ConfigButton>
                <ConfigButton disabled={saving} onClick={()=>void mutate(jobPath(job,"/trigger"),"POST",undefined,ht("已请求运行"))}><Play size={14} aria-hidden="true"/>{ht("立即运行")}</ConfigButton>
                <ConfigButton disabled={saving} onClick={()=>setRunsRevision(value=>value+1)}><History size={14} aria-hidden="true"/>{ht("运行记录")}</ConfigButton>
              </ConfigDetailActions>
            </div>
          </header>
          <dl className="hermes-cron-summary"><div><dt>{ht("执行计划")}</dt><dd><code>{scheduleText(job)}</code></dd></div><div><dt>{ht("下次运行")}</dt><dd>{hermesDate(job.next_run_at)}</dd></div><div><dt>{ht("最近状态")}</dt><dd className="hermes-cron-result" data-error={/fail|error/.test(job.last_status ?? "")} title={job.last_status}>{/fail|error/.test(job.last_status ?? "") && <CircleAlert size={14} aria-hidden="true"/>}{jobStatus(job.last_status)}</dd></div></dl>
          <RunHistory key={jobPath(job)} path={jobPath(job,"/runs")} revision={runsRevision} />
          <section className="hermes-cron-prompt"><h3>{ht("任务提示词")}</h3><div className="hermes-cron-document">{job.prompt ? <MarkdownBody>{job.prompt}</MarkdownBody> : <p>{ht("未设置任务提示词")}</p>}</div></section>
          <details className="hermes-cron-advanced"><summary>{ht("执行配置")}</summary><dl className="hermes-cron-config">{[[ht("结果投递（本地 / 平台）"),hermesValue(job.deliver || "local")],[ht("模型"),job.model || ht("跟随默认")],[ht("提供商"),job.provider || ht("跟随默认")],[ht("工作目录"),job.workdir || ht("跟随默认")],...(job.skills?.length ? [[ht("技能"),job.skills.join(", ")]] : []),...(job.script ? [[ht("脚本（脚本目录内）"),job.script]] : [])].map(([label,value])=><div key={label}><dt>{label}</dt><dd>{value}</dd></div>)}</dl></details>
          {deleteTarget === job.id && <ConfigNotice>{ht("删除任务「")}{job.name || job.id}」？ <ConfigButton onClick={() => setDeleteTarget(null)}>{ht("取消")}</ConfigButton> <ConfigButton variant="danger" disabled={saving} onClick={() => void mutate(jobPath(job), "DELETE", undefined, ht("已删除任务"), () => {setSelected("");setCronDetailOpen(false);})}>{ht("确认删除")}</ConfigButton></ConfigNotice>}
        </article> : <ConfigEmptyState>{ht("选择一个任务，或新建定时任务")}</ConfigEmptyState>}
      </ConfigDetail></ConfigSplitView>}
      {page === "skills" && <ConfigSplitView><HermesSkillList skills={skills} query={filter} selected={selected} busy={saving} loading={loading} onQueryChange={setFilter} onCreate={createSkill} onRefresh={()=>setRevision(n=>n+1)} onSelect={s=>{if(text !== savedText && !window.confirm(ht("放弃未保存的技能内容？")))return;setSelected(s.name);setNewSkill(false);setPreview(true);}} onToggle={(s,enabled)=>void mutate("/api/skills/toggle","PUT",{name:s.name,enabled},enabled ? ht("技能已启用") : ht("技能已禁用"))}/><ConfigDetail>
        {selected || newSkill ? <div className="hermes-form"><ConfigDetailHeader><ConfigDetailTitle>{newSkill ? ht("新建技能") : selected}</ConfigDetailTitle></ConfigDetailHeader>
          {skill && <div className="hermes-skill-detail-meta"><span>{ht(skillCategory(skill.category))}</span>{skillSource(skill.provenance) && <span>{ht(skillSource(skill.provenance))}</span>}<span>{ht(skill.enabled === false ? "已禁用" : "已启用")}</span>{skill.usage !== undefined && <span>{ht("已使用 {count} 次",{count:skill.usage})}</span>}</div>}
          {newSkill && <ConfigField label={ht("技能名称")}><input aria-label={ht("技能名称")} value={skillName} onChange={(e) => setSkillName(e.target.value)} placeholder="my-skill" /></ConfigField>}
          {skill?.description && <p className="hermes-skill-description">{skill.description}</p>}<div className="hermes-skill-view-tabs" role="group" aria-label={ht("技能内容视图")}><button type="button" aria-pressed={preview} onClick={()=>setPreview(true)}>{ht("预览")}</button><button type="button" aria-pressed={!preview} onClick={()=>setPreview(false)}>{ht("编辑")}</button></div>
          {preview ? <div className="hermes-skill-document"><MarkdownBody>{text}</MarkdownBody></div> : <textarea className="hermes-editor" aria-label={ht("SKILL.md 内容")} value={text} onChange={(e) => setText(e.target.value)} spellCheck={false} />}
          {(!preview || text !== savedText) && <ConfigFooter status={text !== savedText ? ht("有未保存的修改") : "SKILL.md"}><ConfigButton variant="primary" disabled={saving || loading || !text.trim() || (!newSkill && text === savedText) || (newSkill && !skillName.trim())} onClick={() => void mutate(newSkill ? "/api/skills" : "/api/skills/content", newSkill ? "POST" : "PUT", { name: newSkill ? skillName.trim() : selected, content: text }, ht("技能内容已保存"), () => { setSavedText(text); if (newSkill) { setSelected(skillName.trim()); setNewSkill(false); } })}>{ht("保存")}</ConfigButton></ConfigFooter>}
        </div> : <ConfigEmptyState>{ht("选择一个技能查看、编辑或启停")}</ConfigEmptyState>}
      </ConfigDetail></ConfigSplitView>}
      {page === "config" && <ConfigDetail><div className="hermes-form"><ConfigDetailTitle>{ht("配置文件")}</ConfigDetailTitle><code>{configPath}</code><p>{ht("编辑 Hermes 的 config.yaml；保存前由官方后端验证 YAML。")}</p><textarea className="hermes-editor" aria-label="Config YAML" disabled={loading} value={text} onChange={(e) => setText(e.target.value)} spellCheck={false} /><ConfigFooter status={text !== savedText ? ht("有未保存的修改") : ht("已与后端同步")}><ConfigButton disabled={saving || loading || text === savedText} onClick={() => setText(savedText)}>{ht("还原")}</ConfigButton><ConfigButton variant="primary" disabled={saving || loading || text === savedText} onClick={() => void mutate("/api/config/raw", "PUT", { yaml_text: text }, ht("配置已保存"), () => setSavedText(text))}>{ht("保存配置")}</ConfigButton></ConfigFooter></div></ConfigDetail>}
      {page === "keys" && <ConfigSplitView><ConfigSidebar><ConfigSidebarList>
        <ConfigSidebarItem active={!keyName} onClick={() => { setKeyName(""); setKeyValue(""); setDeleteTarget(null); }}>{ht("＋ 自定义变量")}</ConfigSidebarItem>
        {Object.entries(env).filter(([name, entry]) => matches(`${name} ${hermesLabel(entry.category ?? "")} ${entry.description}`)).map(([name, entry]) => <ConfigSidebarItem key={name} active={keyName === name} onClick={() => { setKeyName(name); setKeyValue(""); setDeleteTarget(null); }}><span>{entry.is_set ? "●" : "○"} {name}</span><small>{hermesLabel(entry.category ?? "")}</small></ConfigSidebarItem>)}
      </ConfigSidebarList></ConfigSidebar><ConfigDetail><div className="hermes-form"><ConfigDetailTitle>{ht("密钥与环境变量")}</ConfigDetailTitle><ConfigField label={ht("变量名")}><input aria-label={ht("变量名")} autoComplete="off" value={keyName} onChange={(e) => { setKeyName(e.target.value); setKeyValue(""); }} placeholder="OPENROUTER_API_KEY" /></ConfigField><p>{env[keyName]?.description}</p><p>{ht("当前值：")}<code>{env[keyName]?.is_set ? env[keyName].redacted_value || ht("已设置（隐藏）") : ht("未设置")}</code></p><ConfigField label={ht("新值")}><input aria-label={ht("新值")} type="password" autoComplete="new-password" value={keyValue} onChange={(e) => setKeyValue(e.target.value)} placeholder={ht("输入新值后保存")} /></ConfigField><ConfigFooter status={ht("密钥以脱敏形式显示")}><ConfigButton variant="danger" disabled={saving || !env[keyName]?.is_set} onClick={() => setDeleteTarget(keyName)}>{ht("删除")}</ConfigButton><ConfigButton variant="primary" disabled={saving || loading || !/^[A-Za-z_][A-Za-z0-9_]*$/.test(keyName) || !keyValue} onClick={() => void mutate("/api/env", "PUT", { key: keyName, value: keyValue }, ht("变量已保存"), () => setKeyValue(""))}>{ht("保存")}</ConfigButton></ConfigFooter>
        {deleteTarget === keyName && <ConfigNotice>{ht("删除")}{keyName}？<ConfigButton onClick={() => setDeleteTarget(null)}>{ht("取消")}</ConfigButton><ConfigButton disabled={saving} variant="danger" onClick={() => void mutate("/api/env", "DELETE", { key: keyName }, ht("变量已删除"), () => setKeyValue(""))}>{ht("确认删除")}</ConfigButton></ConfigNotice>}
      </div></ConfigDetail></ConfigSplitView>}
      {["status", "logs", "usage"].includes(page) && <ConfigDetail><div className="hermes-form">{data !== null && (page === "logs" ? <pre className="hermes-json">{((data as { lines?: string[] }).lines ?? []).filter(matches).join("\n") || ht("暂无日志")}</pre> : page === "usage" ? <UsageSummary data={data} /> : <StatusSummary data={data} />)}</div></ConfigDetail>}
      {page === "tools" && <ConfigDetail><div className="hermes-form"><ConfigDetailTitle>{ht("Hermes 工具集")}</ConfigDetailTitle>{(Array.isArray(data) ? data as { name: string; label?: string; description?: string; enabled: boolean; tools?: string[] }[] : []).map((toolset) => <div className="hermes-toolset" key={toolset.name}><div><strong>{hermesLabel(toolset.name) === toolset.name ? toolset.label || toolset.name : hermesLabel(toolset.name)}</strong><p>{toolset.description}</p><code>{toolset.tools?.join(", ")}</code></div><ConfigSwitch label={ht("启用 {name}", { name: hermesLabel(toolset.name) })} checked={toolset.enabled} disabled={saving} onChange={(enabled) => void mutate(`/api/tools/toolsets/${encodeURIComponent(toolset.name)}`, "PUT", { enabled }, ht("工具集已保存"))} /></div>)}</div></ConfigDetail>}
    </div>
  </ConfigPanelShell>;
}

type RunRecord = { id?: string; session_id?: string; status?: string; started_at?: string | number; output?: string; preview?: string; message_count?: number };
function RunHistory({ path, revision }: { path: string; revision: number }) {
  const { ht } = useHermesI18n();
  const [data, setData] = useState<unknown>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [retry, setRetry] = useState(0);
  useEffect(() => {
    const controller = new AbortController();
    setLoading(true); setError("");
    hermesJson(path, { signal: controller.signal }).then(body => {
      if (!controller.signal.aborted) setData(body);
    }).catch((cause: unknown) => {
      if (!controller.signal.aborted) setError(cause instanceof Error ? cause.message : String(cause));
    }).finally(() => { if (!controller.signal.aborted) setLoading(false); });
    return () => controller.abort();
  }, [path, revision, retry]);
  if (loading) return <ConfigNotice>{ht("正在读取 Hermes…")}</ConfigNotice>;
  if (error) return <div role="alert"><ConfigNotice>{error} <ConfigButton onClick={()=>setRetry(value=>value+1)}>{ht("刷新")}</ConfigButton></ConfigNotice></div>;
  if (data === null) return null;
  const records = Array.isArray(data) ? data as RunRecord[] : (data as { runs?: RunRecord[] }).runs ?? [];
  return <section className="hermes-run-history" aria-label={ht("任务运行记录")}><h3>{ht("运行记录")}</h3>{!records.length ? <ConfigEmptyState>{ht("暂无运行记录")}</ConfigEmptyState> : records.map((run, index) => <article className="hermes-run-card" key={run.id ?? run.session_id ?? index}><header><strong>{hermesValue(run.status)}</strong><time>{hermesDate(run.started_at)}</time></header>{run.message_count !== undefined && <p>{run.message_count} {ht("条消息")}</p>}{(run.output || run.preview) && <div className="hermes-run-output">{run.output || run.preview}</div>}<details><summary>{ht("原始记录")}</summary><pre className="hermes-json">{pretty(run)}</pre></details></article>)}</section>;
}

function StatusSummary({ data }: { data: unknown }) {
  const { ht } = useHermesI18n();
  const status = data as Record<string, unknown>;
  return <><div className="hermes-status-grid">{Object.entries(status).filter(([, value]) => value === null || typeof value !== "object").map(([key, value]) => <div className="hermes-stat" key={key}><span>{hermesLabel(key)}</span><strong>{typeof value === "boolean" ? value ? ht("已启用") : ht("未启用") : hermesValue(value === null ? null : String(value))}</strong></div>)}</div><details><summary>{ht("完整状态")}</summary><pre className="hermes-json">{pretty(data)}</pre></details></>;
}

type UsageRow = { model?: string; day?: string; sessions?: number; input_tokens?: number; output_tokens?: number; estimated_cost?: number };
function UsageSummary({ data }: { data: unknown }) {
  const { ht } = useHermesI18n();
  const usage = data as { totals?: Record<string, number | null>; by_model?: UsageRow[]; daily?: UsageRow[] };
  const totals = usage.totals ?? {};
  const number = (value?: number | null) => (value ?? 0).toLocaleString();
  return <><div className="hermes-status-grid">{Object.entries(totals).map(([key, value]) => <div className="hermes-stat" key={key}><span>{hermesLabel(key)}</span><strong>{key.includes("cost") ? `$${(value ?? 0).toFixed(4)}` : number(value)}</strong></div>)}</div>
    {[{ title: ht("按模型"), rows: usage.by_model ?? [], column: "model" as const }, { title: ht("每日用量"), rows: usage.daily ?? [], column: "day" as const }].map(({ title, rows, column }) => <div key={title}><h3>{title}</h3><div className="hermes-table-scroll"><table className="hermes-table"><thead><tr><th>{column === "model" ? ht("模型") : ht("日期")}</th><th>{ht("会话")}</th><th>{ht("输入令牌")}</th><th>{ht("输出令牌")}</th><th>{ht("预估费用")}</th></tr></thead><tbody>{rows.map((row, index) => <tr key={index}><td>{row[column] ?? "—"}</td><td>{number(row.sessions)}</td><td>{number(row.input_tokens)}</td><td>{number(row.output_tokens)}</td><td>${(row.estimated_cost ?? 0).toFixed(4)}</td></tr>)}</tbody></table>{!rows.length && <ConfigEmptyState>{ht("暂无用量记录")}</ConfigEmptyState>}</div></div>)}
    <details><summary>{ht("完整用量数据")}</summary><pre className="hermes-json">{pretty(data)}</pre></details></>;
}
