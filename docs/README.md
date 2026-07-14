# syncRoom Documentation / syncRoom 文档

This directory keeps the detailed docs that are intentionally linked from, but not fully embedded in, the root README.
本目录收纳 README 之外的详细文档。README 只保留项目入口、核心能力和关键路径；完整参数、运维细节、迁移说明和政策文档放在这里随代码一起审查。

## Documentation Model / 文档维护方式

- `README.md` is the primary landing page for GitHub visitors and new contributors.
- Topic docs under `docs/` are the source of truth for feature behavior, operations, policies, and migration steps.
- GitHub Wiki can mirror stable user-facing pages, but should not be the only source because it is not reviewed with code changes.

- `README.md` 是主入口，面向 GitHub 访客和首次接触项目的人。
- `docs/` 下的专题文档是功能行为、运维、政策和迁移步骤的源码级事实来源。
- GitHub Wiki 可以作为稳定用户文档的镜像或门户，但不建议作为唯一主文档源，因为它不会随代码变更一起走 PR 审查。

## Features / 功能

- [Web room feature guide](./features/web-room.md)
- [网页房间功能说明](./features/web-room.zh-CN.md)

The web room docs cover the standalone room workspace, playback-engine routing for Shaka/native/mpegts.js, QR platform authorization management, `proxy/shared` playback policy, room chat, system messages, private danmaku, LiveKit voice entry, and persistence boundaries.
网页房间文档覆盖独立房间工作台、Shaka/native/mpegts.js 播放引擎分发、平台二维码授权管理、`proxy/shared` 播放策略、房间聊天、系统消息、私有弹幕、LiveKit 语音入口和持久化边界。

## Operations / 运维

- [Server and deployment operations](./operations/server-operations.md)
- [服务端与部署运维](./operations/server-operations.zh-CN.md)
- [Docker single-image deployment](./operations/docker-single-image.md)
- [Docker 单镜像部署](./operations/docker-single-image.zh-CN.md)
- [Web room Bilibili proxy playback operations](./operations/web-room-bilibili-proxy.md)
- [网页房间 Bilibili 代理播放运维说明](./operations/web-room-bilibili-proxy.zh-CN.md)
- [LiveKit voice chat operations](./operations/livekit-voice-chat.md)
- [Multi-node operations runbook](./runbook/multi-node-operations.zh-CN.md)
- [Multi-node global admin migration](./operations/multi-node-global-admin-migration.md)
- [多节点全局管理面迁移说明](./operations/multi-node-global-admin-migration.zh-CN.md)

## Legal / 法务

- [Privacy policy](./legal/privacy.md)
- [隐私权政策](./legal/privacy.zh-CN.md)

## Root-Level References / 根目录入口

These files stay at the repository root because contribution tools, GitHub, or agents expect them there:
以下文件保留在仓库根目录，因为贡献工具、GitHub 或 agent 约定会从根目录读取：

- [README](../README.md) / [简体中文 README](../README.zh-CN.md) / [English README](../README.en.md)
- [CONTRIBUTING](../CONTRIBUTING.md)
- [AGENTS](../AGENTS.md)
- [CLAUDE](../CLAUDE.md)
- [HUMAN](../HUMAN.md)
