# Server And Deployment Operations

This guide contains the operational details that are intentionally kept out of the root README: local server setup, environment variables, Admin, Redis, multi-node deployment, and production boundaries.

## Runtime Requirements

| Dependency    | Minimum           | Recommended    | Notes                                                                     |
| ------------- | ----------------- | -------------- | ------------------------------------------------------------------------- |
| Node.js       | 18                | 22             | See `.nvmrc`; Node 20 and 22 are supported                                |
| npm           | 8                 | 10             | Installed with Node.js                                                    |
| Chrome / Edge | Current stable    | Current stable | Required for unpacked extension testing                                   |
| Firefox       | 121               | Current stable | Uses the `extension/dist-firefox` event-page build                        |
| Redis         | 6.0               | 7+             | Optional for single-node; required for multi-node and restart persistence |
| Reverse proxy | WebSocket support | Nginx 1.18+    | Used for TLS termination and `wss://` in production                       |

## Local Server

Install and build:

```bash
npm install
npm run build
```

Start the development server:

```powershell
$env:ALLOWED_ORIGINS="chrome-extension://<extension-id>,http://localhost:4173"
npm run dev:server
```

`ALLOWED_ORIGINS` must include the browser Origin that connects to the syncRoom server:

- Chrome / Edge extension: `chrome-extension://<extension-id>`
- Firefox extension: `moz-extension://<uuid>`
- Web room: for example `http://localhost:4173` or `https://room.example.com`

Firefox may generate a different `moz-extension://<uuid>` on every install. Small deployments can allow that exact Origin. Public servers can set `ALLOW_ANY_FIREFOX_EXTENSION_ORIGIN=true` to accept well-formed Firefox extension Origins. This does not allow normal web-page Origins and does not replace room-token authentication.

## Common Environment Variables

| Variable                             | Purpose                                                  |
| ------------------------------------ | -------------------------------------------------------- |
| `PORT`                               | HTTP/WebSocket port for the room server, default `8787`  |
| `ALLOWED_ORIGINS`                    | Comma-separated allowed browser Origins                  |
| `ALLOW_ANY_FIREFOX_EXTENSION_ORIGIN` | Allows any well-formed Firefox extension Origin          |
| `SYNCROOM_CONFIG`                    | Path to a JSON runtime configuration file                |
| `ROOM_STORE_PROVIDER`                | Room store provider, commonly `memory` or `redis`        |
| `RUNTIME_STORE_PROVIDER`             | Runtime index and temporary authorization store provider |
| `REDIS_URL`                          | Redis connection URL                                     |
| `ADMIN_USERNAME`                     | Admin username                                           |
| `ADMIN_PASSWORD_HASH`                | Admin password hash such as `sha256:<hex>`               |
| `ADMIN_SESSION_SECRET`               | Admin session signing secret                             |
| `ADMIN_ROLE`                         | Admin role, for example `admin`                          |
| `ADMIN_UI_DEMO_ENABLED`              | Enables built-in Admin demo data                         |
| `LIVEKIT_URL`                        | LiveKit service URL                                      |
| `LIVEKIT_API_KEY`                    | LiveKit API key                                          |
| `LIVEKIT_API_SECRET`                 | LiveKit API secret                                       |

For exact parsing behavior, see the config files and tests under `server/src/config/`.

## Admin Panel

Single-process local development entry:

```text
http://localhost:8787/admin
```

Dedicated Global Admin or production reverse-proxy entry:

```text
http://localhost:8788/admin
https://admin.example.com/admin
```

Startup example:

```powershell
$env:ADMIN_USERNAME="admin"
$env:ADMIN_PASSWORD_HASH="sha256:<hex-password-hash>"
$env:ADMIN_SESSION_SECRET="<random-secret>"
$env:ADMIN_ROLE="admin"
npm run dev:server
```

Generate a local `sha256:<hex>` password hash:

```powershell
$password = "secret-123"
$bytes = [System.Text.Encoding]::UTF8.GetBytes($password)
$hash = [System.BitConverter]::ToString(
  [System.Security.Cryptography.SHA256]::Create().ComputeHash($bytes)
).Replace("-", "").ToLower()
"sha256:$hash"
```

The current Admin UI covers:

- overview, room list, and room detail
- runtime events, audit logs, and config summary
- IP blacklist and member IP blocking
- close room, clear shared video, kick member, and disconnect session actions
- runtime limits and multi-node runtime visibility

Enable demo data explicitly in non-production environments:

```powershell
$env:ADMIN_UI_DEMO_ENABLED="true"
npm run dev:server
```

When this variable is not enabled, `?demo=1` is ignored.

## Web Room Deployment

The web room is a static app. Build output is written to `apps/web-room/dist/`:

```bash
npm --workspace @syncroom/web-room run build
```

The web-room package does not expose a built-in `dev` or `preview` server script. The Node room server also does not serve these static files directly. Host the web room with a static file server, Nginx, Caddy, object storage, or a CDN, and point the web entry screen to a browser-reachable server URL such as `ws://localhost:8787` for local development or `wss://sync.example.com` in production.

Local static hosting example:

```bash
npx serve apps/web-room/dist -l 4173
```

If the web room and syncRoom server are on different origins, add the web Origin to `ALLOWED_ORIGINS`. See [Web room Bilibili proxy playback operations](./web-room-bilibili-proxy.md) for Bilibili authorization, parsing, and `/proxy/*` deployment details.

## Multi-Node And Redis

Single-node memory mode is suitable for development and lightweight self-hosting. Multi-node deployments require Redis-backed shared state; otherwise, connections on different nodes can see different rooms.

Redis can back:

- room state and lifecycle
- runtime session indexes
- cross-node room event broadcast
- Admin sessions, events, and audit storage
- temporary Bilibili authorization runtime state

See the [multi-node runbook](../runbook/multi-node-operations.zh-CN.md) and [global admin migration guide](./multi-node-global-admin-migration.md) for deployment and reverse-proxy details.

## Non-Goals And Boundaries

- No guaranteed multi-node consistency without Redis.
- No built-in load balancer; production needs an external edge layer for WebSocket distribution.
- Extension room session state is browser-session scoped and must be rejoined after browser restart.
- There is no end-user account system; room access is controlled by `roomCode:joinToken`.
- Browser extension support targets Chrome, Edge, and Firefox 121+; Safari and mobile browsers are out of scope.

## Development And Verification Commands

```bash
npm run lint
npm run format:check
npm run typecheck
npm run build
npm test
```

Other useful commands:

- `npm run lint:fix`: apply safe ESLint fixes.
- `npm run format`: rewrite formatting with Prettier.
- `npm run build:extension`: build the Chrome/Edge extension.
- `npm run build:extension:firefox`: build the Firefox extension.
- `npm run audit`: run the dependency audit gate.
- `npm run test:server:redis`: run Redis regression tests; requires `REDIS_URL`.

See [CONTRIBUTING.md](../../CONTRIBUTING.md) for contribution and commit requirements.
