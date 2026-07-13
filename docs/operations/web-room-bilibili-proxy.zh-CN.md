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

浏览器可能用 `Range: bytes=0-` 请求整段 MP4。Node 不会把这种可能达到几十 MiB
的开放区间放进内存缓存；多人高码率部署应由 Nginx 把请求切成固定大小的闭合区间。

先用 `nginx -V 2>&1` 确认构建包含 `ngx_http_slice_module`。下面的
`proxy_cache_path` 和 `log_format` 放在 `http` 块，`location` 放在对外服务的
`server` 块：

```nginx
proxy_cache_path /var/cache/nginx/syncroom-proxy-segment
  levels=1:2
  keys_zone=syncroom_proxy_segment:64m
  max_size=2g
  inactive=10m
  use_temp_path=off;

log_format syncroom_cache
  'syncroom_cache status=$upstream_cache_status bytes=$body_bytes_sent request_time=$request_time';

location ^~ /proxy/segment/ {
  slice 256k;
  proxy_cache syncroom_proxy_segment;
  proxy_cache_key "$scheme$request_method$host$request_uri$slice_range";
  proxy_cache_valid 200 206 60s;
  proxy_cache_lock on;
  proxy_cache_lock_timeout 10s;
  proxy_cache_lock_age 10s;

  # Node 为授权媒体返回 no-store；这里只缓存短 TTL 的 opaque segment id。
  proxy_ignore_headers Cache-Control Expires Set-Cookie;
  proxy_hide_header Set-Cookie;
  proxy_buffering on;
  proxy_http_version 1.1;
  proxy_set_header Accept-Encoding "";
  proxy_set_header Range $slice_range;

  proxy_pass http://127.0.0.1:8787;

  # 启用 NGINX_CACHE_METRICS_PORT=5514 时保留；否则删除这一行。
  access_log syslog:server=127.0.0.1:5514,facility=local7,tag=syncroom_cache,nohostname syncroom_cache;
  # 便于上线检查，可在验证结束后删除。
  add_header X-SyncRoom-Cache $upstream_cache_status always;
}
```

创建缓存目录时应把所有者设置为 Nginx worker 用户，然后检查并平滑重载：

```bash
sudo install -d -o www-data -g www-data /var/cache/nginx/syncroom-proxy-segment
sudo nginx -t
sudo systemctl reload nginx
```

不同发行版的 worker 用户可能是 `nginx`，以 `nginx.conf` 的 `user` 指令为准。
用房间实际生成的 opaque resource id 连续请求两次相同 Range：

```bash
curl -sS -D - -o /dev/null -H 'Range: bytes=0-262143' \
  'https://sync.example.com/proxy/segment/<resource-id>' | grep -i x-syncroom-cache
```

冷缓存第一次应为 `MISS`，第二次应为 `HIT`。若一直 `MISS`，依次检查 slice 模块、
缓存目录权限、两次请求的 URL/Range 是否完全一致，以及上游是否返回 `200/206`。

该配置让一个请求填充冷 slice，其他客户端等待并读取同一份缓存内容，优先降低双端
完成时间差。相比 `512k + cache lock off`，它会增加 Node 分片请求数，并可能略微
增加首字节耗时。缓存 TTL 必须保持较短，因为 opaque URL 可能对应房主授权媒体。
不要对视频分片启用 gzip 或 brotli，压缩后的 Range 响应可能破坏 seek 和缓冲。

Node 内存层仍会合并完全相同的闭合 Range；默认缓存 TTL 为 60 秒、总量 256 MiB、
单项 16 MiB，并最多同时填充 64 个不同缓存键。字节预算不足时会自动改为流式透传，
不会先把完整响应堆进内存。Nginx 缓存不会减少最终发送给每个浏览器的字节数；公网
出口受限时仍需增加带宽或接入 CDN。多节点部署需要 sticky routing 或共享/CDN 缓存。

Nginx 缓存只解决重复取片，不等同于播放 barrier。`smooth` 模式允许先缓冲好的成员
先播放；`wait` 模式会先把各网页客户端定位到目标时间，等待每个成员在目标位置至少
缓冲 6 秒后再恢复。例如成员原本停在 12 秒、房主拖到 120 秒时，客户端必须先 seek
到 120 秒，再计算 120 秒附近的缓冲；不能拿 12 秒处的旧缓存上报 ready。普通播放中途
卡顿以 3 秒作为 ready 阈值。初始播放、恢复播放或拖动产生的 barrier 最长 30 秒，
播放中途 hold 最长 10 秒；即使异常客户端停止上报，服务端也会自动释放。

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

带 `room_code` 的 Node proxy 指标会在房间删除事件到达，或该房间最后一个 proxy 资源
到期时移除，避免长期运行后历史房间持续增加内存和 `/metrics` 体积。Nginx HIT/MISS
指标不带房间号。

设置 `NGINX_CACHE_METRICS_PORT=5514` 后，server 会在 localhost 接收 Nginx
发送的低开销 UDP 聚合记录。上面的完整配置已经包含对应 `log_format` 和
`access_log`；未启用该环境变量时删除 syslog `access_log` 行即可。记录只包含缓存
状态、响应字节数和请求耗时，不包含房间号、资源 id、Range 或 provider URL。
UDP 指标发送失败不会阻塞视频分片响应。

Admin 审计会记录房主选择视频、切换 source、切换 `proxy/shared` 策略等安全操作。它不会记录每个 segment 明细，也不会记录 Cookie、header 或原始上游签名 URL。

## 回滚

当前版本没有独立的 Bilibili provider 环境开关。可用的运维回滚方式：

- 不发布或下线 `apps/web-room/dist/` 静态入口，保留浏览器扩展流程。
- 从 `ALLOWED_ORIGINS` 移除网页 Origin，阻止网页房间连接共享 server。
- 在反向代理层临时阻断 `/api/providers/`，禁用 Bilibili 授权和解析。
- 在反向代理层临时阻断 `/proxy/`，停止 server 媒体代理；这会影响 `proxy=true` 播放。
- 多节点异常时回退单节点或 sticky 路由，并确认 Redis runtime store 状态。

当代理成本异常时，优先查看 proxy bytes/request 指标，再决定是否临时下线网页 Bilibili 入口。
