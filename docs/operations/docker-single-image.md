# Docker Single-Image Deployment

This page describes the `benxl/syncroom-server:1.0.3` single-image target. It follows the current demo-server composition while packaging the runtime into one container:

- Nginx: public container entry, default `8787`; serves `/room/` and proxies WebSocket, API, `/proxy/*`, and `/livekit/`.
- syncRoom Node server: listens on container-local `127.0.0.1:8788` by default.
- Redis: embedded by default for room state, runtime indexes, Admin session/event/audit streams, and LiveKit.
- LiveKit server: embedded by default for voice rooms.
- media-extractor-service: embedded by default on `127.0.0.1:8790` for generic and iQIYI provider resolution.

## Build

```bash
docker build --platform linux/amd64 -t benxl/syncroom-server:1.0.3 .
```

## Run

Minimal local run:

```bash
docker run --rm --name syncroom \
  -p 8787:8787 \
  -p 7881:7881 \
  -p 50000-60000:50000-60000/udp \
  benxl/syncroom-server:1.0.3
```

Open the web room at:

```text
http://localhost:8787/room/
```

Use this server URL in the extension or web room:

```text
ws://localhost:8787
```

For production, set origins, Admin credentials, and LiveKit values explicitly:

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

## Runtime Parameters

| Variable                        | Default                       | Purpose                                            |
| ------------------------------- | ----------------------------- | -------------------------------------------------- |
| `SYNCROOM_HTTP_PORT`            | `8787`                        | Nginx public HTTP entry                            |
| `PORT`                          | `8788`                        | Node server container-local port                   |
| `ALLOWED_ORIGINS`               | empty                         | Browser origins allowed in production              |
| `ALLOW_ANY_ORIGIN_IN_DEV`       | `true`                        | Convenient for smoke tests; use `false` in prod    |
| `REDIS_URL`                     | `redis://127.0.0.1:6379`      | Redis URL used by the Node server                  |
| `SYNCROOM_REDIS_MODE`           | `embedded`                    | Set `external` to skip embedded Redis              |
| `MEDIA_EXTRACTOR_BASE_URL`      | `http://127.0.0.1:8790`       | Media extractor URL used by the Node server        |
| `SYNCROOM_MEDIA_EXTRACTOR_MODE` | `embedded`                    | Set `external` to skip embedded media extractor    |
| `SYNCROOM_LIVEKIT_MODE`         | `embedded`                    | Set `external` to skip embedded LiveKit            |
| `VOICE_ENABLED`                 | `true`                        | Voice defaults to enabled when LiveKit is embedded |
| `LIVEKIT_URL`                   | `ws://localhost:8787/livekit` | Browser-facing LiveKit URL                         |
| `LIVEKIT_API_KEY`               | `syncroom`                    | LiveKit API key                                    |
| `LIVEKIT_API_SECRET`            | generated on startup          | Use a stable explicit value in production          |
| `LIVEKIT_RTC_TCP_PORT`          | `7881`                        | LiveKit RTC TCP port                               |
| `LIVEKIT_RTC_PORT_RANGE_START`  | `50000`                       | LiveKit UDP port range start                       |
| `LIVEKIT_RTC_PORT_RANGE_END`    | `60000`                       | LiveKit UDP port range end                         |
| `NGINX_CACHE_METRICS_PORT`      | `5514`                        | UDP port where the Node server reads cache metrics |
| `SYNCROOM_NGINX_SLICE_SIZE`     | `256k`                        | Nginx `/proxy/segment/` slice size                 |
| `SYNCROOM_NGINX_CACHE_MAX_SIZE` | `2g`                          | Nginx segment cache size                           |
| `SYNCROOM_NGINX_CACHE_VALID`    | `60s`                         | Nginx segment cache TTL                            |

Other backend settings still come from `server/src/config/runtime-config-schema.ts`, including room limits, rate limits, metrics, global Admin, and voice token limits.

## Production Notes

The image does not include TLS certificates. In production, keep TLS termination outside the container and proxy HTTPS traffic to `SYNCROOM_HTTP_PORT`, or mount and manage certificates with an outer reverse proxy.

The GitHub Actions Docker publish workflow pushes this image after merges to `v1.0.3` or `main`. Configure the repository secret `DOCKERHUB_TOKEN` with a Docker Hub access token that can push to `benxl/syncroom-server`.

The demo server currently runs Nginx, Node, Redis, LiveKit, and the media extractor as separate systemd services. This image keeps the same public paths:

- `/room/`: web room static files
- `/syncroom-ws`: same-origin WebSocket entry
- `/api/`: provider, announcement, and Admin APIs
- `/proxy/segment/`: Nginx slice and proxy cache path
- `/proxy/`: other proxied media resources
- `/livekit/`: LiveKit WebSocket entry
