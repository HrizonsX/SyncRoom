## 1. Baseline And Research

- [x] 1.1 Confirm the implementation branch is based on `v1.3.0` and the PR target is `v1.3.0`.
- [x] 1.2 Record the exact SyncTV and SyncTV vendors commit/version used as reference for Bilibili QR login, SMS login, URL match, parse, proxy and shared semantics.
- [x] 1.3 Re-read current SyncRoom room, WebSocket/session, LiveKit voice, announcement, settings, admin, metrics, and popup theme code before implementation changes.
- [x] 1.4 Decide and document final config names for web provider enablement and owner offline TTL, with default offline TTL set to 10 minutes.

## 2. Protocol Contracts

- [x] 2.1 Add shared protocol types for provider playback descriptors, provider ids, proxy/shared policy, playback source type, provider item selection, and web player error stages.
- [x] 2.2 Add shared protocol types for `chat:message` client messages and server chat broadcasts.
- [x] 2.3 Add shared error codes for chat rate limit, chat validation failure, provider auth unavailable, provider auth forbidden, provider parse failure, proxy expired, proxy forbidden, direct playback failure, and unsupported source.
- [x] 2.4 Add protocol guards and negative tests for all new chat, provider, proxy/shared, and playback descriptor messages.
- [x] 2.5 Keep existing extension-compatible room state fields backward-compatible and add tests that existing extension message guards still pass.

## 3. Workspace And Web App Shell

- [x] 3.1 Add `apps/web-room/` as a workspace package with build, typecheck, lint, and test scripts wired into the root workflow.
- [x] 3.2 Create the web room app shell with route/state boundaries for entry page, room page, player, members, chat, voice, Bilibili auth, host picker, settings, announcements, and diagnostics log.
- [x] 3.3 Extract a web-room theme from `extension/public/popup.css` and apply matching tokens for colors, controls, spacing, radius, typography, status, loading, and error states.
- [x] 3.4 Ensure the first viewport is a usable room entry or room viewing interface, not a marketing page or hero layout.
- [x] 3.5 Implement the joined-room layout from `openspec/changes/add-web-room-bilibili-proxy-playback/assets/web-room-ui-layout.png`: full-width announcement, video title row, top-right authorization management, dominant player area, right chat area, bottom room info/member list panel, and bottom settings panel.
- [x] 3.6 Add responsive behavior for narrow screens by stacking announcement, title/auth status, player, chat, room info/member list, and settings without overlaps or layout shifts.
- [x] 3.7 Add web app tests for room-first rendering, supplied layout regions, theme token usage, and basic responsive layout constraints.

## 4. Web Room Session Integration

- [x] 4.1 Implement a web room WebSocket client that connects to the existing SyncRoom server URL and sends existing `room:create`, `room:join`, `room:leave`, `sync:request`, and `sync:ping` messages.
- [x] 4.2 Persist only safe web room client state needed for refresh/rejoin, including room code, join token, member token, display name, and server URL.
- [x] 4.3 Render room members, current video, playback state, connection state, announcements, settings entry, and diagnostics log from existing server messages.
- [x] 4.4 Reuse existing LiveKit `voice:access` and `voice:state` contracts for web voice controls, mute/unmute, join/leave, and error states.
- [x] 4.5 Add integration tests or browser smoke coverage for host create room, member web join, leave room, refresh/rejoin, and LiveKit voice unavailable/available states.

## 5. Shaka Player And Playback Sync

- [x] 5.1 Add Shaka Player dependency to `apps/web-room/` and isolate usage behind a playback adapter interface.
- [x] 5.2 Implement playback adapter selection for MPD/DASH, HLS/m3u8, and MP4 while rejecting FLV/HTTP-FLV in the first release.
- [x] 5.3 Wire web player play, pause, seek, rate change, buffering, decode errors, and startup failure stages into existing playback sync messages.
- [x] 5.4 Prefer H.264/AVC-compatible Bilibili sources when available and surface HEVC/decode fallback messages.
- [x] 5.5 Add tests for source-type selection, unsupported source handling, playback state emission, remote playback application, and decode/network/manifest/segment error reporting.

## 6. Chat

- [x] 6.1 Add server-side handling for room chat messages using existing room membership and memberToken validation.
- [x] 6.2 Implement session-level 5-second chat rate limiting and retry/cooldown details for rejected messages.
- [x] 6.3 Broadcast chat messages to local room sessions through the existing room event path without persisting messages to durable room storage.
- [x] 6.4 Render chat messages in the web room as text/escaped content and keep them only for the current page lifecycle.
- [x] 6.5 Add tests for valid broadcast, non-member rejection, overlong rejection, XSS-safe rendering, no durable persistence, client countdown, and server rate limit.

## 7. Temporary Video Auth Session

- [x] 7.1 Implement a `video-auth-session` module with memory storage for room/provider/owner-bound temporary auth state, non-sensitive profile state, TTL, logout, and cleanup hooks.
- [x] 7.2 Add Redis-backed or runtime-store-compatible temporary auth support when multi-node runtime storage is enabled, without writing credentials to persistent room storage.
- [x] 7.3 Enforce host-only access for auth start, poll, me/status, parse-with-auth, and logout.
- [x] 7.4 Preserve host authorization across page refresh/rejoin when the same owner identity returns before offline TTL expiry.
- [x] 7.5 Clear auth state on manual logout, host leave, room destroy/expire/delete, server restart, and owner offline TTL expiry.
- [x] 7.6 Add leak-prevention tests for API responses, room/member payloads, logs, Admin views, and errors.

## 8. Bilibili Provider

