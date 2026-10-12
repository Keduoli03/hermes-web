"use client";

import { useHermesI18n } from "@/hooks/useHermesI18n";

import { useEffect, useState } from "react";
import { hermesDate, hermesLabel, hermesSchedule, hermesValue } from "@/lib/hermes-display";
import { hermesJson } from "@/lib/hermes-client";
import { MarkdownBody } from "./MarkdownBody";
import { ConfigButton, ConfigDetail, ConfigDetailHeader, ConfigDetailTitle, ConfigEmptyState, ConfigField, ConfigFooter, ConfigNotice, ConfigPanelShell, ConfigSidebar, ConfigSidebarItem, ConfigSidebarList, ConfigSplitView, ConfigSwitch } from "./SettingsUi";

export type HermesPage = "chat" | "status" | "cron" | "skills" | "config" | "keys" | "logs" | "usage" | "tools";
export const hermesPages: { id: HermesPage; label: string; icon: string }[] = [
  { id: "chat", label: "聊天", icon: "◫" }, { id: "status", label: "运行状态", icon: "◉" },
  { id: "cron", label: "定时任务", icon: "◷" }, { id: "skills", label: "技能", icon: "◇" },
  { id: "config", label: "配置", icon: "⚙" }, { id: "keys", label: "接口密钥", icon: "⚿" },
  { id: "logs", label: "日志", icon: "≡" }, { id: "usage", label: "用量统计", icon: "▥" },
  { id: "tools", label: "工具", icon: "⚒" },
];
type Job = { id: string; name?: string; prompt?: string; schedule?: string | { display?: string; value?: string; kind?: string; expr?: string; minutes?: number; run_at?: string }; paused?: boolean; next_run_at?: string; last_status?: string; profile?: string; deliver?: string; model?: string; provider?: string; skills?: string[]; script?: string; workdir?: string; no_agent?: boolean };
type Skill = { name: string; description?: string; category?: string; enabled?: boolean; provenance?: string };
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
  const [newSkill, setNewSkill] = useState(false);
  const [skillName, setSkillName] = useState("");
  const [preview, setPreview] = useState(false);
  const [logFile, setLogFile] = useState("agent");
  const [days, setDays] = useState("30");
  const [deleteTarget, setDeleteTarget] = useState<string | null>(null);
  const [runs, setRuns] = useState<unknown>(null);
  const dirty = saving || ((page === "skills" || page === "config") && text !== savedText) || Boolean(keyValue) || showJobForm;
  useEffect(() => { onDirtyChange(dirty); }, [dirty, onDirtyChange]);

  useEffect(() => {
    const controller = new AbortController();
    const load = async () => {
      setLoading(true); setError("");
      try {
        const path = page === "cron" ? "/api/cron/jobs" : page === "skills" ? "/api/skills" : page === "keys" ? "/api/env" : page === "config" ? "/api/config/raw" : page === "logs" ? `/api/logs?file=${logFile}&lines=200` : page === "usage" ? `/api/analytics/usage?days=${days}` : page === "tools" ? "/api/tools/toolsets" : "/api/status";
        const body = await hermesJson<unknown>(path, { signal: controller.signal });
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
  function editJob(item?: Job) {
    setEditingJob(item?.id ?? null); setShowJobForm(true);
    setJobDraft(item ? { name: item.name ?? "", schedule: scheduleInput(item), prompt: item.prompt ?? "", deliver: item.deliver ?? "local", model: item.model ?? "", provider: item.provider ?? "", skills: item.skills?.join(", ") ?? "", script: item.script ?? "", workdir: item.workdir ?? "", no_agent: item.no_agent ?? false } : initialJob);
  }
  function saveJob() {
    const payload = { ...jobDraft, skills: jobDraft.skills.split(",").map((s) => s.trim()).filter(Boolean), model: jobDraft.model || null, provider: jobDraft.provider || null, script: jobDraft.script || null, workdir: jobDraft.workdir || null };
    const existing = jobs.find((j) => j.id === editingJob);
    void mutate(existing ? jobPath(existing) : "/api/cron/jobs", existing ? "PUT" : "POST", existing ? { updates: payload } : payload, "定时任务已保存", () => setShowJobForm(false));
  }

  return <ConfigPanelShell embedded title={hermesPages.find((p) => p.id === page)?.label ?? page} onClose={() => {}}>
    <div className="hermes-management">
      <div className="hermes-management-toolbar">
        {["cron", "skills", "keys", "logs"].includes(page) && <input aria-label={ht("筛选")} placeholder={page === "keys" ? ht("搜索提供商或变量…") : ht("筛选…")} value={filter} onChange={(e) => setFilter(e.target.value)} />}
        {page === "cron" && <ConfigButton onClick={() => editJob()}>{ht("＋ 新建任务")}</ConfigButton>}
        {page === "skills" && <ConfigButton onClick={() => { setNewSkill(true); setSelected(""); setSkillName(""); setText(ht("---\nname: my-skill\ndescription: 技能说明\n---\n\n# 使用说明\n")); setPreview(false); }}>{ht("＋ 新建技能")}</ConfigButton>}
        {page === "logs" && <select aria-label={ht("日志文件")} value={logFile} onChange={(e) => setLogFile(e.target.value)}><option value="agent">{ht("助手日志")}</option><option value="gateway">{ht("网关日志")}</option><option value="errors">{ht("错误日志")}</option></select>}
        {page === "usage" && <select aria-label={ht("统计天数")} value={days} onChange={(e) => setDays(e.target.value)}><option value="7">{ht("7 天")}</option><option value="30">{ht("30 天")}</option><option value="90">{ht("90 天")}</option></select>}
        <ConfigButton disabled={loading || saving || (page === "config" && text !== savedText)} onClick={() => setRevision((n) => n + 1)}>{ht("刷新")}</ConfigButton>
      </div>
      {error && <div role="alert"><ConfigNotice>{error}</ConfigNotice></div>}
      {notice && <div role="status"><ConfigNotice>{notice}</ConfigNotice></div>}
      {loading && <ConfigNotice>{ht("正在读取 Hermes…")}</ConfigNotice>}
      {page === "cron" && <ConfigSplitView><ConfigSidebar><ConfigSidebarList>
        {jobs.filter((j) => matches(`${j.name} ${j.prompt}`)).map((j) => <ConfigSidebarItem key={j.id} active={selected === j.id} onClick={() => { setSelected(j.id); setShowJobForm(false); setRuns(null); setDeleteTarget(null); }}><span>{j.paused ? "Ⅱ" : "◷"} {j.name || j.id}</span><small>{scheduleText(j)}</small></ConfigSidebarItem>)}
        {!loading && !jobs.length && <ConfigEmptyState>{ht("暂无定时任务")}</ConfigEmptyState>}
      </ConfigSidebarList></ConfigSidebar><ConfigDetail>
        {showJobForm ? <div className="hermes-form"><ConfigDetailTitle>{editingJob ? ht("编辑任务") : ht("新建任务")}</ConfigDetailTitle>
          {([ ["name", ht("名称")], ["schedule", ht("执行计划")], ["deliver", ht("结果投递（本地 / 平台）")], ["model", ht("模型（留空使用默认）")], ["provider", ht("提供商")], ["skills", ht("技能（逗号分隔）")], ["script", ht("脚本（脚本目录内）")], ["workdir", ht("工作目录")] ] as const).map(([key, label]) => <ConfigField key={key} label={label}><input aria-label={label} value={jobDraft[key]} onChange={(e) => setJobDraft({ ...jobDraft, [key]: e.target.value })} /></ConfigField>)}
          <ConfigField label={ht("任务提示词")}><textarea aria-label={ht("任务提示词")} rows={7} value={jobDraft.prompt} onChange={(e) => setJobDraft({ ...jobDraft, prompt: e.target.value })} /></ConfigField>
          <ConfigField label={ht("仅执行脚本")}><ConfigSwitch checked={jobDraft.no_agent} label={ht("仅执行脚本")} onChange={(no_agent) => setJobDraft({ ...jobDraft, no_agent })} /></ConfigField>
          <ConfigFooter><ConfigButton disabled={saving} onClick={() => setShowJobForm(false)}>{ht("取消")}</ConfigButton><ConfigButton variant="primary" disabled={saving || !jobDraft.schedule.trim() || (!jobDraft.prompt.trim() && !jobDraft.skills.trim() && !jobDraft.script.trim()) || (jobDraft.no_agent && !jobDraft.script.trim())} onClick={saveJob}>{ht("保存任务")}</ConfigButton></ConfigFooter>
        </div> : job ? <div className="hermes-form"><ConfigDetailTitle>{job.name || job.id}</ConfigDetailTitle><p>{scheduleText(job)} · {job.paused ? ht("已暂停") : ht("已启用")} · {hermesValue(job.profile ?? "default")}</p><p>{ht("下次运行：")}{hermesDate(job.next_run_at)}　{ht("最近状态：")}{hermesValue(job.last_status)}</p><MarkdownBody>{job.prompt ?? ""}</MarkdownBody>
          <div className="hermes-actions"><ConfigButton disabled={saving} onClick={() => editJob(job)}>{ht("编辑")}</ConfigButton><ConfigButton disabled={saving} onClick={() => void mutate(jobPath(job, job.paused ? "/resume" : "/pause"), "POST", undefined, job.paused ? ht("已恢复") : ht("已暂停"))}>{job.paused ? ht("恢复") : ht("暂停")}</ConfigButton><ConfigButton disabled={saving} onClick={() => void mutate(jobPath(job, "/trigger"), "POST", undefined, ht("已请求运行"))}>{ht("立即运行")}</ConfigButton><ConfigButton disabled={saving} onClick={() => { setSaving(true); setError(""); void hermesJson(jobPath(job, "/runs")).then(setRuns).catch((e: Error) => setError(e.message)).finally(() => setSaving(false)); }}>{ht("运行记录")}</ConfigButton><ConfigButton variant="danger" disabled={saving} onClick={() => setDeleteTarget(job.id)}>{ht("删除")}</ConfigButton></div>
          {deleteTarget === job.id && <ConfigNotice>{ht("删除任务「")}{job.name || job.id}」？ <ConfigButton onClick={() => setDeleteTarget(null)}>{ht("取消")}</ConfigButton> <ConfigButton variant="danger" disabled={saving} onClick={() => void mutate(jobPath(job), "DELETE", undefined, ht("已删除任务"), () => setSelected(""))}>{ht("确认删除")}</ConfigButton></ConfigNotice>}
          {runs !== null && <RunHistory data={runs} />}
        </div> : <ConfigEmptyState>{ht("选择一个任务，或新建定时任务")}</ConfigEmptyState>}
      </ConfigDetail></ConfigSplitView>}
      {page === "skills" && <ConfigSplitView><ConfigSidebar><ConfigSidebarList>
        {skills.filter((s) => matches(`${s.name} ${s.description}`)).map((s) => <ConfigSidebarItem key={s.name} active={selected === s.name} onClick={() => { if (text !== savedText && !window.confirm(ht("放弃未保存的技能内容？"))) return; setSelected(s.name); setNewSkill(false); setPreview(true); }}><span>{s.enabled === false ? "○" : "●"} {s.name}</span><small>{hermesLabel(s.category ?? s.provenance ?? "")}</small></ConfigSidebarItem>)}
        {!loading && !skills.length && <ConfigEmptyState>{ht("暂无技能")}</ConfigEmptyState>}
      </ConfigSidebarList></ConfigSidebar><ConfigDetail>
        {selected || newSkill ? <div className="hermes-form"><ConfigDetailHeader><ConfigDetailTitle>{newSkill ? ht("新建技能") : selected}</ConfigDetailTitle>{skill && <ConfigSwitch label={ht("启用 {name}", { name: selected })} checked={skill.enabled !== false} disabled={saving} onChange={(enabled) => void mutate("/api/skills/toggle", "PUT", { name: selected, enabled }, enabled ? ht("技能已启用") : ht("技能已禁用"))} />}</ConfigDetailHeader>
          {newSkill && <ConfigField label={ht("技能名称")}><input aria-label={ht("技能名称")} value={skillName} onChange={(e) => setSkillName(e.target.value)} placeholder="my-skill" /></ConfigField>}
          <p>{skill?.description}</p><div className="hermes-actions"><ConfigButton onClick={() => setPreview(false)} disabled={!preview}>{ht("编辑")}</ConfigButton><ConfigButton onClick={() => setPreview(true)} disabled={preview}>{ht("预览")}</ConfigButton></div>
          {preview ? <MarkdownBody>{text}</MarkdownBody> : <textarea className="hermes-editor" aria-label={ht("SKILL.md 内容")} value={text} onChange={(e) => setText(e.target.value)} spellCheck={false} />}
          <ConfigFooter status={text !== savedText ? ht("有未保存的修改") : "SKILL.md"}><ConfigButton variant="primary" disabled={saving || loading || !text.trim() || (newSkill && !skillName.trim())} onClick={() => void mutate(newSkill ? "/api/skills" : "/api/skills/content", newSkill ? "POST" : "PUT", { name: newSkill ? skillName.trim() : selected, content: text }, ht("技能内容已保存"), () => { setSavedText(text); if (newSkill) { setSelected(skillName.trim()); setNewSkill(false); } })}>{ht("保存")}</ConfigButton></ConfigFooter>
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
function RunHistory({ data }: { data: unknown }) {
  const { ht } = useHermesI18n();
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
