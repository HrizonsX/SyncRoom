## ADDED Requirements

### Requirement: Web room app workspace

The system SHALL add a standalone web room client under `apps/web-room/` and include it in workspace-level build, typecheck, lint, and test workflows without placing web UI source under `extension/` or mixing it into server route/controller code.

#### Scenario: Workspace web room build

- **WHEN** maintainers run the root build and typecheck workflows
- **THEN** the web room app is included as its own workspace package while existing `packages/protocol`, `server`, and `extension` workflows continue to run

#### Scenario: No extension UI mixing

- **WHEN** developers inspect the web room source
- **THEN** room page UI, player UI, chat UI, Bilibili auth UI, and web room theme files are located under `apps/web-room/`

### Requirement: Usable room-first interface

The web room client SHALL open to a usable room entry or room viewing interface and MUST NOT present a marketing hero page, landing page, or unrelated brand redesign as the primary first screen.

#### Scenario: First viewport is room workflow

- **WHEN** a user opens the web room app without an active room
- **THEN** the first viewport presents create/join room controls and server connection state

#### Scenario: Joined room first viewport

- **WHEN** a user has joined a room
- **THEN** the first viewport presents the player, room state, members, chat, voice, and host controls rather than marketing content

### Requirement: Supplied room screen layout

The web room client SHALL implement the joined-room desktop layout according to `openspec/changes/add-web-room-bilibili-proxy-playback/assets/web-room-ui-layout.png`: a full-width announcement bar at the top, a secondary header row with the current video title on the left and authorization management on the right, a main content row with the player as the dominant left area and the chat room as the right side area, and a bottom row split between room information/member list and room settings panels.

#### Scenario: Desktop room layout

- **WHEN** the joined-room page is rendered on a desktop-width viewport
- **THEN** the announcement spans the full room width, the video title remains visible above the player, authorization management is placed at the upper right, the player occupies the primary left area, chat occupies the right side area, and room information plus room settings are shown in two bottom panels

#### Scenario: Host authorization entry

- **WHEN** the current member is the room host
- **THEN** the authorization management entry opens the host-only Bilibili authorization and provider controls without moving the player or chat layout

#### Scenario: Non-host authorization visibility

- **WHEN** the current member is not the room host
- **THEN** the authorization area shows only member-safe status or a disabled/non-host state and never exposes credential controls or provider secrets

#### Scenario: Narrow viewport layout

- **WHEN** the viewport cannot support the desktop two-column room layout
- **THEN** the web room stacks the same regions in priority order: announcement, video title and authorization/status row, player, chat, room information/member list, and room settings, while preserving stable player aspect ratio and preventing text or controls from overlapping

### Requirement: Reuse existing room session flow

The web room client SHALL create, join, leave, and recover rooms through the existing SyncRoom room WebSocket/session/memberToken flow, including current room owner recognition and room state updates.

#### Scenario: Host creates web room

- **WHEN** a web user creates a room
- **THEN** the server returns the existing room code, join token, member id, member token, and room state contracts used by SyncRoom rooms

#### Scenario: Member joins web room

- **WHEN** a web user joins with a room code and join token
- **THEN** the user becomes a room member using the existing session/memberToken model and receives current room state

#### Scenario: Existing extension still joins

- **WHEN** an extension client joins a room after this change
- **THEN** the existing extension room flow continues to work without requiring web-only messages

### Requirement: Shaka playback adapter

The web room client SHALL use a unified playback adapter that selects Shaka Player for DASH/MPD and HLS/m3u8, supports MP4 through the same adapter boundary, excludes FLV/HTTP-FLV in the first release, and treats H.265/HEVC as optional with a fallback path.

#### Scenario: DASH source playback

- **WHEN** the current room video descriptor has type `mpd` or DASH metadata
- **THEN** the web player loads the source through Shaka Player

#### Scenario: HLS source playback

- **WHEN** the current room video descriptor has type `m3u8` or HLS metadata
- **THEN** the web player loads the source through Shaka Player

#### Scenario: Unsupported FLV source

- **WHEN** a provider returns FLV or HTTP-FLV as the only available source
- **THEN** the web room displays an unsupported-source error and does not try to use h265web.js or LiveKit as a workaround

#### Scenario: Decode failure

- **WHEN** the browser cannot decode a selected source such as HEVC
- **THEN** the web player reports a `decode` startup failure stage and offers the available fallback source or a clear error

### Requirement: Playback sync compatibility

The web room client SHALL reuse the existing playback synchronization protocol for play, pause, seek, rate changes, current video sharing, and room state reconciliation.

#### Scenario: Host starts proxied video

- **WHEN** the room host selects a Bilibili item with `proxy=true`
- **THEN** the web client shares a structured room video descriptor and initializes playback sync from the selected item

#### Scenario: Member follows playback

- **WHEN** another member receives room playback state
- **THEN** the web client applies current time, play state, playback rate, and explicit sync intent using the existing room playback model

#### Scenario: Extension receives compatible state

- **WHEN** an extension client receives room state for a web-originated video
- **THEN** the shared protocol keeps extension behavior safe by preserving required existing fields and ignoring unknown web-only metadata

### Requirement: LiveKit voice reuse

The web room client SHALL reuse the existing LiveKit voice access and voice state contracts and MUST NOT use LiveKit to distribute the shared video stream.

#### Scenario: Web voice access

- **WHEN** a joined web room member starts voice
- **THEN** the web client requests voice access using the existing room member token and receives server-issued LiveKit details

#### Scenario: Main video is not LiveKit

- **WHEN** a proxied Bilibili video is played
- **THEN** the video is loaded by the URL playback adapter and no shared video track is published through LiveKit

### Requirement: SyncRoom visual consistency

The web room client SHALL extract visual conventions from the extension popup styles and apply matching colors, spacing, controls, radius, shadows, typography, status colors, loading states, and error states.

#### Scenario: Theme extraction

- **WHEN** the web room theme is implemented
- **THEN** it reuses or derives tokens from the extension popup styles rather than using a third-party component library default theme

#### Scenario: Visual QA

- **WHEN** implementation is ready for review
- **THEN** browser screenshots compare the web room with the existing popup and show no obvious visual split

### Requirement: Announcements settings and logs

The web room client SHALL expose room announcements, server/settings entry points, and a user-visible log or diagnostics area by reusing existing server capabilities where available.

#### Scenario: Announcement display

- **WHEN** the server has active announcements
- **THEN** the web room displays them using the same announcement source as existing clients

#### Scenario: Settings and logs access

- **WHEN** a user opens advanced controls
- **THEN** the web room provides server/settings controls and a local diagnostics log without exposing sensitive provider credentials
