# Hermes Web Workspace

基于 [agegr/pi-web](https://github.com/agegr/pi-web) 的 MIT 开源界面，逐步适配 Hermes Agent Dashboard 与 API Server 的独立 Web 工作区。**目前仍是开发中的原型**，请勿用于公网生产或把本地服务暴露到公网。

## 本机开发

环境要求：Node.js ≥ 23，npm。

```bash
git clone https://github.com/Keduoli03/hermes-web.git
cd hermes-web
npm ci
cp .env.example .env.local
# 编辑 .env.local，填入你自己的本地配置
npm run dev
```

打开终端显示的本地地址。上游 pi-web 默认开发端口为 `30141`；先检查并复用本仓库的健康开发进程。若端口属于其他应用，可为本仓库指定独立端口（例如 `node node_modules/next/dist/bin/next dev -H 127.0.0.1 -p 30142`），不要启动两个共用本仓库 `.next` 的开发进程。常用检查：

```bash
npx tsc --noEmit
npm run lint
node --experimental-strip-types --test lib/hermes-api-proxy.test.mjs lib/hermes-dashboard-client.test.mjs
# 开发时不要运行 next build，避免破坏 .next 的开发缓存
```

## Hermes 接入

服务器部署可使用 Nous 官方账号登录，支持额外的账号白名单和密码备用入口。设置 `HERMES_WEB_OAUTH_CLIENT_ID` 即启用认证；需要注册独立客户端及服务器域名回调，详见 [官方登录配置](docs/hermes-official-login.md)。登录会话和一次性登录流程持久化到 `HERMES_WEB_DATA_DIR/auth`（默认 `~/.hermes-web/auth`），重启后仍有效，多个进程共享该目录时可读取相同登录状态和撤销结果。登录有效期仍受官方令牌限制。

普通聊天由服务端代理访问 Hermes API Server（`/v1/runs` 与 SSE）。选择项目文件夹的聊天使用官方 Dashboard WebSocket：在发送前为该会话设置真实工作目录，文件浏览、上传和新终端也使用这个目录。浏览器只持有面板登录会话，不应持有 Hermes API key。服务端地址和 key 仅配置在本机 `.env.local`。API Server 建议只绑定 `127.0.0.1`，不要将 key 提交到仓库、Issue、截图或聊天。

项目聊天已接入文本、图片、推理、工具活动、执行确认、澄清表单和停止。澄清支持单选、多选、自由输入、多问题及跳过，兼容旧通知协议与新 JSON-RPC 服务端请求。普通和项目聊天由服务端保留事件，断线自动重连；本标签页刷新后恢复原运行，不重新发送提示词。事件保留至运行结束后 30 分钟，应用进程重启后须重新打开已保存历史；聊天部署采用单进程或对运行请求保持粘性路由。

Dashboard `/api/status` 可用于只读状态；管理接口需 Dashboard 鉴权。若 Hermes 未提供适合独立服务的受支持 Dashboard token，管理页面会受限；不要复制运行中进程的秘密或绕过官方认证。

管理接口需要在 `.env.local` 中设置 `HERMES_DASHBOARD_URL` 和 `HERMES_DASHBOARD_SESSION_TOKEN`。官方 Dashboard 默认端口可能随安装配置不同，请填写实际服务地址。API Server 使用 `HERMES_API_SERVER_URL` 和 `API_SERVER_KEY`。配置面板密码时，代理要求有效的登录 cookie；无密码开发仅允许同源的回环地址请求。Dashboard 已连接而 API Server 未配置时，管理功能、历史浏览和项目聊天仍可使用，普通聊天会提示缺少接口配置。跨机器项目使用 `HERMES_PROJECT_PATH_MAP` 的本地挂载目录与远端目录映射：文件浏览、上传、终端使用本地挂载目录，Hermes 会话使用对应远端目录；需先通过系统共享或挂载让两端访问同一份文件，不会自动建立 SSH 或文件同步。

已启动本地 Hermes 桌面服务时，可通过官方回环握手连接（只写入忽略的 `.env.local`，不会输出认证令牌）：

```bash
node bin/connect-hermes-local.mjs http://127.0.0.1:实际端口
```

## 验证

```bash
node --experimental-strip-types --test lib/hermes-api-proxy.test.mjs lib/hermes-dashboard-client.test.mjs
# 先启动本仓库开发服务，再运行浏览器协议测试（模拟 Hermes 响应，不写真实数据）
npm run test:e2e
# 可以筛选套件：npm run test:e2e -- completion workspace
node --experimental-strip-types e2e/hermes-workspace.mjs
node --test lib/hermes-project-rpc.test.mjs
node --experimental-strip-types e2e/hermes-project-folder.mjs
# 真实目录只读确认，不创建会话、不调用模型
node --experimental-strip-types e2e/hermes-project-live.mjs
node --experimental-strip-types --test lib/hermes-config-form.test.mjs lib/hermes-i18n.test.mjs
# 已连接本地 Dashboard 后，只读检查真实设置界面
node e2e/hermes-live-settings.mjs
# 可设置 HERMES_TEST_URL 和 HERMES_TEST_BROWSER=msedge 或 chrome
```

浏览器协议测试覆盖语言切换、模型提供商与模型发现、记忆下拉框、表单/YAML 保存、管理页请求体、失败后保留草稿、Markdown/SSE 和移动端导航。项目目录测试覆盖后端确认、会话目录恢复、切换失败、缺失目录和普通聊天。截图保存在系统临时目录 `hermes-web-qa`。只读联调脚本验证真实 Dashboard schema、设置控件及目录确认，不写入用户配置，也不调用模型。

## 当前边界

- 演示环境：<https://demo.blueke.top>，仅用于验证原型。
- 正式的 `chat.blueke.top` 尚未切换。
- 聊天复用 Pi Web 的 MessageView、Markdown、主题和代码高亮；支持历史会话、流式回复、工具活动、审批、停止和模型选择。
- Cron 支持任务列表、新建、编辑、暂停/恢复、立即运行、删除和运行记录。
- Skills 支持列表筛选、Markdown 预览、新建、编辑 SKILL.md 和启停。
- Config 默认使用官方 schema 生成表单，布尔值为开关、枚举为下拉框、数值为数字输入；可切换 YAML 源码、导入/导出、还原。表单保存仅提交修改字段，源码编辑保存原始 YAML；本地 schema 已验证 896 个字段。
- 模型管理沿用 Pi 的提供商列表与详情布局，支持添加/编辑/删除自定义提供商、协议选择、模型发现、手动模型 ID、上下文窗口和默认提供商；密钥不回填脱敏预览。
- “记忆与上下文 → 记忆内容”以三栏展示当前服务档案的我的笔记、用户画像和灵魂，支持 Markdown 预览、编辑、保存和取消。通过官方接口读取 MEMORY.md、USER.md、SOUL.md，保存前检查内容是否已变化；失败时保留草稿。手机端改为单列卡片。
- API Keys 使用官方 `/api/env`：脱敏列表、自定义变量、更新和删除；新值保存成功后清空输入。
- Status、Logs、Usage 提供状态、日志筛选、用量汇总与按模型/日期的统计表。
- 保留 Pi Web 的工作区结构：左侧会话和文件浏览器，底部模型/技能/设置，顶部历史/系统/工具栏，底部原版 ChatInput。
- 设置弹窗使用左侧分类菜单和右侧内容面板，支持搜索；记忆、上下文压缩、助手行为、终端、安全、浏览器和语音各有独立入口。默认简体中文，常规页可切换界面语言，选择保存在 `hermes-web-locale`。桌面版的中文字段标签和说明已导入；表单只显示名称、简短说明和控件，不展示键名、路径与字段数量；技术标识保留在 YAML 源码中。顶部为普通面包屑；左侧功能分类可展开/收起，子分类留在同一列，技能等运行对象列表保留侧栏。文件预览及终端复用 Pi Web 组件。
- 手机保留所有入口；管理页离开时提醒未保存修改。
- 最左侧主导航依次为首页、技能工具、消息平台、产物、定时任务。技能工具页集中已安装技能、技能市场、MCP 和内置工具；切换页面保留当前聊天与文件面板。产物默认展示全部会话，以卡片展示图片、视频、音频、文件和代码；通过下拉框选择当前或指定会话，支持类型筛选、搜索、媒体预览与下载、Markdown 排版预览及源码切换、普通文本预览（最大 1 MB）、静态 HTML/SVG 隔离预览，也可浏览工作区文件。服务端按会话保存可重建的 JSON 索引：初次分页读取完整历史（包含压缩前记录），再次访问检查会话元数据，仅重扫变化的会话；刷新按钮强制重扫。索引默认位于 `~/.hermes-web/artifacts`，可通过 `HERMES_WEB_DATA_DIR` 指定数据目录，服务器部署时应持久化该目录。索引不复制媒体文件或修改 Hermes 原数据库；含内嵌媒体字节的会话不落盘缓存。索引最长 24 小时重新校验，无更新时间的会话缓存 1 分钟；目录不可写时仍可浏览，但无法持久缓存。媒体访问遵守 Hermes 官方文件权限，链接失效或文件被删除时提示预览失败。手动保存的历史版本独立存储，见下文。
- 技能市场（Skills Hub）支持官方目录、来源搜索、内容预览、检查、安装、卸载和更新；后台安装按任务状态确认结果。
- 消息渠道（Channels）支持配置当前服务档案的各平台、启停、凭据保存/清除和连接检测；Telegram / WhatsApp 支持扫码或深链接绑定、状态轮询、取消、过期提示与保存，保存后的网关重启结果由官方接口确认。
- 配置档案（Profiles）统一从最左侧导航底部进入，各功能页不再重复提供档案选择器。支持新建、复制、改名、用途/模型编辑、默认选择、删除及后端归档路径导入、导出及归档下载；更改默认档案不会切换已运行服务或会话的档案。
- MCP 管理支持在当前服务档案添加 HTTP/本地服务器、编辑连接、启停、删除、工具测试、OAuth 授权/取消和官方目录安装；插件提供的服务器保持只读。
- 设置提供 Hermes 插件列表、启停、来源安装、更新、卸载和 schema 设置；Webhooks 提供启用、新建订阅、启停、删除及一次性密钥显示；配对审批提供批准待处理用户和撤销授权。多智能体任务提供运行列表、暂停/恢复派发、项目会话子任务指令、停止和输出查看，任务模型及并行限制继续使用子任务设置。操作取决于已安装 Hermes 版本实际支持的接口，旧服务会明确显示后端错误，不会改用 Pi 接口。
- 产物预览提供手动保存版本和下载历史版本；每个产物最多 20 个不同内容版本，每个版本最大 32 MB，保存到 `HERMES_WEB_DATA_DIR/artifact-versions`，按后端及会话隔离。只保存明确选择的代码或 Hermes 管理的文件，外部链接不抓取；下载前重新验证会话和产物访问权。
- 上游组件和 API 中仍有 Pi Agent 依赖，适配时需逐项替换，不能误接原 Pi 后端。

## 来源与开发说明

本仓库 fork 自 pi-web。本轮拉取并对照上游提交 `894e1a28dbeeb7b457c7712e495d975fe9927b89`，保留原版 ChatInput、MessageView、FileExplorer、FileViewer、DirectoryPicker、TerminalPanel 与共享 SettingsUi。版权和 MIT 许可证见 [`LICENSE`](./LICENSE)。开发前请先读 [`PORT-PLAN.md`](./PORT-PLAN.md) 与 [`AGENTS.md`](./AGENTS.md)。

---

## pi-web 上游 README

[中文文档](./README.zh-CN.md) | [日本語](./README.ja.md) | [Русский](./README.ru.md)

Local browser UI for the [pi coding agent](https://github.com/earendil-works/pi). Pi Web uses the same local configuration and session files as pi, so you can browse and resume conversations, run agent turns, configure models and resources, and inspect project files from a browser.

**[Try the interactive demo →](https://agegr.github.io/pi-web/)** The real Pi Web UI runs entirely in your browser, with sample sessions, files and models. There is nothing to install; replies are pre-written and no model is called.

![Pi Web displaying a pi session with structured Markdown, tool calls, and project navigation](https://raw.githubusercontent.com/agegr/pi-web/main/docs/screenshot2.png)

## Features

- **Session workspace**: browse, resume, rename, export, and delete conversations grouped by project, with running state, context usage, cost, and compaction details.
- **Two ways to branch**: **New session** creates an independent session file from an earlier message; **Edit from here** creates a branch inside the current session.
- **Project file tools**: browse and upload files, inspect Git diffs, and preview source, Markdown, images, audio, PDFs, and DOCX files with automatic refresh.
- **Git worktrees**: switch checkouts from the sidebar while keeping sessions from the same repository grouped together.
- **Web-based configuration**: manage provider login and API keys, models, model tests, plugin packages, and skills without leaving Pi Web.
- **English, Simplified Chinese, and Traditional Chinese UI**: Pi Web follows the browser language initially and provides a language switcher in the top bar.

## Quick Start

Pi Web requires Node.js 22.19.0 or newer. Check your version with `node --version`, then run:

```bash
npx @agegr/pi-web@latest
```

The CLI opens a browser after the server is ready. If it does not, open [http://127.0.0.1:30141](http://127.0.0.1:30141). Pi Web listens only on `127.0.0.1` by default.

If no model provider is configured yet, open the **Models** panel to sign in or add an API key.

To install the `pi-web` command globally:

```bash
npm install -g @agegr/pi-web@latest
pi-web
```

Commands:

```bash
pi-web version          # print the installed version
pi-web status           # list running servers
pi-web stop [--port N]  # stop a running server
pi-web open [--port N]  # open a running server in the browser
pi-web update [--check] # update a global npm install
```

To update, run `pi-web stop`, then `pi-web update` (or run the same install command again). To uninstall, run `npm uninstall -g @agegr/pi-web`.

## Configuration

For port and hostname, command-line options override the corresponding environment variables. Either `--no-open` or `PI_WEB_NO_OPEN=1` disables automatic browser opening. Run `pi-web --help` (or `-h`) to print startup options and exit without starting the server. Unknown options exit with an error.

| Option or environment variable | Purpose | Default |
| --- | --- | --- |
| `--help`, `-h` | Print startup options and exit | — |
| `--port <port>`, `-p <port>`, or `PORT` | Server port | `30141` |
| `--hostname <host>`, `-H <host>`, or `PI_WEB_HOSTNAME` | Bind hostname | `127.0.0.1` |
| `--no-open` or `PI_WEB_NO_OPEN=1` | Do not open a browser automatically | Browser opens |
| `PI_WEB_APP_NAME` | PWA manifest `name` and `short_name`; surrounding whitespace is trimmed, empty values use the default | `Pi Web` |
| `PI_WEB_SKIP_VERSION_CHECK=1` | Disable Pi Web update checks | Unset |
| `PI_WEB_ALLOWED_HOSTS` | Additional exact proxy or custom hostnames, comma-separated | Unset |
| `PI_WEB_PASSWORD` | Enable browser password login; API clients may use Basic Auth with username `pi` | Authentication disabled |
| `PI_WEB_IDLE_TIMEOUT_MS` | Session idle timeout in milliseconds, up to `2147483647`; `0` disables idle shutdown; invalid or out-of-range values use the default | `600000` (10 min) |
| `PI_WEB_SHUTDOWN_DEADLINE_MS` | How long extensions get to handle `session_shutdown` before a closing session is disposed anyway, in milliseconds up to `2147483647`; `0`, invalid or out-of-range values use the default | `5000` (5 s) |

Set `PI_WEB_APP_NAME` before starting the server (for example, `PI_WEB_APP_NAME='Work Pi' pi-web`). After changing it, restart the server to serve the new manifest; no rebuild is required. Updates to the name of an already installed PWA are managed by the browser and are not guaranteed to appear immediately. This does not change the page title or icons.

For example:

```bash
pi-web --help
pi-web -p 8080 -H 0.0.0.0 --no-open
```

### Remote Access

Binding to a non-loopback address exposes an agent that can execute high-privilege actions. On a trusted LAN, require a long random password:

```bash
PI_WEB_PASSWORD='a-long-random-password' pi-web --hostname 0.0.0.0
```

Password authentication does not encrypt the connection. Do not expose Pi Web over plain HTTP to the internet; use HTTPS through a trusted reverse proxy or a trusted VPN. If a reverse proxy sends an external hostname, add that exact name to `PI_WEB_ALLOWED_HOSTS`. This allow-list does not change the address Pi Web binds to.

### HTTP Proxy

Server-side model and API requests honor the standard `HTTP_PROXY`, `HTTPS_PROXY`, and `NO_PROXY` environment variables.

On macOS or Linux:

```bash
HTTP_PROXY=http://127.0.0.1:7890 \
HTTPS_PROXY=http://127.0.0.1:7890 \
NO_PROXY=localhost,127.0.0.1 \
npx @agegr/pi-web@latest
```

On Windows PowerShell:

```powershell
$env:HTTP_PROXY = "http://127.0.0.1:7890"
$env:HTTPS_PROXY = "http://127.0.0.1:7890"
$env:NO_PROXY = "localhost,127.0.0.1"
npx @agegr/pi-web@latest
```

## Notes

- **Agent data**: Pi Web reads pi data from `~/.pi/agent` by default, including session files under `sessions/<encoded-cwd>/<timestamp>_<uuid>.jsonl`. Set `PI_CODING_AGENT_DIR` to use another pi agent directory.
- **Filesystem access**: Pi Web must be able to read the agent data directory and the working directories recorded by its sessions. Run Pi Web in the same filesystem environment as pi when sharing existing sessions.
- **Shared configuration**: the Models panel uses pi's model, settings, and credential storage, so changes are visible to both interfaces.
- **File access boundary**: the file browser is limited to working directories selected in Pi Web and project or session roots it already knows about; it is not a general filesystem browser.
- **Git worktrees**: see [Worktrees in Pi Web](./docs/worktrees.md) for switcher visibility, worktree creation, and removal behavior.

### Downstream Session Context Menu

Electron wrappers and other downstream integrations can provide a session-row
context menu without patching `SessionSidebar`. Listen for the cancelable
`pi-web:session-row-contextmenu` browser event and call `preventDefault()`
synchronously when the integration will handle it:

```js
window.addEventListener("pi-web:session-row-contextmenu", (event) => {
  event.preventDefault();
  const { id, path, cwd, name, clientX, clientY, refresh } = event.detail;

  void openSessionMenu({ id, path, cwd, name, clientX, clientY }).then((changed) => {
    if (changed) refresh();
  });
});
```

The detail object contains `id`, `path`, `cwd`, optional `name`, pointer
coordinates, and a `refresh()` callback for actions that change the session
list. If no listener cancels the extension event, Pi Web opens its built-in
session menu (pin, rename, fork, mark read or unread, archive, open in new
tab, delete) at the pointer instead of the browser's native context menu.
The row's `⋯` button always opens the built-in menu and does not dispatch the
event. Sessions not yet saved to disk get no built-in menu, so the native one
still appears for them. This hook is browser-side and independent of Pi agent
extensions.

### Extension Session Liveness

Server-side Pi extensions with detached work can prevent automatic idle
session eviction through the versioned global registry:

```js
const liveness = globalThis[Symbol.for("@agegr/pi-web/session-liveness/v1")];
const release = liveness?.version === 1
  ? liveness.register({
      name: "my-extension",
      sessionId,
      sessionFile: sessionFile || undefined,
      isActive: () => detachedJobs.size > 0,
    })
  : () => {};
```

Register once per active extension session and call the returned idempotent
`release` function on session shutdown, replacement, or reload. `isActive`
must be synchronous, cheap, and scoped to the supplied exact session id or
file. Provider errors fail safe by preserving that session. This lease only
affects automatic idle eviction; explicit shutdown and Stop fallback cleanup
still take precedence.

## Development

```bash
npm install
npm run dev
```

The development server runs at [http://127.0.0.1:30141](http://127.0.0.1:30141). Run the common checks with:

```bash
npm test
node_modules/.bin/tsc --noEmit
npm run lint
```

Do not run `next build` or `npm run build` during normal development. It writes to `.next/` and can interfere with the development server; leave builds for release work.

Contributor guides: [Internationalization](./docs/i18n.md) and [Release process](./docs/release.md).

## Repository Layout

```text
app/             Next.js UI and API routes
components/      React UI components
hooks/           Client state and interaction hooks
lib/             Session, agent, model, file, Git, and security logic
public/          Static assets and PWA files
bin/             npm CLI entrypoint and launch option parsing
docs/            Focused user and contributor guides
demo/            Static browser demo published to GitHub Pages (see demo/README.md)
```

See [AGENTS.md](./AGENTS.md) for the architecture notes and detailed file map.

## License

[MIT](./LICENSE)

### 偏好设置与常用配置

偏好设置拆分为常规、主题、字体与缩放、聊天显示。主题卡片使用真实配色的页面骨架；界面、聊天和代码字号均使用 1 px 步进的滑块，立即应用并在浏览器中保存。聊天显示可调整推理内容的显示/默认折叠、工具预览详情、文字方向和用户气泡透明度。

模型与工具、对话与任务、记忆与上下文、工作区与安全分别组织常用功能。任务执行和子任务使用按用途选择的字段，并提供审核过的中文标签/说明，不展示底层缓存及进程参数。高级表单优先展示已有中文说明的选项；完整原始配置仍可在 YAML 源码模式查看和编辑。网页显示偏好不会改写 Hermes 的模型行为配置；推理内容只展示模型实际提供的历史内容或 `reasoning.available` 事件。
