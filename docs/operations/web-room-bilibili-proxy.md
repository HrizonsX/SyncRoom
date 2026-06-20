# Web Room Bilibili Proxy Playback Operations

This guide covers deployment and operations for the `apps/web-room/` client, temporary Bilibili authorization, and `proxy/shared` playback policy.

For user-facing room behavior, see the [web room feature guide](../features/web-room.md).

## Deployment Mode

The web room is a standalone static app. Source lives in `apps/web-room/`, and build output is written to `apps/web-room/dist/`:

```bash
npm install
npm --workspace @syncroom/web-room run build
```

The root build also includes the web room:

```bash
npm run build
```

The Node room server does not serve these static files directly, and `@syncroom/web-room` does not include a built-in dev server script. Host `apps/web-room/dist/` through a static file server, Nginx, Caddy, object storage, or a CDN, and point the web app at a browser-reachable SyncRoom server URL such as `ws://localhost:8787` locally or `wss://sync.example.com` in production.

Local static hosting example:

```bash
npx serve apps/web-room/dist -l 4173
```

## Server URL And Origin

The web room uses the SyncRoom server for:

- the WebSocket room channel
- `POST /api/providers/bilibili/*`
- `GET /proxy/manifest/:id`
- `GET /proxy/segment/:id`
- `GET /api/announcements`
- `GET /api/connection-check`

If the static web app and server are on different origins, add the web origin to `ALLOWED_ORIGINS`:

```bash
ALLOWED_ORIGINS=https://room.example.com,chrome-extension://<extension-id>
```

For local static testing:

```bash
ALLOWED_ORIGINS=http://localhost:4173,chrome-extension://<extension-id>
```

For production HTTPS pages, use a `wss://` server URL. If a reverse proxy splits paths, route `/api/providers/`, `/proxy/`, and WebSocket upgrades to the same SyncRoom room node.

## Temporary Authorization

Bilibili credentials are stored only in the temporary server-side auth store:

- single-node memory mode clears credentials on restart
- multi-node deployments should use `RUNTIME_STORE_PROVIDER=redis` with `REDIS_URL`
- credentials are not written to room storage, Admin events, audit logs, errors, or member payloads

The room-owner offline TTL defaults to `600000` ms, or 10 minutes. The default is currently code-level via `DEFAULT_VIDEO_AUTH_OWNER_OFFLINE_TTL_MS`; this release does not expose a dedicated environment variable override.

Only the current room host can start, poll, inspect, parse with, or clear Bilibili authorization. The web room UI exposes QR login for Bilibili authorization in this release.

Authorization is cleared when the host logs out, leaves the room, the room is destroyed or expires, the server restarts, or the owner remains offline past the TTL.

## proxy/shared Semantics

| Policy                      | Behavior                                                                              | Risk or Cost                                                                                                                           |
| --------------------------- | ------------------------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------- |
| `proxy=true`                | The server parses media with host temporary auth and returns SyncRoom `/proxy/*` URLs | Server pays media bandwidth and egress cost                                                                                            |
| `proxy=false + shared=true` | Member browsers load provider direct links                                            | Direct links may fail due to CORS, Referer, IP binding, expiry, or decode support; real media URLs may appear in browser network tools |
| `shared=false`              | Anonymous/no-cookie parsing                                                           | Member-only content can fail or downgrade                                                                                              |

The authoritative first-release path is `proxy=true`. When direct-link playback fails, the web room reports the failure stage and lets the host switch back to proxy.

## Observability

Low-cardinality metrics include:

- `syncroom_playback_startup_failures_total`
- `syncroom_direct_link_playback_total`
- `syncroom_member_player_errors_total`
- `syncroom_proxy_traffic_bytes_total`
- `syncroom_proxy_requests_total`

Admin audit records safe host actions such as selecting video, changing source, and changing `proxy/shared` policy. It does not store per-segment events, cookies, headers, or raw upstream signed URLs.

## Rollback

This release does not expose a dedicated Bilibili provider environment switch. Operational rollback options are:

- stop publishing `apps/web-room/dist/` and keep the extension flow
- remove the web origin from `ALLOWED_ORIGINS`
- block `/api/providers/` at the reverse proxy to disable Bilibili authorization and parsing
- block `/proxy/` at the reverse proxy to stop server media proxying
- during multi-node incidents, fall back to single-node or sticky routing and verify Redis runtime state

When proxy cost spikes, inspect proxy byte/request metrics before deciding whether to disable the web Bilibili entry.
