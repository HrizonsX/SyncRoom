# Implementation Notes

## Baseline

- Implementation branch: `codex/add-web-room-bilibili-proxy-playback`
- Baseline branch and PR target: `v1.3.0`
- Current branch head when implementation started: `fbfa3f9244607af73ef31d872cb7458302d41f5e`
- `v1.3.0` was verified as an ancestor of the implementation branch.

## SyncTV Reference Pins

- SyncTV repository: `synctv-org/synctv`
- SyncTV `main` reference commit: `c04106b55a31fff1dc5bb9bc747e79637cfac4bf`
- SyncTV latest release tag checked for context: `v0.9.15` at `ff29d6ef8bbaae2568807e9ae425ae6d3b3cf60a`
- SyncTV vendors repository: `synctv-org/vendors`
- SyncTV vendors `main` reference commit: `2b77d56e38e089af556ddae0d21aafc803b886ea`

These commits are reference points only. SyncRoom implementation must keep its own protocol, room/session, provider, auth-session, proxy, and UI boundaries.

## Current SyncRoom Boundaries Read Before Implementation

- Protocol contracts and guards:
  - `packages/protocol/src/types/client-message.ts`
  - `packages/protocol/src/types/server-message.ts`
  - `packages/protocol/src/types/domain.ts`
  - `packages/protocol/src/guards/client-message.ts`
  - `packages/protocol/src/guards/server-message.ts`
  - `packages/protocol/src/index.ts`
- Room/session and WebSocket flow:
  - `server/src/message-handler.ts`
  - `server/src/app.ts`
  - `server/src/room-service.ts`
  - `server/src/room-store.ts`
  - `server/src/room-event-bus.ts`
  - `server/src/types.ts`
- LiveKit voice boundary:
  - `server/src/voice-service.ts`
  - `server/src/config/voice-config.ts`
  - `extension/src/voice/livekit-voice-runtime.ts`
- Announcement/settings/admin/metrics:
  - `server/src/announcement-store.ts`
  - `server/src/admin-panel.ts`
  - `server/src/admin/metrics.ts`
  - `server/admin-ui/page-renderers.js`
  - `server/admin-ui/render-utils.js`
  - `server/src/config/*`
- Popup visual source:
  - `extension/public/popup.css`
  - `extension/src/popup/popup-template.ts`
  - `extension/src/popup/popup-render.ts`

## Config Name Decisions

- `WEB_ROOM_ENABLED`: controls whether the server exposes the web room client entry/static assets when that hosting mode is enabled.
- `BILIBILI_PROVIDER_ENABLED`: controls whether the Bilibili provider HTTP/auth/parse routes are available.
- `PLAYBACK_PROXY_ENABLED`: controls whether server-side manifest and segment proxy endpoints are available.
- `VIDEO_AUTH_OWNER_OFFLINE_TTL_MS`: controls temporary provider authorization cleanup after the host is offline. Default: `600000` ms (10 minutes).
