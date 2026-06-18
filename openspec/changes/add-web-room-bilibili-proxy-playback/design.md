## Context

SyncRoom 当前是 `packages/protocol/`、`server/`、`extension/` 组成的 npm workspace。共享线协议、房间状态、播放状态和 URL 规范化由 `@bili-syncplay/protocol` 负责；服务端通过 WebSocket session 处理 `room:create`、`room:join`、`video:share`、`playback:update`、`sync:request`、`voice:access` 和 `voice:state`；扩展端将 popup、background、content script、offscreen voice host 分开。

本变更新增网页端入口，但不能重建第二套房间系统。网页端必须接入现有 room/session/memberToken 模型，复用 LiveKit 语音 token 发行逻辑，并通过共享协议让扩展端和网页端保持兼容。新增 Bilibili 解析、临时授权和 proxy/shared 播放链路时，后端需要保持模块化，避免把 provider、授权、manifest 改写、segment 代理和 HTTP route 混在一个 controller 中。

确认决策：

- 网页端目录使用 `apps/web-room/`。
- 首期必须支持 `proxy=true` 播放成功。
- 房主刷新网页不清除 Bilibili 临时授权；房主退出房间、房间销毁、手动登出、服务重启或服务器侧离线 TTL 到期后清除。
- 离线 TTL 先作为服务器侧配置，默认按 10 分钟设计。
- 聊天限流采用 session 级 5 秒 1 条。
- Bilibili 二维码登录和短信登录都进入首期。

## Goals / Non-Goals

**Goals:**

- 新增独立网页端房间应用，并把第一屏做成可用的观影工作台。
- 通过 Shaka Player 播放 DASH/MPD、HLS/m3u8，并通过统一播放器适配层处理普通 MP4。
- 扩展现有协议和 WebSocket/session，让网页端复用房间创建、加入、离开、成员身份、房主识别、播放同步、公告、设置、日志和 LiveKit 语音。
- 新增房间文字聊天，服务端只实时广播，不落库，前端页面生命周期内保留。
- 新增 Bilibili provider，支持 URL match、二维码登录、短信登录、非敏感授权状态、普通视频、番剧、直播和 b23.tv 短链解析。
- 新增房主临时授权态，绑定 room + owner member/session，凭据不持久化、不下发、不写日志。
- 新增 playback proxy，支持 MPD/m3u8 改写、segment 代理、Range、header 注入、白名单校验、防 SSRF、缓存 TTL 和 proxy/shared 语义。
- 新增 Admin 低开销观测：房主、点播审计、proxy/shared、播放失败阶段、粗粒度播放器错误、代理流量成本。

**Non-Goals:**

- 不引入 SyncRoom 全局登录用户体系。
- 不要求成员登录 Bilibili。
- 不实现其他视频网站 provider，只保留扩展接口。
- 不实现 FLV/HTTP-FLV，不接 mpegts.js。
- 不使用 h265web.js 作为 DASH/MPD 播放器，也不把 LiveKit track 用作主视频播放方案。
- 不通过 LiveKit 分发共享观影主视频流。
- 不持久化聊天记录或视频网站授权凭据。
- 不改变现有扩展端用户流程，除非共享协议新增字段需要向后兼容处理。

## Decisions

### Use `apps/web-room/` as a new workspace app

网页端作为新的 workspace 包放在 `apps/web-room/`，使用自己的源码、测试、构建产物和 theme。root `package.json` 需要把 `apps/*` 或 `apps/web-room` 加入 workspaces，并把 web-room 的 build/typecheck/test 接入根脚本。

Alternatives considered:

- 放在 `server/site`：拒绝。它会把网页端 UI、构建产物和服务端源码混在一起，并容易滑向营销静态页。
- 放在 `extension/`：拒绝。网页端不是扩展 UI，生命周期和权限模型不同。
- 新建顶层 `web-room/`：可行，但 monorepo 扩展性弱于 `apps/web-room/`。

