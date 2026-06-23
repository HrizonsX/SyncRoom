# 服务端与部署运维

本文承接 README 中被精简掉的运维内容，集中说明本地服务、环境变量、Admin、Redis、多节点和生产部署边界。

## 版本与运行环境

| 依赖          | 最低版本            | 推荐版本    | 说明                                          |
| ------------- | ------------------- | ----------- | --------------------------------------------- |
| Node.js       | 18                  | 22          | 见 `.nvmrc`，Node 20 和 22 均受支持           |
| npm           | 8                   | 10          | 随 Node.js 安装                               |
| Chrome / Edge | 当前稳定版          | 当前稳定版  | 用于加载未打包扩展                            |
| Firefox       | 121                 | 当前稳定版  | 使用 `extension/dist-firefox` event-page 构建 |
| Redis         | 6.0                 | 7+          | 单节点可选；多节点和重启后持久化需要 Redis    |
| 反向代理      | 支持 WebSocket 即可 | Nginx 1.18+ | 生产环境用于 TLS 终止和 `wss://`              |

## 本地服务端

安装并构建：

```bash
npm install
npm run build
```

启动开发服务：

```powershell
$env:ALLOWED_ORIGINS="chrome-extension://<extension-id>,http://localhost:4173"
npm run dev:server
```

`ALLOWED_ORIGINS` 必须包含实际访问 syncRoom server 的浏览器 Origin：

- Chrome / Edge 扩展：`chrome-extension://<extension-id>`
- Firefox 扩展：`moz-extension://<uuid>`
- 网页房间：例如 `http://localhost:4173` 或 `https://room.example.com`

Firefox 每次安装可能生成不同的 `moz-extension://<uuid>`。少量用户可精确配置该 Origin；公共服务端可以设置 `ALLOW_ANY_FIREFOX_EXTENSION_ORIGIN=true` 接受格式正确的 Firefox 扩展 Origin，但它仍不会放开普通网页 Origin，也不会替代房间 token 鉴权。

## 常用环境变量

| 变量                                 | 用途                                         |
| ------------------------------------ | -------------------------------------------- |
| `PORT`                               | 房间服务端 HTTP/WebSocket 端口，默认 `8787`  |
| `ALLOWED_ORIGINS`                    | 允许建立 WebSocket/API 请求的 Origin 列表    |
| `ALLOW_ANY_FIREFOX_EXTENSION_ORIGIN` | 是否允许任意格式正确的 Firefox 扩展 Origin   |
| `SYNCROOM_CONFIG`                    | 指向 JSON 配置文件，用于集中配置运行参数     |
| `ROOM_STORE_PROVIDER`                | 房间存储提供者，常见值为 `memory` 或 `redis` |
| `RUNTIME_STORE_PROVIDER`             | 运行时索引、临时授权等运行态存储提供者       |
| `REDIS_URL`                          | Redis 连接地址                               |
| `ADMIN_USERNAME`                     | Admin 登录用户名                             |
| `ADMIN_PASSWORD_HASH`                | Admin 密码哈希，格式如 `sha256:<hex>`        |
| `ADMIN_SESSION_SECRET`               | Admin session 签名密钥                       |
| `ADMIN_ROLE`                         | Admin 角色，例如 `admin`                     |
| `ADMIN_UI_DEMO_ENABLED`              | 是否启用 Admin 演示数据                      |
| `LIVEKIT_URL`                        | LiveKit 服务地址                             |
| `LIVEKIT_API_KEY`                    | LiveKit API key                              |
| `LIVEKIT_API_SECRET`                 | LiveKit API secret                           |

更细的持久化、多节点和 Admin 行为请参考 `server/src/config/` 下的配置解析代码和对应测试。

## Admin 控制面板

单进程本地开发入口：

```text
http://localhost:8787/admin
```

独立 Global Admin 进程或生产反代入口通常是：

```text
http://localhost:8788/admin
https://admin.example.com/admin
```

