# Web Room Bilibili 代理播放运维说明

本文说明 `apps/web-room/` 网页房间、Bilibili 临时授权和 `proxy/shared` 播放策略的上线方式。它面向运维和自部署使用者，不替代代码中的协议类型和测试。

## 部署模式

网页房间是独立静态应用，源码位于 `apps/web-room/`，构建产物位于 `apps/web-room/dist/`：

```bash
npm install
npm --workspace @syncroom/web-room run build
```

也可以运行根构建：

```bash
npm run build
```

`apps/web-room/dist/` 至少包含：

- `index.html`
- `styles.css`
- `src/index.js`

当前 Node 房间服务不直接托管这些静态文件。推荐用 Nginx、Caddy、对象存储或 CDN 托管 `apps/web-room/dist/`，同时把 SyncRoom server 暴露为浏览器可访问的 `wss://` 地址。网页入口中的“服务器地址”默认是 `ws://localhost:8787`，生产环境应填写或预置为 `wss://sync.example.com`。

## Server URL 与 Origin

网页房间会使用同一个 SyncRoom server 访问：

- WebSocket 房间通道
- `POST /api/providers/bilibili/*` 授权和解析 API
- `GET /proxy/manifest/:id`
- `GET /proxy/segment/:id`
- `GET /api/announcements`
- `GET /api/connection-check`

如果静态网页与 server 不同源，必须把网页裸 Origin 加入 `ALLOWED_ORIGINS`：

```bash
ALLOWED_ORIGINS=https://room.example.com,chrome-extension://<extension-id>
```

本地静态调试时可加入本地网页 Origin，例如：

```bash
ALLOWED_ORIGINS=http://localhost:3000,chrome-extension://<extension-id>
```

生产环境使用 HTTPS 网页时，server 地址应使用 `wss://`。如果通过反向代理拆分路径，确保 `/api/providers/` 与 `/proxy/` 都转发到同一个 SyncRoom room node，并保留 WebSocket upgrade。

## 多节点与临时授权存储

Bilibili 授权凭据只保存在临时服务端 auth store 中：

- 单节点默认使用内存，服务重启后清空。
- 多节点建议启用 `RUNTIME_STORE_PROVIDER=redis` 和 `REDIS_URL`，让临时授权可随同一 Redis runtime store 跨节点读取。
- 该凭据不会写入 room store、Admin 事件、审计日志、错误响应或成员 payload。

房主离线授权 TTL 默认是 `600000` ms，也就是 10 分钟。当前默认值来自服务端 `DEFAULT_VIDEO_AUTH_OWNER_OFFLINE_TTL_MS`，本版本没有公开独立环境变量覆盖它。

## Bilibili 临时授权

Bilibili 授权只允许当前房主操作。成员可以看到安全状态，但不能启动、轮询、解析或退出授权。

支持的首发登录方式：

- QR 二维码登录。
- SMS 短信登录，包括服务端返回的验证码或过期/失败状态。

授权保留与清理规则：

- 房主刷新页面并用同一成员身份重连，且未超过离线 TTL 时，授权继续有效。
- 房主手动退出授权时清理。
- 房主离开房间时清理。
- 房间销毁、过期或删除时清理。
- server 重启时清理内存授权。
- 房主离线超过服务端 TTL 时清理。

API 响应只返回非敏感状态，例如是否已授权、显示名、头像、VIP 类标签和过期时间，不返回 Cookie、SESSDATA、CSRF、Authorization header 或真实凭据。

## proxy/shared 语义

`proxy` 和 `shared` 是两个独立策略：

| 策略                        | 行为                                                                                          | 风险/代价                                                                                        |
| --------------------------- | --------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------ |
| `proxy=true`                | server 用房主临时授权解析播放源，返回 SyncRoom `/proxy/manifest/*` 或 `/proxy/segment/*` 地址 | server 承担媒体带宽和出口成本                                                                    |
| `proxy=false + shared=true` | 成员浏览器直接加载 provider 直链                                                              | 直链可能因 CORS、Referer、IP 绑定、过期或解码失败而不可播，真实媒体 URL 可能出现在浏览器网络面板 |
| `shared=false`              | 使用匿名或无 cookie 解析                                                                      | 会员内容失败或降级是合理结果                                                                     |

首发稳定路径是 `proxy=true`。当直链播放失败时，网页会展示失败阶段并允许房主切回 proxy。

## Proxy 安全边界

Proxy 只服务 provider 解析阶段产生的 opaque resource id，不接收客户端传入的任意 URL。代理请求会校验协议、主机、DNS/IP 和私有/保留网段，避免 SSRF。Bilibili 需要的 Referer/User-Agent 由 server 注入；Range 请求会透传给上游。

代理资源有 TTL，房间清理或授权清理后，对应 proxy 映射会被移除或失效。

## 观测指标

新增低基数指标包括：

- `bili_syncplay_playback_startup_failures_total`
- `bili_syncplay_direct_link_playback_total`
- `bili_syncplay_member_player_errors_total`
- `bili_syncplay_proxy_traffic_bytes_total`
- `bili_syncplay_proxy_requests_total`

Admin 事件会记录房主选择视频、切换 source、切换 proxy/shared 策略等安全审计信息，但不会记录每个 segment 明细，也不会记录 Cookie、header 或原始上游签名 URL。

## 回滚与降级

当前版本没有独立的 Bilibili provider 环境开关。可用的运维回滚方式：

- 不发布或下线 `apps/web-room/dist/` 静态入口，保留浏览器扩展原流程。
- 从 `ALLOWED_ORIGINS` 移除网页 Origin，阻止网页房间连接共享 server。
- 反代层临时阻断 `/api/providers/`，让 Bilibili 授权和解析不可用。
- 反代层临时阻断 `/proxy/`，停止 server 媒体代理；这会影响 `proxy=true` 播放。
- 多节点异常时退回单节点或 sticky 路由，并确认 Redis runtime store 状态。

代理成本异常时优先查看 proxy bytes/request 指标，再决定是否临时下线网页 Bilibili 入口。
