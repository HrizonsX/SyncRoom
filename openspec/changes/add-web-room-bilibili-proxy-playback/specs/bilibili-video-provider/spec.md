## ADDED Requirements

### Requirement: Provider adapter boundary

The system SHALL define a video-site provider adapter interface and implement Bilibili as the first provider without leaking Bilibili API response shapes into core room, proxy, or web UI models.

#### Scenario: Provider parse result

- **WHEN** Bilibili parsing succeeds
- **THEN** the adapter returns a normalized provider video descriptor with provider id, source id, title, selectable items, playback candidates, and required playback policy metadata

#### Scenario: Future provider extension

- **WHEN** a future provider is added
- **THEN** it can implement the adapter interface without changing Bilibili-specific code paths

### Requirement: Bilibili URL matching

The Bilibili provider SHALL match and classify BV, av, bangumi ep, bangumi ss, live room, and b23.tv short links.

#### Scenario: BV URL match

- **WHEN** the provider receives `https://www.bilibili.com/video/BV...`
- **THEN** it classifies the input as a normal Bilibili video

#### Scenario: av URL match

- **WHEN** the provider receives an `av...` Bilibili identifier or URL
- **THEN** it classifies the input as a normal Bilibili video

#### Scenario: Bangumi ep match

- **WHEN** the provider receives `https://www.bilibili.com/bangumi/play/ep...`
- **THEN** it classifies the input as a PGC episode target

#### Scenario: Bangumi ss match

- **WHEN** the provider receives `https://www.bilibili.com/bangumi/play/ss...`
- **THEN** it classifies the input as a PGC season target

#### Scenario: Live room match

- **WHEN** the provider receives `https://live.bilibili.com/{roomId}`
- **THEN** it classifies the input as a live room target

#### Scenario: b23 short link match

- **WHEN** the provider receives a `b23.tv/...` short link
- **THEN** it resolves the short link before final target classification

### Requirement: Bilibili QR and SMS login

The Bilibili provider SHALL support both QR-code login and SMS login in the first release, storing only the temporary credential material required for server-side Bilibili API requests.

#### Scenario: QR login success

- **WHEN** the host completes Bilibili QR-code login
- **THEN** the provider obtains the required temporary credential and updates the room authorization state

#### Scenario: SMS login success

- **WHEN** the host completes the Bilibili SMS login flow
- **THEN** the provider obtains the required temporary credential and updates the room authorization state

#### Scenario: Login failure

- **WHEN** QR or SMS login expires, is cancelled, or is rejected by Bilibili
- **THEN** the host sees a clear provider login error and no credential is stored

### Requirement: Normal video parsing

The Bilibili provider SHALL parse normal Bilibili videos into aid/bvid/cid and selectable part information using server-side Bilibili API requests.

#### Scenario: Single-part video

- **WHEN** the host parses a single-part Bilibili video
- **THEN** the provider returns one selectable video item with normalized playback metadata

#### Scenario: Multi-part video

- **WHEN** the host parses a multi-part Bilibili video
- **THEN** the provider returns selectable part entries so the host can choose which part to share

### Requirement: PGC parsing

The Bilibili provider SHALL parse PGC episode and season URLs into selectable episode entries and playback metadata.

#### Scenario: Episode URL

- **WHEN** the host parses a bangumi `ep...` URL
- **THEN** the provider returns the corresponding episode and available playback metadata

#### Scenario: Season URL

- **WHEN** the host parses a bangumi `ss...` URL
- **THEN** the provider returns selectable episodes for the season when available

### Requirement: Live room parsing

The Bilibili provider SHALL parse live room URLs into a real HLS/m3u8 playback source descriptor and MUST NOT pass the live room page URL directly to Shaka.

#### Scenario: Live room URL

- **WHEN** the host parses a Bilibili live room URL
- **THEN** the provider resolves the real live stream source and returns an HLS/m3u8 descriptor

### Requirement: Server-side sensitive API access

The Bilibili provider SHALL perform sensitive Bilibili API calls server-side with the room host's temporary authorization, required buvid/WBI/signature data, browser-like User-Agent, and Referer as needed.

#### Scenario: Authorized API request

- **WHEN** the provider requests member-only playback metadata
- **THEN** the server uses the host's temporary authorization and required headers without exposing them to the web client or room members

#### Scenario: Client sensitive API prohibition

- **WHEN** the web client needs Bilibili parse or playback metadata
- **THEN** it calls SyncRoom server APIs and does not directly call Bilibili sensitive APIs from the browser

### Requirement: Codec preference and fallback metadata

The Bilibili provider SHALL prefer H.264/AVC-compatible sources for default playback when available and preserve optional HEVC source metadata for fallback or user-visible source selection.

#### Scenario: H264 and HEVC available

- **WHEN** both H.264 and HEVC sources are available
- **THEN** the provider marks H.264 as the default compatible candidate and keeps HEVC as optional metadata
