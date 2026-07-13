# 网页房间 Bilibili 代理播放运维说明

本文说明 `apps/web-room/` 网页房间、Bilibili 临时授权和 `proxy/shared` 播放策略的部署与运维边界。面向用户的房间行为请先看 [网页房间功能说明](../features/web-room.zh-CN.md)。

## 部署模式

网页房间是独立静态应用，源码位于 `apps/web-room/`，构建产物位于 `apps/web-room/dist/`：

```bash
npm install
npm --workspace @syncroom/web-room run build
```

根构建也会包含网页房间：

```bash
npm run build
```

当前 Node 房间服务不直接托管这些静态文件，`@syncroom/web-room` 也没有内置 dev server 脚本。请用静态文件服务、Nginx、Caddy、对象存储或 CDN 托管 `apps/web-room/dist/`，并把网页入口中的服务器地址指向浏览器可访问的 SyncRoom 服务，例如本地 `ws://localhost:8787` 或生产环境 `wss://sync.example.com`。

本地静态托管示例：

```bash
npx serve apps/web-room/dist -l 4173
```

## Server URL 与 Origin

网页房间会通过同一个 SyncRoom server 使用：

- WebSocket 房间通道
- `POST /api/providers/bilibili/*`
- `GET /proxy/manifest/:id`
- `GET /proxy/segment/:id`
- `GET /api/announcements`
- `GET /api/connection-check`

如果静态网页和 server 不同源，需要把网页 Origin 加入 `ALLOWED_ORIGINS`：

```bash
ALLOWED_ORIGINS=https://room.example.com,chrome-extension://<extension-id>
```

本地静态测试示例：

```bash
ALLOWED_ORIGINS=http://localhost:4173,chrome-extension://<extension-id>
```

生产 HTTPS 页面应使用 `wss://` server URL。如果反向代理拆分路径，需要把 `/api/providers/`、`/proxy/` 和 WebSocket upgrade 转发到同一个 SyncRoom room node。

## 临时授权

Bilibili 凭据只保存在服务端临时授权状态中：

- 单节点 memory 模式会在服务重启后清空凭据。
- 多节点部署建议使用 `RUNTIME_STORE_PROVIDER=redis` 和 `REDIS_URL`。
- 凭据不会写入 room store、Admin 事件、审计日志、错误响应或成员 payload。

房主离线授权 TTL 默认为 `600000` ms，也就是 10 分钟。该默认值当前来自服务端代码 `DEFAULT_VIDEO_AUTH_OWNER_OFFLINE_TTL_MS`，本版本没有提供独立环境变量覆盖。

只有当前房主可以启动、轮询、查看、解析或清理 Bilibili 授权。网页房间本版本只暴露 QR 二维码登录入口。

授权会在房主退出授权、离开房间、房间销毁或过期、server 重启，或房主离线超过 TTL 后清理。

## proxy/shared 语义

| 策略                        | 行为                                                             | 风险或成本                                                                                   |
| --------------------------- | ---------------------------------------------------------------- | -------------------------------------------------------------------------------------------- |
| `proxy=true`                | server 使用房主临时授权解析媒体，并返回 SyncRoom `/proxy/*` 地址 | server 承担媒体带宽和出口成本                                                                |
| `proxy=false + shared=true` | 成员浏览器直接加载 provider 直链                                 | 直链可能因 CORS、Referer、IP 绑定、过期或解码支持失败；真实媒体 URL 可能出现在浏览器网络面板 |
| `shared=false`              | 匿名或无 cookie 解析                                             | 会员内容可能失败或降级                                                                       |

首发稳定路径是 `proxy=true`。当直链播放失败时，网页房间会在房间设置区域展示失败阶段，并允许房主切回 proxy 播放。