### Keep protocol as the source of truth

新增聊天、provider playback descriptor、proxy/shared 选项和错误码都应通过 `packages/protocol/` 定义类型和 guards。网页端和扩展端都只消费共享协议，不使用 ad-hoc JSON shape。

Alternatives considered:

- 只给网页端加 HTTP-only JSON 契约：拒绝。房间实时状态、聊天和播放同步已经由 WebSocket/session 承担。
- 在 server route 内定义局部类型：拒绝。会造成网页端、服务端和未来扩展端行为漂移。
- 直接复用现有 `SharedVideo` 的 `url` 字段塞入所有 provider 信息：拒绝。proxy/shared、manifest type、provider id、source item、fallback 需要结构化表达。

### Reuse WebSocket room session for room, playback, chat and voice access

网页端创建/加入房间后持有现有 `memberToken`，通过同一 WebSocket 发送播放、聊天、语音 access 和 sync 请求。HTTP API 只用于网页静态资源、Bilibili 授权/解析、播放 proxy 和需要浏览器 fetch 的资源请求。

Alternatives considered:

- 给网页端单独开 chat namespace：暂不采用。现有 room event bus 已覆盖按房间广播，首期优先复用。
- 为网页端建立完整 REST room API：拒绝。会重复房间权限和实时同步。
- 让 Bilibili parse 也通过 WebSocket：不推荐。授权轮询、QR/SMS、manifest/proxy 更适合 HTTP，并需要独立缓存和 header 控制。

### Store Bilibili authorization in a temporary server-side auth store

新增 `video-auth-session` 模块，保存 room + owner member/session 绑定的临时授权状态、非敏感 profile、TTL 和 provider 凭据。凭据可以存在内存或 Redis runtime 临时状态，但不得写入持久 room store、事件存储、日志、错误响应或成员 payload。房主刷新网页后，只要能用同一 memberToken/session 恢复 owner 身份，授权继续有效；房主退出、手动登出、房间销毁、服务重启或离线 TTL 到期后失效。

Alternatives considered:

- 只绑 socket session：安全简单，但刷新即丢授权，不符合已确认需求。
- 持久化到 room store：拒绝。违反不持久化授权信息。
- 绑全局用户账号：拒绝。SyncRoom 没有全局用户体系。

### Implement Bilibili as the first provider behind an adapter interface

后端新增 provider 接口，Bilibili adapter 只负责 URL match、登录流程、B 站 API 调用、视频/番剧/直播解析和播放源描述生成。核心 web-room flow 不直接依赖 B 站响应结构。B 站 API 请求由服务端携带临时授权、buvid、WBI 签名、UA、Referer 等必要信息，客户端不得直接请求敏感 API。

Alternatives considered:

- 直接照 SyncTV vendor 结构搬到 route：拒绝。会把供应商响应泄漏到产品模型。
- 前端直接调用 B 站接口：拒绝。会暴露敏感请求行为并遇到 CORS/凭据问题。
- 一次性抽象多个 provider：拒绝。首期只做 Bilibili，接口保留扩展即可。

### Make `proxy=true` the authoritative MVP playback path

`proxy=true` 时，服务端使用临时授权解析真实 MPD/m3u8 或直播 HLS，生成 SyncRoom playback item，并将 manifest 中真实资源改写为 SyncRoom proxy URL。segment 请求只能命中 adapter 产生并缓存的白名单 URL。代理请求补 B 站需要的 Referer/User-Agent，并支持 Range。

Alternatives considered:

- 先只做 `proxy=false + shared=true`：拒绝。用户已确认首期必须 proxy 播放成功。
- 直接把 B 站直链写入 room shared video：仅适合 shared 模式，不满足隐藏真实源和稳定 header 注入。
- 将视频流送入 LiveKit：拒绝。LiveKit 只做语音，主视频由 URL 播放器播放。