- [x] 8.1 Define provider adapter interfaces for URL match, auth start/poll/logout/me, parse, playback candidate generation, and safe error mapping.
- [x] 8.2 Implement Bilibili URL match and normalization for BV, av, bangumi ep, bangumi ss, live room, and b23.tv short links.
- [x] 8.3 Implement Bilibili QR-code login using the temporary auth session store.
- [x] 8.4 Implement Bilibili SMS login using the temporary auth session store, including required captcha or verification states discovered from the pinned SyncTV reference.
- [x] 8.5 Implement non-sensitive Bilibili `me` status with display name, avatar, and VIP-like status when available.
- [x] 8.6 Implement normal video parsing for aid/bvid/cid and part selection.
- [x] 8.7 Implement PGC parsing for ep/ss episode selection.
- [x] 8.8 Implement live room parsing into real HLS/m3u8 playback descriptors.
- [x] 8.9 Perform all sensitive Bilibili API calls server-side with required temporary credentials, buvid/WBI/signature data, User-Agent, and Referer.
- [x] 8.10 Add unit tests for URL match, QR login states, SMS login states, normal video parse, PGC parse, live parse, b23 resolution, credential redaction, and provider error mapping.

## 9. Web Room Bilibili UI

- [x] 9.1 Build the host-only Bilibili authorization panel with QR login, SMS login, status, logout, errors, and loading states.
- [x] 9.2 Build the host picker panel for Bilibili URL input, parse results, part/episode/live selection, source metadata, and proxy/shared switches.
- [x] 9.3 Save selected proxy/shared policy into the shared room video descriptor when the host starts playback.
- [x] 9.4 Show member-safe authorization and playback status to non-host members without exposing credentials.
- [x] 9.5 Add UI tests for host-only controls, QR/SMS states, parse result selection, proxy/shared switch persistence, and non-host visibility.

## 10. Playback Proxy

- [x] 10.1 Implement playback proxy route/controller boundaries separate from Bilibili provider and web-room controllers.
- [x] 10.2 Implement MPD rewrite for `proxy=true`, preserving quality, audio tracks, optional HEVC metadata, and Shaka-compatible URLs.
- [x] 10.3 Implement m3u8 rewrite for `proxy=true`, including Bilibili live HLS playback descriptors.
- [x] 10.4 Implement segment proxy using opaque server-issued ids/tokens and cached adapter-produced resource mappings.
- [x] 10.5 Enforce proxy whitelist, protocol, host, DNS/IP, private/reserved network, and arbitrary URL rejection checks.
- [x] 10.6 Forward required Bilibili Referer/User-Agent and support Range requests and partial responses.
- [x] 10.7 Implement manifest and segment mapping TTL cleanup tied to room/provider auth lifecycle.
- [x] 10.8 Implement `proxy=false + shared=true` direct-link path with clear client error stages and proxy fallback UI.
- [x] 10.9 Implement `shared=false` anonymous/no-cookie parse path with reasonable failure or downgrade messaging.
- [x] 10.10 Add tests for proxy=true MPD/m3u8 URL generation, manifest rewrite, segment proxy, Range, SSRF protection, expired mappings, direct-link branch, shared=false branch, and credential redaction.

## 11. Admin And Metrics

- [x] 11.1 Add current host identity to Admin room views using safe room owner/member fields.
- [x] 11.2 Record playback startup failures grouped by manifest, segment, decode, network, and unknown stages.
- [x] 11.3 Record direct-link playback success/failure and proxy fallback counts for `proxy=false + shared=true`.
- [x] 11.4 Audit host actions for selecting video, changing source, and changing proxy/shared policy.
- [x] 11.5 Aggregate member player errors by coarse browser/system/provider/stage labels without high-frequency playback state.
- [x] 11.6 Aggregate proxy traffic and cost by room/provider without one event per segment in Admin event storage.
- [x] 11.7 Add Admin/metrics tests for all new low-cardinality metrics and redaction behavior.

## 12. Documentation And Operations

- [x] 12.1 Document web-room deployment, server-hosted static assets or chosen deployment mode, and required server URL/origin configuration.
- [x] 12.2 Document Bilibili temporary authorization behavior, QR/SMS login, owner offline TTL default, logout, and cleanup conditions.
- [x] 12.3 Document proxy/shared semantics, proxy bandwidth cost, direct-link risk, fallback behavior, and rollback switches.
- [x] 12.4 Update privacy/security docs to cover temporary provider credentials, chat non-persistence, proxy traffic, and LiveKit voice boundary.

## 13. Verification

- [x] 13.1 Run focused protocol tests for new message/types/guards and extension compatibility.
- [x] 13.2 Run server tests for auth session, Bilibili provider, chat, playback proxy, Admin metrics, and no credential leakage.
- [x] 13.3 Run web-room unit/component tests for room flow, UI, chat, Shaka adapter, Bilibili auth, picker, and error states.
- [ ] 13.4 Run `npm run format:check`.
- [x] 13.5 Run `npm run lint`.
- [x] 13.6 Run `npm run typecheck`.
- [x] 13.7 Run `npm run build`.
- [x] 13.8 Run `npm test`.
- [x] 13.9 Run browser verification with screenshots comparing web-room UI against extension popup styling.
- [ ] 13.10 Manually verify host creates room, member joins web room, host logs into Bilibili by QR and SMS, parses BV video, `proxy=true` plays successfully, live room resolves to m3u8 and plays, direct-link failure shows fallback, chat broadcasts and disappears after refresh, LiveKit voice joins/leaves/mutes, and host logout/leave clears authorization.