Bilibili preview 播放是一个兼容性例外。当匿名解析或非会员解析返回了可播放的 preview 地址，但该地址仍要求浏览器无法安全附加的媒体请求头时，即使解析请求选择了 `proxy=false`，server 也会自动把该 preview 注册为 `/proxy/*` 资源。返回给网页房间的播放描述会使用实际生效的 `proxy=true`，因此界面展示与真实传输方式一致。`shared=false` 时只使用匿名 preview 所需的临时设备 cookie，不会使用或分发房主授权。

## Proxy 安全边界

Proxy 只服务 provider 解析阶段生成的 opaque resource id，不接受客户端传入的任意 URL。代理请求会校验协议、主机、DNS/IP 和私有保留网段，避免 SSRF。Bilibili 需要的 Referer/User-Agent 由 server 注入，Range 请求会透传给上游。

代理资源有 TTL。房间清理或授权清理后，对应 proxy 映射会被移除或失效。

## 高码率分片缓存

双客户端同步优先的 Nginx 配置使用 256 KiB slice 和 cache lock：

```nginx
location ^~ /proxy/segment/ {
  slice 256k;
  proxy_cache syncroom_proxy_segment;
  proxy_cache_key "$scheme$request_method$host$request_uri$slice_range";
  proxy_cache_valid 200 206 60s;
  proxy_cache_lock on;
  proxy_cache_lock_timeout 10s;
  proxy_cache_lock_age 10s;
  proxy_set_header Range $slice_range;
  proxy_pass http://127.0.0.1:8787;
}
```

该配置让一个请求填充冷 slice，另一客户端读取同一缓存内容，优先降低双端完成时间差。
相比 `512k + cache lock off`，它会增加 Node 分片请求数，并可能略微增加首字节耗时。
它不会减少 Nginx 最终发给每个浏览器的字节数；公网出口受限时仍需增加带宽或接入 CDN。

## 观测指标

低基数指标包括：

- `syncroom_playback_startup_failures_total`
- `syncroom_direct_link_playback_total`
- `syncroom_member_player_errors_total`
- `syncroom_proxy_traffic_bytes_total`
- `syncroom_proxy_requests_total`
- `syncroom_proxy_upstream_traffic_bytes_total`
- `syncroom_proxy_upstream_requests_total`
- `syncroom_proxy_cache_events_total`
- `syncroom_nginx_proxy_cache_requests_total`
- `syncroom_nginx_proxy_cache_bytes_total`
- `syncroom_nginx_proxy_cache_request_duration_seconds`

设置 `NGINX_CACHE_METRICS_PORT=5514` 后，server 会在 localhost 接收 Nginx
发送的低开销 UDP 聚合记录。Nginx `http` 配置中加入：

```nginx
log_format syncroom_cache
  'syncroom_cache status=$upstream_cache_status bytes=$body_bytes_sent request_time=$request_time';
```

并在 `/proxy/segment/` 的 `location` 中加入：

```nginx
access_log syslog:server=127.0.0.1:5514,facility=local7,tag=syncroom_cache,nohostname syncroom_cache;
```

记录只包含缓存状态、响应字节数和请求耗时，不包含房间号、资源 id、Range
或 provider URL。UDP 指标发送失败不会阻塞视频分片响应。

Admin 审计会记录房主选择视频、切换 source、切换 `proxy/shared` 策略等安全操作。它不会记录每个 segment 明细，也不会记录 Cookie、header 或原始上游签名 URL。

## 回滚

当前版本没有独立的 Bilibili provider 环境开关。可用的运维回滚方式：

- 不发布或下线 `apps/web-room/dist/` 静态入口，保留浏览器扩展流程。
- 从 `ALLOWED_ORIGINS` 移除网页 Origin，阻止网页房间连接共享 server。
- 在反向代理层临时阻断 `/api/providers/`，禁用 Bilibili 授权和解析。
- 在反向代理层临时阻断 `/proxy/`，停止 server 媒体代理；这会影响 `proxy=true` 播放。
- 多节点异常时回退单节点或 sticky 路由，并确认 Redis runtime store 状态。

当代理成本异常时，优先查看 proxy bytes/request 指标，再决定是否临时下线网页 Bilibili 入口。
