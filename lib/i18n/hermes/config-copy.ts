import copy from "./fields.json";

// Curated desktop copy is MIT licensed by Nous Research; see ./LICENSE.
const words: Record<string, string> = {
  enabled: "启用", disabled: "禁用", enable: "启用", auto: "自动", max: "最大", min: "最小", timeout: "超时", seconds: "秒", minutes: "分钟", hours: "小时", days: "天", ms: "毫秒", limit: "上限", threshold: "阈值", interval: "间隔", mode: "模式", model: "模型", models: "模型", provider: "提供商", providers: "提供商", memory: "记忆", profile: "档案", user: "用户", context: "上下文", compression: "压缩", terminal: "终端", backend: "执行后端", cwd: "工作目录", temp: "临时", dir: "目录", path: "路径", family: "名称", font: "字体", modal: "沙盒", degraded: "降级", gateway: "网关", agent: "助手", auxiliary: "辅助模型", display: "显示", delegation: "委托", tts: "文字转语音", stt: "语音转文字", voice: "语音", browser: "浏览器", security: "安全", logging: "日志", attachments: "附件", desktop: "桌面", bot: "助手", local: "本地", runtime: "运行环境", database: "数据库", curator: "整理器", kanban: "看板", cron: "定时任务", sessions: "会话", session: "会话", tools: "工具", tool: "工具", toolsets: "工具集", output: "输出", input: "输入", api: "接口", key: "密钥", keys: "密钥", base: "基础", url: "地址", urls: "地址", env: "环境变量", default: "默认", tokens: "令牌", token: "令牌", chars: "字符", char: "字符", length: "长度", budget: "预算", nudge: "提醒", prefetch: "预取", spill: "溢出", write: "写入", read: "读取", approval: "审批", approvals: "审批", reasoning: "推理", effort: "强度", show: "显示", use: "使用", allow: "允许", require: "要求", on: "时", after: "之后", stop: "停止", start: "启动", idle: "空闲", duration: "时长", retries: "重试次数", retriesMax: "最大重试次数", retry: "重试", attempts: "尝试次数", maxRetries: "最大重试次数", enabledModels: "启用的模型", persistent: "持久化", shell: "命令行", language: "语言", cache: "缓存", ttl: "有效期", live: "实时", loop: "循环", guardrails: "保护规则", guard: "保护", failure: "失败", fallback: "备用", search: "搜索", query: "查询", response: "响应", message: "消息", messages: "消息", title: "标题", generation: "生成", streaming: "流式输出", stream: "流式输出", wake: "唤醒", word: "词", auth: "认证", secrets: "敏感信息", secret: "密钥", redaction: "脱敏", redact: "隐藏", channels: "消息渠道", channel: "消息渠道", archive: "归档", export: "导出", updates: "更新", plugins: "插件", skills: "技能", restart: "重启", resume: "恢复", startup: "启动", retention: "保留时长", size: "大小", lines: "行数", line: "行", bytes: "字节", files: "文件", file: "文件", concurrent: "并发", concurrency: "并发数", turns: "轮次", turn: "轮次", iterations: "迭代次数", history: "历史", depth: "深度", name: "名称", description: "说明", command: "命令", args: "参数", port: "端口", host: "主机", connection: "连接", transport: "传输协议", monitoring: "监控", health: "健康检查", progress: "进度", review: "审查", preview: "预览", image: "图片", audio: "音频", vision: "视觉", prompt: "提示词", instructions: "指令", system: "系统", personality: "人格", proxy: "代理", password: "密码", checkpoints: "检查点", checkpoint: "检查点", cpu: "CPU", disk: "磁盘", mb: "MB", s: "秒", id: "ID", docker: "Docker", mcp: "MCP", lsp: "LSP", code: "代码", execution: "执行", private: "私有", real: "真实", scan: "扫描", repo: "代码仓库", roots: "根目录", exclude: "排除", thread: "线程", window: "窗口", network: "网络", policy: "策略", data: "数据", storage: "存储", save: "保存", notifications: "通知", notify: "通知", trim: "裁剪", compact: "精简", delivery: "投递", missed: "错过", channelsManaged: "渠道管理", rate: "频率", sound: "声音", active: "活跃", total: "总计", service: "服务", tier: "等级", remote: "远程", load: "加载", refresh: "刷新", log: "日志", logs: "日志", autoSave: "自动保存", update: "更新", delete: "删除", approve: "允许", deny: "拒绝", block: "阻止", warn: "提示", off: "关闭", none: "无", low: "低", medium: "中", high: "高", true: "开启", false: "关闭", events: "事件", status: "状态", scope: "范围", template: "模板", endpoint: "接口", count: "数量", scheduling: "调度", queue: "队列", backup: "备份", discovery: "发现", resource: "资源", platform: "平台", debug: "调试", client: "客户端", server: "服务器", binary: "可执行文件", connectionTimeout: "连接超时", guardrail: "保护规则", quiet: "静默", timezone: "时区", workdir: "工作目录", workspaces: "工作区", workspace: "工作区", open: "打开", enabledModelsCount: "启用的模型数",
};
const keyFor = (key: string) => key.replace(/_([a-z0-9])/g, (_, character: string) => character.toUpperCase());
const pack = (locale: string) => locale === "en" ? copy.en : copy["zh-CN"];
const reviewed: Record<string, { label: string; description: string }> = {
  "agent.max_turns": { label: "最大执行步数", description: "一次任务中允许模型调用工具的轮次上限。" },
  "agent.service_tier": { label: "快速响应模式", description: "选择标准响应、始终加速、自动加速或仅首轮加速。" },
  "agent.image_input_mode": { label: "图片输入方式", description: "选择如何将图片附件提供给模型。" },
  "agent.run_budget_seconds": { label: "单次运行时限", description: "一次任务允许持续运行的秒数。" },
  "agent.text_verbosity": { label: "回复详细程度", description: "选择支持该参数的模型回答时的详细程度。" },
  "agent.api_max_retries": { label: "接口重试次数", description: "模型请求失败时，最多自动重试的次数。" },
  "delegation.max_iterations": { label: "子任务最大步数", description: "每个子任务最多可以执行的步骤数。" },
  "delegation.max_concurrent_children": { label: "并行子任务数量", description: "同时运行的子任务数量上限。" },
  "delegation.child_timeout_seconds": { label: "子任务超时", description: "单个子任务的最长等待时间，单位为秒。" },
  "delegation.max_spawn_depth": { label: "子任务嵌套层数", description: "限制子任务继续创建子任务的层级。" },
  "delegation.inherit_mcp_toolsets": { label: "继承扩展工具", description: "允许子任务使用主任务已经配置的扩展工具。" },
  "delegation.model": { label: "子任务模型", description: "指定子任务使用的模型。" },
  "delegation.provider": { label: "子任务模型提供商", description: "指定子任务模型对应的提供商。" },
  "delegation.reasoning_effort": { label: "子任务推理强度", description: "调整支持推理强度设置的子任务模型。" },
  "compression.threshold_tokens": { label: "压缩触发令牌数", description: "上下文达到此令牌数时触发压缩。" },
  "compression.protect_first_n": { label: "保留开头消息数", description: "压缩时保留会话开头的消息。" },
  "compression.min_tail_user_messages": { label: "保留最近用户消息数", description: "压缩后至少保留的最近用户消息数量。" },
  "compression.max_attempts": { label: "压缩重试次数", description: "压缩失败时允许尝试的次数上限。" },
  "compression.abort_on_summary_failure": { label: "摘要失败时停止压缩", description: "无法生成摘要时，保留现有上下文并停止此次压缩。" },
  "memory.prefetch_spill_enabled": { label: "预取溢出记忆", description: "允许在需要时预取溢出到额外存储中的记忆。" },
  "memory.write_approval": { label: "记忆写入审批", description: "写入持久记忆前请求确认。" },
  "memory.nudge_interval": { label: "记忆提醒间隔", description: "每隔指定轮数提醒模型整理记忆。" },
};

