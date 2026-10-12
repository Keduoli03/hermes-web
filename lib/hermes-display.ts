/** UI labels only; wire identifiers and user-authored content stay untouched. */
const labels: Record<string, string> = {
  version: "版本", hermes_version: "Hermes 版本", status: "状态", gateway_running: "网关运行状态",
  gateway_connected: "网关连接", gateway_pid: "网关进程", active_sessions: "活跃会话", uptime: "运行时长",
  config_path: "配置文件", hermes_home: "数据目录", model: "模型", provider: "提供商", profile: "配置档案",
  total_input: "输入令牌", total_output: "输出令牌", total_cache_read: "缓存读取令牌", total_reasoning: "推理令牌",
  total_estimated_cost: "预估费用", total_actual_cost: "实际费用", total_sessions: "会话数", total_api_calls: "调用次数",
  started_at: "开始时间", last_active: "最近活动", api_server_running: "接口服务状态", source: "来源",
  bundled: "内置", agent: "助手", external: "外部", hub: "技能库", development: "开发", productivity: "效率",
  creative: "创作", research: "研究", custom: "自定义", tools: "工具", messaging: "消息平台", providers: "提供商",
  terminal: "终端", browser: "浏览器", web: "网页", vision: "视觉", memory: "记忆", skills: "技能",
};
const values: Record<string, string> = {
  default: "默认", local: "仅保存到本地", running: "运行中", started: "已开始", queued: "排队中",
  completed: "已完成", success: "成功", failed: "失败", error: "错误", interrupted: "已中断", cancelled: "已取消",
  paused: "已暂停", pending: "等待中", enabled: "已启用", disabled: "已禁用", connected: "已连接",
  disconnected: "未连接", healthy: "正常", ok: "正常", ready: "就绪", stopped: "已停止",
};
export const hermesLabel = (key: string) => labels[key] ?? key;
export const hermesValue = (value?: string | null) => value ? values[value] ?? value : "—";

export function hermesDate(value?: string | number | null): string {
  if (value === undefined || value === null || value === "") return "—";
  const date = new Date(typeof value === "number" && value < 1e12 ? value * 1000 : value);
  if (!Number.isFinite(date.getTime())) return String(value);
  return new Intl.DateTimeFormat("zh-CN", { timeZone: "Asia/Shanghai", year: "numeric", month: "2-digit", day: "2-digit", hour: "2-digit", minute: "2-digit" }).format(date);
}

export function hermesSchedule(schedule?: string | { kind?: string; display?: string; value?: string; expr?: string; minutes?: number; run_at?: string }): string {
  if (typeof schedule === "string") return schedule;
  if (schedule?.kind === "interval") return `每 ${schedule.minutes} 分钟`;
  if (schedule?.kind === "once") return `单次 · ${hermesDate(schedule.run_at)}`;
  return schedule?.expr ?? schedule?.value ?? schedule?.display ?? "—";
}