### Treat `proxy` and `shared` as explicit playback policy

`proxy` 决定是否经 SyncRoom 代理播放；`shared` 决定是否允许把房主授权解析出的直链共享给成员浏览器。`proxy=true` 优先返回 SyncRoom manifest/proxy URL；`proxy=false + shared=true` 返回直链；`shared=false` 走匿名/无 cookie 解析并允许会员内容失败。

Alternatives considered:

- 只保留一个开关：拒绝。无法区分带宽成本和授权直链共享语义。
- 要求成员各自授权：拒绝。违反无登录成员体系和 PRD 约束。
- proxy 失败自动静默降级直链：拒绝。可能泄露真实源，应由 UI 明确提示和授权选择。

### Keep chat lightweight and session-scoped

聊天消息作为新协议消息在现有房间通道中发送。服务端验证 memberToken、房间 membership、长度和 5 秒 session 限流，然后广播文本消息。消息不写数据库；可选短内存历史不是首期硬需求。前端使用文本渲染或 HTML 转义，不使用 unsafe HTML。

Alternatives considered:

- IP/Redis 限流：更抗滥用，但用户已确认 session 级即可。
- 持久化聊天记录：拒绝。超出首期需求且带来隐私和存储治理问题。
- 独立聊天室服务：拒绝。会重复 room/session 权限。

### Extract web theme from extension popup

网页端使用 extension popup 的颜色、间距、控件、状态色和字体层级作为设计源。若没有集中 token，就在 `apps/web-room/` 内建立 theme 文件，并从 `extension/public/popup.css` 抽取变量。网页端不能使用第三方组件库默认皮肤，也不能用营销站视觉。

Alternatives considered:

- 复用之前静态官网/hero 风格：拒绝。PRD 明确要求房间工作台，不做营销页。
- 完全复制 popup 固定 390px 布局：拒绝。网页端需要响应式，但视觉语言要一致。
- 引入大型 UI 组件库默认主题：拒绝。会造成观感割裂。

### Follow the supplied web room wireframe for the joined-room screen

网页房间的已加入房间首屏以 `assets/web-room-ui-layout.png` 为布局基准。桌面布局从上到下依次为：全宽公告栏；视频标题与授权管理入口所在的顶部操作行；播放器为主、聊天室为右侧辅助栏的观影区域；底部左右两块分别承载房间信息/在线成员列表和房间设置/其他设置。播放器应占据首屏主要面积，聊天室始终与播放器同一行展示，房间信息和设置不应挤占播放器首屏空间。

授权管理入口位于顶部右侧，房主可进入 Bilibili QR/SMS 登录、授权状态、退出登录和 provider 解析设置；非房主只能看到安全的授权/播放状态或禁用态，不暴露凭据控制。窄屏时保持同一信息顺序堆叠：公告、标题/授权状态、播放器、聊天室、房间信息/在线成员、房间设置，并通过稳定的播放器宽高比、固定工具区尺寸和可滚动面板避免文字、按钮和聊天内容互相覆盖。

Alternatives considered:

- 把聊天室放到播放器下方作为默认桌面布局：拒绝。用户补充的布局明确要求聊天室在播放器右侧，方便边看边聊。
- 把房间信息和设置做成弹窗或隐藏抽屉：首版不作为默认。底部两个面板需要直接可见，后续可以在小屏幕上折叠或分段展示。
- 把授权管理混入设置区：拒绝。授权入口需要在顶部右侧保持可发现性，并与房主视频解析流程靠近。

### Add low-cardinality observability only

Admin/metrics 只记录低开销聚合：房主是谁、点播/切源/proxy/shared、播放启动失败阶段、直链成功/失败和是否回退、粗粒度浏览器/系统播放器错误、按房间/provider 聚合的代理流量与成本。不得按 segment 高频明细写事件流。

Alternatives considered:

- 记录所有 segment 请求明细：拒绝。成本高且噪声大。
- 不做 Admin 指标：拒绝。proxy 带宽和播放失败需要上线诊断。
- 记录敏感 URL/Cookie/header：拒绝。违反凭据防泄漏约束。

## Risks / Trade-offs

- [Bilibili 接口、WBI 签名、登录流程可能变化] -> 将 B 站逻辑封装在 adapter 内，添加 URL match、登录状态、parse 和错误映射测试；实现前固定参考 SyncTV/vendor 代码版本。
- [proxy=true 增加服务器带宽和成本] -> Admin 按房间/provider 聚合流量，文档说明成本；保留 shared 直链模式和回退提示。
- [SSRF 或开放代理风险] -> 代理只接受 adapter 产出的 tokenized resource id，不接受任意 URL；校验协议、host、DNS/IP 和私网地址。
- [授权凭据泄漏] -> 日志、错误、payload、Admin 视图统一使用脱敏数据；测试覆盖 API 响应、成员 payload 和日志路径。
- [房主刷新保留授权增加凭据存活时间] -> 使用 server TTL、owner memberToken 绑定和手动 logout；默认离线 TTL 10 分钟，可配置。
- [Shaka 可播放协议但不保证解码 HEVC] -> B 站优先 H.264/AVC，HEVC 作为可选源，UI 暴露 decode 失败阶段和降级提示。
- [网页端和扩展端共享协议可能破坏旧扩展] -> 新消息/字段保持 additive，guards 允许旧客户端忽略未知能力，现有扩展测试必须回归。
- [聊天 session 级限流可被重连绕过] -> 这是已确认的首期取舍；如果后续需要抗滥用，再扩展 IP/Redis 限流。
- [短信登录带来验证码/风控复杂度] -> 作为首期能力实现，但 UI 必须处理验证码、过期、失败和重试状态，不把短信登录阻塞二维码登录。

## Migration Plan

1. 新增 OpenSpec 和后续实现分支均基于 `v1.3.0`，PR 目标分支也为 `v1.3.0`。
2. 先新增协议、类型、provider 数据模型和测试，保持现有扩展端路径不变。
3. 加入 `apps/web-room/` workspace、theme 和房间壳，接入现有 WebSocket room flow。
4. 增加聊天能力，并验证不落库、限流和文本渲染。
5. 增加 Bilibili auth session store、二维码/短信登录和非敏感 `me` 状态。
6. 增加 Bilibili URL match/parse 和点播选择模型。
7. 增加 `proxy=true` manifest/segment 代理，完成安全校验、Range、TTL 和脱敏测试。
8. 增加 `proxy=false + shared=true` 和 `shared=false` 分支、错误/降级 UI。
9. 增加 Admin/metrics 聚合指标和操作审计。
10. 完成 web-room 浏览器截图/手动验收、插件端回归和完整 pre-commit 检查。

Rollback strategy:

- 可通过服务端配置关闭 web provider/proxy 能力，让现有扩展端播放同步继续工作。
- 如果 proxy 成本或播放失败率异常，可以禁用 `proxy=false` 直链分享或禁用 Bilibili provider，而不回滚 LiveKit 或扩展端房间功能。

## Open Questions

- 离线 TTL 默认值暂定 10 分钟；实现时是否暴露为 `VIDEO_AUTH_OWNER_OFFLINE_TTL_MS` 或统一 web-room provider 配置名称需要在配置设计中确认。
- 短信登录是否需要图形验证码/滑块验证码的完整前端交互，取决于参考 SyncTV/vendor 版本和 B 站当前接口行为。
- `proxy=false + shared=true` 失败后是否自动触发 proxy 回退，还是仅提示房主一键切换，需要在 UI 交互阶段确认。
- 网页端部署方式是由 Node server 托管构建产物，还是独立静态部署后连接 SyncRoom server；首期建议 Node server 托管以减少 CORS 和配置面，但需要实现阶段确认部署目标。