export function hasReviewedConfigCopy(key: string): boolean {
  const labels: Record<string, string> = copy["zh-CN"].fieldLabels;
  return Boolean(reviewed[key] || labels[keyFor(key)] || labels[key]);
}

export function configLabel(key: string, locale = "zh-CN"): string {
  if (locale !== "en" && reviewed[key]) return reviewed[key].label;
  const extraLabels: Record<string, string> = { "memory.prefetch_spill_enabled": "预取溢出记忆", "memory.write_approval": "记忆写入审批", "memory.nudge_interval": "记忆提醒间隔" };
  if (locale !== "en" && extraLabels[key]) return extraLabels[key];
  const labels: Record<string, string> = pack(locale).fieldLabels;
  if (key === "model_context_length") return locale === "en" ? "Main model context window" : "主模型上下文窗口";
  const curated = labels[keyFor(key)] ?? labels[key];
  if (curated) return curated;
  const last = key.split(".").at(-1)!;
  if (locale === "en") return last.replaceAll("_", " ");
  return last.split("_").map(word => words[word] ?? word).join(" ");
}

export function configDescription(key: string, original?: string, locale = "zh-CN"): string {
  if (locale !== "en" && reviewed[key]) return reviewed[key].description;
  const descriptions: Record<string, string> = pack(locale).fieldDescriptions;
  const translated = descriptions[keyFor(key)] ?? descriptions[key];
  if (translated) return translated;
  // Do not show untranslated technical descriptions in the product form.
  // YAML source retains the exact technical keys for advanced editing.
  return locale === "en" || /[\u3400-\u9fff]/.test(original ?? "") ? original ?? "" : "";
}

export function configOption(key: string, option: string, locale = "zh-CN"): string {
  if (locale !== "en" && key === "agent.text_verbosity") return ({ "": "跟随模型", low: "简洁", medium: "适中", high: "详细" } as Record<string, string>)[option] ?? option;
  if (locale !== "en" && key === "agent.service_tier") return ({ "": "默认", normal: "标准响应", fast: "始终加速", auto: "自动加速", cold: "仅首轮加速" } as Record<string, string>)[option] ?? option;
  if (key === "memory.provider" && option === "") return locale === "en" ? "Built-in only" : "仅内置";
  if (!option) return locale === "en" ? "Not set" : "未设置";
  if (locale === "en") return option;
  const brands: Record<string, string> = { byterover: "Byterover", holographic: "Holographic", retaindb: "RetainDB", "scope-recall": "Scope-Recall", chat_completions: "Chat Completions", codex_responses: "Responses", anthropic_messages: "Anthropic Messages", normal: "标准", fast: "快速", minimal: "最低", xhigh: "极高", ultra: "超高", native: "原生图片", text: "文字描述" };
  return brands[option] ?? words[option] ?? option;
}
