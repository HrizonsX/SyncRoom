## Why

SyncRoom 目前核心观影能力主要依赖浏览器扩展，网页端还不能独立完成创建/加入房间、播放同步、聊天、语音和视频网站授权解析的完整观影闭环。新增网页端房间可以让用户不安装扩展也能加入同步观影，并把 Bilibili 会员内容解析、临时授权和代理播放纳入同一个房间/session 模型中。

## What Changes

- 新增 `apps/web-room/` 网页端房间应用，第一屏就是可用的房间观影界面，不做营销页或全新品牌视觉。
- 网页端复用现有房间创建、加入、离开、房主识别、播放同步、公告、设置、WebSocket/session、安全校验和 LiveKit 语音 token/room 能力。
- 新增 Shaka Player 播放器适配层，承接 DASH/MPD、HLS/m3u8，并通过统一适配层处理普通 MP4；FLV/HTTP-FLV 和 h265web.js 不进入首期。
- 新增网页端文字聊天室，使用现有房间 WebSocket/session 通道扩展消息类型，消息不落库，前端只在页面生命周期保留，前后端做 5 秒 1 条的 session 级限流和 XSS 防护。
- 新增视频网站适配器边界，首期只实现 Bilibili，覆盖 BV、av、番剧 ep、番剧 ss、直播间和 b23.tv 短链。
- 新增 Bilibili 临时授权能力，支持二维码登录和短信登录；授权信息只保存在服务端临时状态中，不持久化、不落盘、不写入日志、不返回给成员或普通前端 payload。
- 新增房主点播面板，支持解析 B 站视频/番剧/直播，选择分 P、剧集或直播流，并在点播时保存 `proxy` / `shared` 选项。
- 首期必须实现 `proxy=true` 播放成功：服务端使用房主临时授权解析 MPD/m3u8，改写 manifest 到 SyncRoom 代理地址，并代理 segment 请求。
- 支持 `proxy=false + shared=true` 直链模式，播放失败时展示清晰错误并允许回退 proxy；`shared=false` 走匿名/无 cookie 解析，会员内容失败是合理降级。
- 新增 proxy 安全边界：只代理适配器解析出的白名单 URL，校验协议、host、IP，防 SSRF，补 Referer/User-Agent，支持 Range 请求，manifest/segment 缓存设置 TTL，并确保 Cookie/token/header 不泄露。
- 新增 Admin 低开销诊断指标：房主身份、播放启动失败阶段、直链成功/失败、proxy 回退、房主关键操作审计、粗粒度成员播放器错误，以及按房间/provider 聚合的代理流量与资源成本。
- 不引入 SyncRoom 全局登录用户体系，不要求成员登录 Bilibili，不通过 LiveKit 分发共享观影主视频流，不破坏现有扩展端行为。

- 网页房间已加入房间后的首屏布局以 `assets/web-room-ui-layout.png` 为准：顶部公告、视频标题与授权管理入口、播放器 + 右侧聊天室、底部房间信息/在线成员和房间设置两块面板。

## Capabilities

### New Capabilities

- `web-room-client`: 网页端房间应用、房间进入/观影 UI、Shaka 播放器适配、播放同步、公告/设置/日志入口和 LiveKit 语音复用。
- `web-room-chat`: 网页端房间文字聊天、实时广播、session 级限流、文本渲染/XSS 防护和非持久化消息生命周期。
- `video-site-auth-session`: 房主临时视频网站授权状态、TTL、房主离线/退出/房间销毁清理、非敏感授权状态暴露和凭据防泄漏。
- `bilibili-video-provider`: Bilibili URL 匹配、二维码/短信登录、用户状态、普通视频/番剧/直播解析，以及可扩展 provider 接口。
- `playback-proxy`: Bilibili MPD/m3u8 改写、segment 代理、Range/header 支持、白名单/SSRF 防护、缓存 TTL 和 proxy/shared 播放语义。
- `web-room-admin-observability`: 网页端点播、proxy/shared、播放失败、房主操作和代理成本的 Admin 可观测能力。

### Modified Capabilities

- None. The repository has no archived baseline OpenSpec capability specs yet; this change will add new capability specs and reuse existing code contracts where possible.

## Impact

- Root workspace config: add `apps/web-room/` to npm workspaces and include it in build/typecheck/test workflows as appropriate.
- `apps/web-room/`: new browser web app with SyncRoom-aligned theme extracted from extension popup styles, Shaka Player integration, room state UI, chat, Bilibili auth/pick panel, voice controls, settings, announcements and logs.
- `packages/protocol/`: add shared message/domain contracts and guards for web room chat, web-originated video selection/playback metadata, provider playback descriptors, proxy/shared options and related errors.
- `server/`: add modular web room HTTP routes/controllers, provider adapter interfaces, Bilibili adapter, temporary auth session store, playback proxy service, proxy/shared decision flow, chat handling, metrics and tests.
- Existing server room/session/WebSocket flow: extend without replacing `room:create`, `room:join`, `video:share`, `playback:update`, `sync:request`, `voice:access` and `voice:state`.
- Existing extension: should remain behaviorally unchanged except for shared protocol additions that must stay backward-compatible.
- Documentation and operations notes: document Bilibili temporary authorization, proxy bandwidth/security tradeoffs, new environment/config defaults, and rollback by disabling the web provider/proxy feature.