启动示例：

```powershell
$env:ADMIN_USERNAME="admin"
$env:ADMIN_PASSWORD_HASH="sha256:<hex-password-hash>"
$env:ADMIN_SESSION_SECRET="<random-secret>"
$env:ADMIN_ROLE="admin"
npm run dev:server
```

本地生成 `sha256:<hex>` 密码哈希：

```powershell
$password = "secret-123"
$bytes = [System.Text.Encoding]::UTF8.GetBytes($password)
$hash = [System.BitConverter]::ToString(
  [System.Security.Cryptography.SHA256]::Create().ComputeHash($bytes)
).Replace("-", "").ToLower()
"sha256:$hash"
```

Admin 当前覆盖：

- 概览、房间列表、房间详情
- 运行事件、审计日志、配置摘要
- IP 黑名单和成员 IP 封禁
- 关闭房间、清空共享视频、踢出成员、断开会话
- 运行限制和多节点运行态观测

非生产环境可显式开启演示数据：

```powershell
$env:ADMIN_UI_DEMO_ENABLED="true"
npm run dev:server
```

未开启该变量时，Admin 页面上的 `?demo=1` 会被忽略。

## 网页房间部署

网页房间是静态应用，构建产物在 `apps/web-room/dist/`：

```bash
npm --workspace @syncroom/web-room run build
```

`@syncroom/web-room` 当前没有内置 `dev` 或 `preview` 服务脚本。Node 房间服务也不直接托管这些静态文件。建议使用静态文件服务、Nginx、Caddy、对象存储或 CDN 托管网页房间，并把网页入口中的服务器地址指向浏览器可访问的 server，本地开发常用 `ws://localhost:8787`，生产环境使用 `wss://sync.example.com`。

本地静态托管示例：

```bash
npx serve apps/web-room/dist -l 4173
```

如果网页房间与 syncRoom server 不同源，必须把网页 Origin 加入 `ALLOWED_ORIGINS`。Bilibili 授权、点播解析和 `/proxy/*` 的部署细节见 [网页房间 Bilibili 代理播放运维说明](./web-room-bilibili-proxy.zh-CN.md)。

## 多节点与 Redis

单节点内存模式适合本地开发和轻量自部署。多节点部署需要 Redis 承载共享状态，否则不同节点上的连接会看到不同房间。

Redis 可用于：

- 房间状态和房间生命周期
- 运行时 session 索引
- 跨节点房间事件广播
- Admin session、事件和审计存储
- 临时 Bilibili 授权运行态

多节点部署、Global Admin 和反向代理策略见 [多节点运行手册](../runbook/multi-node-operations.zh-CN.md) 与 [多节点全局管理面迁移说明](./multi-node-global-admin-migration.zh-CN.md)。

## 非目标与边界

- 无 Redis 时不保证多节点一致性。
- 服务端不内置负载均衡，生产环境依赖外部入口层分发 WebSocket。
- 扩展端 room session 使用浏览器 session 级存储，浏览器重启后需要重新加入房间。
- 项目没有终端用户账号系统，房间访问通过 `roomCode:joinToken` 控制。
- 浏览器扩展首要支持 Chrome、Edge 和 Firefox 121+；Safari 与移动端浏览器不在当前范围内。

## 开发与验证命令

```bash
npm run lint
npm run format:check
npm run typecheck
npm run build
npm test
```

其他命令：

- `npm run lint:fix`：执行 ESLint 自动修复。
- `npm run format`：用 Prettier 重写格式。
- `npm run build:extension`：构建 Chrome/Edge 扩展。
- `npm run build:extension:firefox`：构建 Firefox 扩展。
- `npm run audit`：执行依赖审计门禁。
- `npm run test:server:redis`：显式执行 Redis 回归测试，需要 `REDIS_URL`。

贡献和提交要求见 [CONTRIBUTING.md](../../CONTRIBUTING.md)。
