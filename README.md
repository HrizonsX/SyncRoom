# syncRoom

简体中文 | [English](./README.en.md)

> 同频观影，好友同声。

syncRoom 是一个用于多人同步观影的浏览器扩展、网页房间和 WebSocket 服务端。用户可以创建或加入房间，同步 Bilibili 页面、通用 HTML5 `<video>` 页面，或在网页房间中通过 Shaka Player 播放服务端解析出来的 Bilibili DASH/HLS 媒体流。

## 在线体验

体验服务端地址：

```text
ws://8.163.88.33:8787
```

在扩展的高级设置或网页房间入口中把服务器地址切换为上方地址即可连接体验服务端。

![syncRoom 浏览器扩展截图](./docs/assets/syncroom-extension-popup.png)

## 核心能力

| 能力              | 简述                                                                              | 详细文档                                                           |
| ----------------- | --------------------------------------------------------------------------------- | ------------------------------------------------------------------ |
| 浏览器扩展同步    | 在 Chrome、Edge 和 Firefox 121+ 中同步 Bilibili 与通用 HTML5 视频页面             | [扩展快速开始](#快速开始)                                          |
| 网页房间          | 独立网页客户端，支持房间信息、播放器、聊天室、设置面板和授权管理                  | [网页房间功能](./docs/features/web-room.zh-CN.md)                  |
| Bilibili 代理播放 | 房主通过 QR 临时授权，服务端解析 DASH/HLS，并可用 `proxy/shared` 策略控制播放方式 | [代理播放运维](./docs/operations/web-room-bilibili-proxy.zh-CN.md) |
| 房间聊天与弹幕    | 文本聊天、房间私有弹幕和系统消息仅在房间会话内实时广播，不持久化                  | [网页房间功能](./docs/features/web-room.zh-CN.md)                  |
| LiveKit 语音      | 可选自建 LiveKit；成员默认可听，麦克风默认关闭，用户主动开麦后才请求权限          | [语音运维](./docs/operations/livekit-voice-chat.md)                |
| 管理后台          | 房间、事件、审计、配置摘要、黑名单和运行限制管理                                  | [服务端运维](./docs/operations/server-operations.zh-CN.md)         |
| 多节点部署        | Redis 可承载房间状态、运行时索引、事件流、审计流和管理命令                        | [多节点 Runbook](./docs/runbook/multi-node-operations.zh-CN.md)    |

## 快速开始

### 安装并构建

```bash
npm install
npm run build
```

### 启动本地服务端

开发时需要把当前扩展或网页房间 Origin 加入 `ALLOWED_ORIGINS`。

PowerShell：

```powershell
$env:ALLOWED_ORIGINS="chrome-extension://<extension-id>,http://localhost:4173"
npm run dev:server
```

Bash：

```bash
ALLOWED_ORIGINS=chrome-extension://<extension-id>,http://localhost:4173 \
npm run dev:server
```

更多环境变量、Admin、Redis、反向代理和生产部署注意事项见 [服务端运维](./docs/operations/server-operations.zh-CN.md)。

### 加载扩展

Chrome / Edge：

1. 打开 `chrome://extensions`
2. 开启开发者模式
3. 点击 `加载已解压的扩展程序`
4. 选择 `extension/dist`

Firefox 121+：

```bash
npm run build:extension:firefox
```

然后在 `about:debugging#/runtime/this-firefox` 中临时加载 `extension/dist-firefox/manifest.json`。

### 使用网页房间

网页房间源码位于 `apps/web-room/`，不是单独的 Node 后端服务。它会构建成 `apps/web-room/dist/` 静态文件；本地或生产环境都需要用静态文件服务托管该目录，再把网页入口中的服务器地址指向同一个 syncRoom server。

```bash
npm --workspace @syncroom/web-room run build
```

本地示例：

```bash
npx serve apps/web-room/dist -l 4173
```

随后访问 `http://localhost:4173`，服务器地址填写默认的 `ws://localhost:8787`，并确保 server 的 `ALLOWED_ORIGINS` 包含 `http://localhost:4173`。

Web Room 的播放器、Bilibili 授权、代理播放、聊天室、弹幕和语音边界见 [网页房间功能](./docs/features/web-room.zh-CN.md)。

## 文档地图

README 只保留项目入口和关键路径；完整参数、运维策略和扩展说明维护在 `docs/` 内，并随代码一起走 PR 审查。GitHub Wiki 可以作为发布后的镜像或面向用户的门户，但不建议作为此项目的唯一主文档源。

| 主题                           | 文档                                                                                                   |
| ------------------------------ | ------------------------------------------------------------------------------------------------------ |
| 文档总索引                     | [docs/README.md](./docs/README.md)                                                                     |
| 网页房间功能说明               | [docs/features/web-room.zh-CN.md](./docs/features/web-room.zh-CN.md)                                   |
| 服务端与部署运维               | [docs/operations/server-operations.zh-CN.md](./docs/operations/server-operations.zh-CN.md)             |
| 网页房间 Bilibili 代理播放运维 | [docs/operations/web-room-bilibili-proxy.zh-CN.md](./docs/operations/web-room-bilibili-proxy.zh-CN.md) |
| LiveKit 语音运维               | [docs/operations/livekit-voice-chat.md](./docs/operations/livekit-voice-chat.md)                       |
| 多节点运行手册                 | [docs/runbook/multi-node-operations.zh-CN.md](./docs/runbook/multi-node-operations.zh-CN.md)           |
| 隐私权政策                     | [docs/legal/privacy.zh-CN.md](./docs/legal/privacy.zh-CN.md)                                           |
| 贡献规则                       | [CONTRIBUTING.md](./CONTRIBUTING.md)                                                                   |

## 项目结构

```text
syncRoom/
  apps/web-room/       网页房间客户端
  extension/           Chrome、Edge、Firefox 浏览器扩展
  server/              WebSocket 房间服务端和 Admin
  packages/protocol/   共享协议类型、校验和 URL 规范化
  docs/                功能、运维、迁移和政策文档
  scripts/             构建、发布和审计脚本
```

展示名统一为 `syncRoom`；包名、环境变量、Prometheus 指标、存储 key 和内部通道使用 `syncroom` / `@syncroom/*` / `SYNCROOM_*`。

## 开发命令

```bash
npm run lint
npm run format:check
npm run typecheck
npm run build
npm test
```

常用命令、审计门禁和发布流程见 [服务端运维](./docs/operations/server-operations.zh-CN.md) 与 [CONTRIBUTING.md](./CONTRIBUTING.md)。
