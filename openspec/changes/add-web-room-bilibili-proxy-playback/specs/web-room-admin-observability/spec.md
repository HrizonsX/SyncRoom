## ADDED Requirements

### Requirement: Room host visibility

Admin room views SHALL display the current room host identity using existing room owner/member data without exposing member tokens or provider credentials.

#### Scenario: Admin views room owner

- **WHEN** an admin opens a room detail view
- **THEN** the view displays the current host member id/display name where available

### Requirement: Playback startup failure metrics

The system SHALL record low-cardinality playback startup failure counts grouped by stage: manifest, segment, decode, network, and unknown.

#### Scenario: Manifest failure

- **WHEN** a web room player cannot load a manifest
- **THEN** Admin metrics record a manifest-stage playback startup failure

#### Scenario: Decode failure

- **WHEN** a browser cannot decode the selected media
- **THEN** Admin metrics record a decode-stage playback startup failure without collecting high-frequency playback state

### Requirement: Direct-link outcome metrics

The system SHALL record `proxy=false + shared=true` direct-link playback success/failure counts and whether playback falls back to proxy.

#### Scenario: Direct-link success

- **WHEN** a member successfully starts direct-link playback
- **THEN** Admin metrics count a direct-link success for the room/provider

#### Scenario: Direct-link fallback

- **WHEN** direct-link playback fails and the user switches to proxy
- **THEN** Admin metrics count the direct-link failure and proxy fallback

### Requirement: Host operation audit

The system SHALL audit host key operations including selecting video, changing source, and changing proxy/shared switches.

#### Scenario: Host selects video

- **WHEN** the host selects a Bilibili video item for the room
- **THEN** Admin audit records the action with room code, provider, safe item metadata, proxy/shared policy, and actor identity

#### Scenario: Host changes policy

- **WHEN** the host changes proxy/shared policy for a selected item
- **THEN** Admin audit records the policy change without provider credentials

### Requirement: Coarse player error aggregation

Member-side player errors SHALL be aggregated by coarse browser/system/provider/stage labels and MUST NOT report high-frequency playback progress or segment-level details.

#### Scenario: Member reports player error

- **WHEN** a member player reports an error
- **THEN** the server records coarse labels and excludes per-segment URL details, cookies, and high-frequency timeupdate data

### Requirement: Proxy traffic cost aggregation

The system SHALL aggregate proxy traffic and resource cost by room and provider, not by individual segment event records.

#### Scenario: Proxy bytes recorded

- **WHEN** the proxy serves media bytes
- **THEN** metrics aggregate byte counts by room/provider over low-cardinality labels

#### Scenario: Segment detail avoided

- **WHEN** multiple segments are served during playback
- **THEN** Admin event storage is not flooded with one event per segment

### Requirement: Sensitive observability redaction

Admin observability SHALL redact provider credentials, raw cookies, auth headers, and sensitive upstream URLs from all views, metrics, audits, and logs.

#### Scenario: Admin views proxy failure

- **WHEN** an admin inspects a proxy failure
- **THEN** the displayed details contain safe ids, provider, stage, and reason but no raw credential-bearing values
