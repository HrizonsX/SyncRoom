# Web Room Feature Guide

The web room is the standalone static client under `apps/web-room/`. It reuses the syncRoom room protocol and server, but provides a full room workspace outside the browser extension: announcements, player, chat, room info, member list, authorization management, and on-demand parsing.

## When To Use It

- Users want to join from a webpage without installing the extension.
- A room host needs temporary Bilibili authorization to parse DASH/HLS playback sources.
- A room needs text chat, system messages, private room danmaku, and optional voice.
- Operators want to host the web entry separately from the WebSocket/API server.

The web room does not replace the extension. The extension is still best for syncing the video from the current page. The web room is best when users enter a shared room workspace first.

## Rooms And Invites

Room creation generates an invite string in `roomCode:joinToken` format. Other users can paste the whole string into the entry page room-invite field and join directly.

The default web nickname is `网页用户` plus two random uppercase letters. It is stored in the current browser local storage and reused by the same browser.

## Player

The web room uses Shaka Player for DASH/MPD and HLS/m3u8 playback, and Media Chrome for player controls. Controls are still visible before a video is selected, but the timeline is not draggable without a playable source.

Playback source selection:

- DASH/HLS uses Shaka Player.
- MP4 and similar direct links use native `<video>`.
- FLV is not supported in the first release.
- Browser-compatible AVC/H.264 candidates are preferred over HEVC candidates.

The video title is shown inside the player controls instead of taking extra space under the announcement bar.

## Bilibili Authorization And Parsing

Authorization lives behind the authorization-management dialog. Bilibili is the only adapted platform in this release. The web UI exposes QR login only.

Only the room host can operate authorization:

- The host can start QR authorization, inspect safe authorization state, log out, and parse links.
- Members only see member-safe status and cannot operate host authorization.
- Cookies, CSRF values, SESSDATA, Authorization headers, and equivalent credentials stay in temporary server-side state and are never sent to room members.

Parsing converts Bilibili page links into playable candidates. Before playback starts, the host can choose quality and the `proxy` / `shared` policy.

## proxy And shared

`proxy` and `shared` are independent policies:

| Policy         | Meaning                                                                                                                    |
| -------------- | -------------------------------------------------------------------------------------------------------------------------- |
| `proxy=true`   | The server parses with host temporary authorization and proxies media manifest/segments through syncRoom `/proxy/*` URLs   |
| `proxy=false`  | Member browsers load provider direct links, which may fail because of CORS, Referer, IP binding, expiry, or decode support |
| `shared=true`  | Parsing may use host authorization, useful for member-only or login-required content                                       |
| `shared=false` | Parsing uses anonymous/no-cookie capability, so member-only content may downgrade or fail                                  |

The recommended first-release path is `proxy=true + shared=true`. Direct-link failures are shown in the room settings area, not inside the player layout, and the host can switch back to proxy playback.

## Chat, System Messages, And Danmaku

The web room has three real-time message types:

- Text chat: group-chat bubbles with sender and time.
- System messages: centered chronological messages for join, leave, mic on, and mic off events.
- Private room danmaku: sent from the player control bar and rendered once over the room player.

Chat and danmaku are not persisted. Refreshing the page, restarting the server, or rejoining the room is not expected to restore old messages.

Danmaku follows playback pause and resume. Pausing stops the animation, and already rendered danmaku does not replay after pause or resume.

## Voice

The web room reuses syncRoom's LiveKit voice flow. The voice entry is the microphone icon next to the chat send button.

- Members start muted.
- Clicking the microphone requests `voice:access` from the server and then connects to LiveKit.
- Mic on and mic off events create centered system chat messages.
- Voice-service errors disappear after 3 seconds.

LiveKit carries voice only. Main video is loaded by Shaka Player or native `<video>` from a URL.

## State And Persistence Boundaries

- Chat and danmaku: session scoped, not persisted.
- Bilibili authorization: temporary server-side state, not durable room storage.
- Web-room rejoin state: only safe room code, member token, server URL, and similar fields are stored.
- Host authorization is cleared when the host leaves, the room is destroyed, the server restarts, or the host is offline past the server TTL.

## Related Docs

- [Web room Bilibili proxy playback operations](../operations/web-room-bilibili-proxy.md)
- [Server and deployment operations](../operations/server-operations.md)
- [LiveKit voice operations](../operations/livekit-voice-chat.md)
- [Privacy policy](../legal/privacy.md)
