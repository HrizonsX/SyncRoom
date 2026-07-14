# Docker 单镜像部署

本文说明 `benxl/syncroom-server:1.0.3` 的单镜像目标形态。它参考当前演示服务器的 systemd 编排，把原本分散运行的组件收进同一个容器：

- Nginx：容器对外入口，默认监听 `8787`，托管 `/room/` 网页房间，并代理 WebSocket、API、`/proxy/*` 和 `/livekit/`。
- syncRoom Node server：默认只监听容器内 `127.0.0.1:8788`。
- Redis：默认内置，承载房间状态、运行时索引、Admin session/event/audit 和 LiveKit。
- LiveKit server：默认内置，用于语音房间。
- media-extractor-service：默认内置，监听 `127.0.0.1:8790`，供 generic/iqiyi provider 调用。

## 构建

```bash
docker build --platform linux/amd64 -t benxl/syncroom-server:1.0.3 .
```

## 启动示例

本地最小启动：

```bash
docker run --rm --name syncroom \
  -p 8787:8787 \
  -p 7881:7881 \
  -p 50000-60000:50000-60000/udp \
  benxl/syncroom-server:1.0.3
```

访问网页房间：

```text
http://localhost:8787/room/
```

扩展或网页房间的服务器地址使用：

```text
ws://localhost:8787
```

生产环境建议显式配置 Origin、Admin 密钥和 LiveKit URL：

```bash
docker run -d --name syncroom \
  -p 8787:8787 \
  -p 7881:7881 \
  -p 50000-60000:50000-60000/udp \
  -e ALLOWED_ORIGINS=https://sync.example.com,chrome-extension://<extension-id> \
  -e ALLOW_ANY_ORIGIN_IN_DEV=false \
  -e ADMIN_USERNAME=admin \
  -e ADMIN_PASSWORD_HASH='sha256:<hex>' \
  -e ADMIN_SESSION_SECRET='<random-secret>' \
  -e LIVEKIT_URL=wss://sync.example.com/livekit \
  -e LIVEKIT_API_KEY='<livekit-api-key>' \
  -e LIVEKIT_API_SECRET='<livekit-api-secret>' \
  benxl/syncroom-server:1.0.3
```

## 主要运行参数

| 变量                            | 默认值                        | 说明                                                |
| ------------------------------- | ----------------------------- | --------------------------------------------------- |
| `SYNCROOM_HTTP_PORT`            | `8787`                        | Nginx 对外 HTTP 入口端口                            |
| `PORT`                          | `8788`                        | Node server 容器内部端口                            |
| `ALLOWED_ORIGINS`               | 空                            | 生产应显式填写浏览器 Origin                         |
| `ALLOW_ANY_ORIGIN_IN_DEV`       | `true`                        | 便于开箱测试；生产建议设为 `false`                  |
| `REDIS_URL`                     | `redis://127.0.0.1:6379`      | Node server 使用的 Redis 地址                       |
| `SYNCROOM_REDIS_MODE`           | `embedded`                    | 设为 `external` 时不启动内置 Redis                  |
| `ROOM_STORE_PROVIDER`           | `redis`                       | 房间存储 provider                                   |
| `RUNTIME_STORE_PROVIDER`        | `redis`                       | 运行时状态 provider                                 |
| `ROOM_EVENT_BUS_PROVIDER`       | `redis`                       | 房间事件总线 provider                               |
| `ADMIN_COMMAND_BUS_PROVIDER`    | `redis`                       | Admin 命令总线 provider                             |
| `ADMIN_SESSION_STORE_PROVIDER`  | `redis`                       | Admin session provider                              |
| `ADMIN_EVENT_STORE_PROVIDER`    | `redis`                       | Admin event provider                                |
| `ADMIN_AUDIT_STORE_PROVIDER`    | `redis`                       | Admin audit provider                                |
| `MEDIA_EXTRACTOR_BASE_URL`      | `http://127.0.0.1:8790`       | Node server 调用媒体解析服务的地址                  |
| `SYNCROOM_MEDIA_EXTRACTOR_MODE` | `embedded`                    | 设为 `external` 时不启动内置媒体解析服务            |
| `SYNCROOM_LIVEKIT_MODE`         | `embedded`                    | 设为 `external` 时不启动内置 LiveKit                |
| `VOICE_ENABLED`                 | `true`                        | 内置 LiveKit 模式下默认启用语音                     |
| `LIVEKIT_URL`                   | `ws://localhost:8787/livekit` | 浏览器可访问的 LiveKit URL；生产应改为公网 `wss://` |
| `LIVEKIT_API_KEY`               | `syncroom`                    | LiveKit API key                                     |
| `LIVEKIT_API_SECRET`            | 启动时随机生成                | LiveKit API secret；生产应显式传入稳定值            |
| `LIVEKIT_PORT`                  | `7880`                        | LiveKit HTTP/WebSocket 内部端口                     |
| `LIVEKIT_RTC_TCP_PORT`          | `7881`                        | LiveKit RTC TCP 端口                                |
| `LIVEKIT_RTC_PORT_RANGE_START`  | `50000`                       | LiveKit UDP 端口范围起点                            |
| `LIVEKIT_RTC_PORT_RANGE_END`    | `60000`                       | LiveKit UDP 端口范围终点                            |
| `NGINX_CACHE_METRICS_PORT`      | `5514`                        | Node server 接收 Nginx cache UDP 指标的端口         |
| `SYNCROOM_NGINX_SLICE_SIZE`     | `256k`                        | Nginx `/proxy/segment/` 分片大小                    |
| `SYNCROOM_NGINX_CACHE_MAX_SIZE` | `2g`                          | Nginx segment cache 大小                            |
| `SYNCROOM_NGINX_CACHE_VALID`    | `60s`                         | Nginx segment cache TTL                             |

其它后端参数仍沿用 `server/src/config/runtime-config-schema.ts` 中的环境变量，例如 `MAX_MEMBERS_PER_ROOM`、`RATE_LIMIT_*`、`METRICS_PORT`、`GLOBAL_ADMIN_ENABLED`、`VOICE_TOKEN_TTL_SECONDS`、`VOICE_MAX_MEMBERS`。

## 现网对照

当前演示服务器的组件形态是 systemd 分开托管：Nginx 1.24.0、Node 20.20.2、Redis 6.2.20、LiveKit 1.12.0、Python 3.11.13 media-extractor-service。单镜像保持 Node、Redis、LiveKit 和 Python 版本对齐；Nginx 使用 `nginx:1.26-bookworm`，保留 slice/cache/SSL/HTTP2 能力，并避免旧 bullseye 基底与 Redis 6.2.20 的 OpenSSL 运行库冲突。入口路径保持一致：

- `/room/`：网页房间静态文件
- `/syncroom-ws`：HTTPS 同源 WebSocket 入口
- `/api/`：Provider、公告和 Admin API
- `/proxy/segment/`：Nginx slice + proxy cache
- `/proxy/`：其它代理资源
- `/livekit/`：LiveKit WebSocket 入口

容器内默认没有 TLS 证书。生产环境可以继续在容器外层做 TLS 终止，也可以把外部 443 反代到容器的 `SYNCROOM_HTTP_PORT`。

GitHub Actions 的 Docker 发布流水线会在代码合并到 `v1.0.3` 或 `main` 后推送镜像。仓库需要配置 `DOCKERHUB_TOKEN` secret，令牌必须具备推送 `benxl/syncroom-server` 的权限。
