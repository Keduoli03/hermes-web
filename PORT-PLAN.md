# Hermes Web UI —— 用 pi-web 的外观，接 Hermes 的后端

> 本文是早期适配计划，不代表当前实现或部署指南。当前说明见 [README.md](README.md) 与 [架构文档](docs/hermes-architecture.md)。域名与路径均为示例。

目标：在 `hermes.example.com` 部署 pi-web 样式的独立 Hermes 界面，接入状态、会话、聊天、Cron、Skills、日志、用量、Config、API Keys。

## 结论先行（架构）

- **前端**：fork `agegr/pi-web`（MIT）→ `/srv/hermes-web`。它的 UI/组件/主题整套保留。
- **后端**：**不重写**。`hermes dashboard`（FastAPI，8648）继续当数据源；聊天走 `api_server` 平台（`/v1/runs` 流式）。
- **只换数据层**：把 pi-web 的 `app/api/**` 里读 `~/.pi/agent/**` 的实现换成读 Hermes。
- **文件 / Git / 终端** 这三块**不用改**：pi-web 本来就在本机读写文件系统 + node-pty，跑在这台服务器上天然可用，而且比官方面板还好用。
- 部署：新服务（Next.js standalone）127.0.0.1:8700 → systemd → OpenResty `hermes.example.com`（替换现有面板的反代）。

## 数据层映射（pi-web 路由 → Hermes 来源）

| pi-web 路由 | 现在读什么 | 改成 |
| --- | --- | --- |
| `GET /api/sessions` | `~/.pi/agent/sessions/*.jsonl` | dashboard `GET /api/sessions` |
| `GET /api/sessions/[id]` + `/context` | SessionManager | dashboard `GET /api/sessions/{id}/messages` |
| `GET /api/sessions/search` | 本地扫描 | dashboard `GET /api/sessions/search`（FTS5） |
| `DELETE/PATCH /api/sessions/[id]` | 本地文件 | dashboard 同名端点 |
| `POST /api/agent/new` | `createAgentSessionFromServices()` | api_server `POST /v1/runs`（带 cwd/模型） |
| `POST /api/agent/[id]` | `session.send(cmd)` | `POST /v1/runs/{id}/steer` / `/approval` / `/stop` |
| `GET /api/agent/[id]/events` (SSE) | `session.onEvent()` | api_server `GET /v1/runs/{run_id}/events`（SSE） |
| `GET /api/models*` | pi 模型目录 | dashboard `GET /api/config` + api_server `GET /v1/models` |
| `GET /api/skills*` | `~/.pi` skills | dashboard `GET /api/skills`、`PUT /api/skills/toggle` |
| Cron（新增页面） | — | dashboard `/api/cron/jobs`（含 pause/resume/trigger/delete） |
| 状态总览（新增） | — | dashboard `GET /api/status` |
| 日志 / 用量（新增） | — | dashboard `GET /api/logs`、`GET /api/analytics/usage` |
| Config / Keys（新增） | — | dashboard `GET/PUT /api/config`、`GET/PUT/DELETE /api/env` |

## 待解决的技术点

1. **我们的 Next.js 服务怎么带鉴权调 dashboard API**
   - 首选：`HERMES_DASHBOARD_BASIC_AUTH_*`（本地回环 + 强口令 + secret）或非交互 bearer token；Next 服务端持有，浏览器永远拿不到。
   - 备选：直接读 `~/.hermes/state.db` + `config.yaml`（同机，无需 HTTP 鉴权），但会重复实现逻辑。
2. **`api_server` 平台要开启**（原生聊天必需）：确认默认端口、`API_SERVER_KEY`、只监听 127.0.0.1。
3. **事件协议对齐**：pi-web 的 SSE 事件格式（`lib/agent-event-wire.ts`）↔ api_server 的 `/v1/runs/{id}/events` 事件类型，需要一个适配层 `lib/hermes-event-adapter.ts`。
4. **会话 ID 语义**：pi 的 session id ≠ Hermes 的 session id（Hermes 是 `YYYYMMDD_HHMMSS_hash`），URL 用 Hermes 的，别让前端去做算术。
5. **主题**：pi-web 的 CSS 变量令牌（`--bg/--bg-panel/--border/--accent/…`，dark `#1a1a1a`、内容 820px）原样保留；只想换 logo/名字 → `public/` + `app/layout.tsx`。

## 分期

- **P0 基线**：`npm install` + `npm run dev` 跑起来，确认能编译（本机 30141）。
- **P1 只读**：会话列表 / 详情 / 搜索 → 接 dashboard API。
- **P2 聊天**：`/v1/runs` + SSE 适配层，Markdown + 工具卡片渲染。
- **P3 管理页**：状态、Cron、Skills、日志、用量、Config、API Keys。
- **P4 上线**：Next standalone → systemd(8700) → OpenResty 切换 `hermes.example.com`；保留旧 dashboard 作回滚。

## 风险

- pi-web 的 `lib/agent-client.ts` 与 pi 的 AgentSession 深度耦合，P2 是工作量最大的一块。
- Hermes 更新可能改动 dashboard API 形状 → 所有调用集中放 `lib/hermes/*.ts`，坏一处能一处改。
- 上游 pi-web 仍在活跃开发；fork 后按需 cherry-pick，不追 sync。
