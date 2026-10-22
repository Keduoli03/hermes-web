# Hermes Web 部署指南

本文说明如何部署本仓库的 Next.js 服务。Hermes Agent、私有 Dashboard 和 API Server 需自行准备；本项目不会自动安装或启动它们。

建议先在本机确认连接，再部署预览环境，验证后发布正式环境。以下路径和域名均为占位示例。

## 1. 准备服务与目录

最直接的方式是将 Web 与 Hermes 放在同一主机，以能访问相关项目目录的服务账号运行。

| 服务 | 绑定示例 | 对外访问 |
| --- | --- | --- |
| Hermes Web | `127.0.0.1:30141` | 通过 HTTPS 反向代理发布 |
| 私有 Dashboard | `127.0.0.1:8648` | 不直接对外发布 |
| API Server | `127.0.0.1:8642` | 不直接对外发布 |

实际端口以安装配置为准。已有公开 Dashboard 的接入方式见[私有 Dashboard 部署](hermes-private-dashboard.md)。Docker 中的 `127.0.0.1` 指容器本身；自动本机握手要求真正的回环连接，不能只把容器服务名写成 localhost。

跨主机使用需要自行提供共享文件系统，配置 `HERMES_PROJECT_PATH_MAP`。映射不会同步文件，也不会让本机终端变成远端终端。

## 2. 构建独立发布目录

在例如 `/srv/hermes-web/releases/<release-id>` 的新目录中准备源码，然后执行：

```bash
npm ci
npm run build
```

不要在正在运行开发服务的目录中构建，也不要通过另起一个端口来共用同一份 `.next`。当前发布方式为 `next start`，需要保留构建产物、依赖、`public/` 和相关运行配置，不是静态导出。

字体已随仓库本地分发，构建无需从 Google Fonts 下载字体。

## 3. 配置环境与持久目录

以 [`.env.example`](../.env.example) 为基础，为进程管理器准备私有环境文件，例如 `/etc/hermes-web.env`：

```dotenv
HERMES_DASHBOARD_URL=http://127.0.0.1:8648
HERMES_API_SERVER_URL=http://127.0.0.1:8642
API_SERVER_KEY=replace-with-your-hermes-api-server-key
PI_WEB_USERNAME=admin
PI_WEB_PASSWORD=replace-with-a-long-random-password
PI_WEB_ALLOWED_HOSTS=hermes.example.com
HERMES_WEB_DATA_DIR=/var/lib/hermes-web
```

示例值必须替换，环境文件仅允许管理员及需要读取它的服务进程访问。使用 systemd 的 `EnvironmentFile` 时，不要添加 shell 的 `export` 前缀。

Nous 登录需单独注册客户端及 HTTPS 回调，详见[官方登录配置](hermes-official-login.md)。网站登录凭据、Dashboard 认证和 API Server 密钥互不替代。

`HERMES_WEB_DATA_DIR` 必须可写，并独立于不可变的发布目录。它包含登录会话、缓存、产物索引和用户手动保存的产物版本；备份时应与 Hermes 自身的配置、会话和文件一并考虑。

## 4. 使用 systemd 托管

模板见 [`deploy/systemd/hermes-web.service.example`](../deploy/systemd/hermes-web.service.example)。安装前替换全部占位符：

| 占位符 | 说明 | 示例 |
| --- | --- | --- |
| `@WEB_USER@` | 服务账号 | `hermes` |
| `@WEB_DIR@` | 已完成构建的绝对发布目录 | `/srv/hermes-web/releases/<release-id>` |
| `@ENV_FILE@` | 私有环境文件绝对路径 | `/etc/hermes-web.env` |
| `@NODE_BIN@` | Node.js 可执行文件绝对路径 | `/usr/bin/node`，以实际安装为准 |

模板的 `StateDirectory=hermes-web` 会创建 `/var/lib/hermes-web` 并交给服务账号，权限为 `0700`。自定义数据路径时，同时调整环境变量、目录所有权和进程管理器的可写范围。

检查解析后的文件，再安装为 `/etc/systemd/system/hermes-web.service`：

```bash
sudo systemctl daemon-reload
sudo systemctl enable --now hermes-web.service
sudo systemctl status hermes-web.service
```

升级时在新目录完成构建和验证，再更新服务的工作目录与启动路径。保留上一发布目录及对应环境备份，作为回滚依据。切换前确认没有需要保留的活跃聊天。

## 5. 配置 HTTPS 反向代理

下面是 Nginx 的配置片段。证书与 HTTPS 站点由自己的部署环境配置。

在 Nginx 的 `http` 块内定义 WebSocket 连接映射：

```nginx
map $http_upgrade $hermes_connection_upgrade {
    default upgrade;
    ''      close;
}
```

在已有 HTTPS `server` 中配置入口：

```nginx
location / {
    proxy_pass http://127.0.0.1:30141;
    proxy_http_version 1.1;
    proxy_set_header Host $host;
    proxy_set_header X-Forwarded-Proto $scheme;
    proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for;
    proxy_set_header Upgrade $http_upgrade;
    proxy_set_header Connection $hermes_connection_upgrade;
    proxy_buffering off;
    proxy_read_timeout 3600s;
}
```

不要把私有 Dashboard 或 API Server 一并代理为公开路径。当前使用根路径部署，不支持 `/hermes` 等子路径。

较大附件还会受到反向代理上传大小和超时限制。按自己的策略设置限制，并与应用允许的上传范围协调。

## 6. 发布后验证

1. 未登录请求管理 API 返回 `401`；登录后才能访问会话和配置。
2. 在“账号与访问”分别验证管理 HTTP、普通聊天 API 和项目 WebSocket。
3. 打开已有会话，检查历史、模型恢复和文件访问。连接探测通过不能代替这些检查。
4. 检查模型与工具目录的重复读取命中缓存；手动刷新能重取，修改相关配置后缓存失效。
5. 检查定时任务运行记录、桌面与手机布局、退出登录后旧 Cookie 失效。
6. 需要验证真实推理时，单独发起一条可控请求并确认可能的模型费用。

`bin/verify-hermes-production.mjs` 可对已构建目录运行隔离的生产模式回归，后端使用测试夹具；它不是针对真实部署的模型验收脚本。

登录状态和元数据缓存可持久化，但活跃运行的事件缓冲和 WebSocket 仍属于进程。采用单进程服务，或为活跃聊天提供粘性路由，不能只共享数据目录就宣称完成多进程聊天恢复。
