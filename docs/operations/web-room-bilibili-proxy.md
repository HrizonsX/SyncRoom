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

For timestamped production releases, verify the process entry point as well as
the systemd working directory. A copied `start.sh` can still contain an absolute
path to the previous release:

```bash
pid="$(systemctl show syncRoom -p MainPID --value)"
ps -p "$pid" -o args=
readlink -f "/proc/$pid/cwd"
```

Keep the previous server and web release directories plus copies of the unit
override and reverse-proxy configuration. After switching, check the service
health, compare the published web bundle hash with the build artifact, and run
a protocol probe against the behavior changed by the release. Restarting a
single-node process invalidates in-memory proxy resource IDs, so an active room
may need to reparse or refresh its provider playback URL after deployment.

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

Bilibili preview playback is a compatibility exception. When anonymous or non-member parsing returns a playable preview URL that still requires provider media headers, the server automatically registers that preview under `/proxy/*` even if the parse request selected `proxy=false`. The returned playback descriptor reports the effective `proxy=true` policy, so the web room reflects the actual delivery mode. With `shared=false`, this path uses only anonymous preview credentials such as temporary device cookies and never owner authorization.

## Segment Cache For High-Bitrate Proxy Playback

Browsers can request large MP4 resources as open-ended ranges such as `Range: bytes=0-`.
Those responses are intentionally not stored in the Node in-memory segment cache because a
single 1080P request can be tens of megabytes. For deployments that serve multiple members
through the same reverse proxy, prefer an edge or reverse-proxy cache that slices segment
responses into small range requests before they reach the Node server.

For Nginx deployments with `ngx_http_slice_module`, use a short-lived disk cache on
`/proxy/segment/`:

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
  # One upstream request fills a cold slice while concurrent members wait for
  # the same cached bytes instead of opening duplicate response streams.
  proxy_cache_lock on;
  proxy_cache_lock_timeout 10s;
  proxy_cache_lock_age 10s;
  proxy_ignore_headers Cache-Control Expires Set-Cookie;
  proxy_hide_header Set-Cookie;
  proxy_set_header Range $slice_range;
  proxy_pass http://127.0.0.1:8787;
  access_log syslog:server=127.0.0.1:5514,facility=local7,tag=syncroom_cache,nohostname syncroom_cache;
}
```

Set `NGINX_CACHE_METRICS_PORT=5514` on the SyncRoom server process to ingest
the local UDP records. The payload contains only cache status, response bytes,
and request duration; it does not include room codes, resource ids, ranges, or
provider URLs. UDP delivery keeps segment responses independent from telemetry.

Keep the TTL short because proxy segment URLs may represent room-owner authorized media.
This cache reduces repeated origin/server fetches for multiple members watching the same
resource, but it does not reduce the final bytes sent from the edge to each browser. Do not
use gzip or brotli for video segment responses; video bytes are already codec-compressed and
compressed range responses can break seek and buffering behavior.

The 256 KiB locked profile favors two-client completion fairness: one request fills each cold
slice and the other client receives a cache hit. It increases the number of Node requests and
can add a small first-byte delay compared with 512 KiB slices without a lock. It does not
reduce the final bytes sent to browsers, so constrained public egress still needs more
bandwidth or a CDN. Multi-node deployments need sticky routing or a shared/CDN cache layer.

Segment caching is a bandwidth optimization, not a playback barrier. In `smooth` mode, the
member who seeks can resume before another member has buffered the target. A stalled member
keeps loading its current range instead of repeatedly chasing the projected timeline from
buffer-only room updates, so it can temporarily fall behind. Use the room's `wait` strategy
when all members should pause for a buffering participant before resuming. Wait mode freezes
the shared timeline until every reported buffering member has at least three seconds buffered;
the host can switch back to smooth mode, and a departing buffering member is removed from the
hold. A media `waiting` event with at least three seconds already buffered is treated as ready
because MSE append-window changes can emit transient false stalls.

## Observability

Low-cardinality metrics include:

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

Admin audit records safe host actions such as selecting video, changing source, and changing `proxy/shared` policy. It does not store per-segment events, cookies, headers, or raw upstream signed URLs.

## Rollback

This release does not expose a dedicated Bilibili provider environment switch. Operational rollback options are:

- stop publishing `apps/web-room/dist/` and keep the extension flow
- remove the web origin from `ALLOWED_ORIGINS`
- block `/api/providers/` at the reverse proxy to disable Bilibili authorization and parsing
- block `/proxy/` at the reverse proxy to stop server media proxying
- during multi-node incidents, fall back to single-node or sticky routing and verify Redis runtime state

When proxy cost spikes, inspect proxy byte/request metrics before deciding whether to disable the web Bilibili entry.
