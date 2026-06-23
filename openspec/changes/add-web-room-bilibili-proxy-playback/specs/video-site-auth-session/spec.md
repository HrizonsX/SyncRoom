## ADDED Requirements

### Requirement: Host-only temporary authorization

The system SHALL allow only the current room host to start, poll, inspect, or clear temporary video-site authorization for a room.

#### Scenario: Host starts authorization

- **WHEN** the current room host starts Bilibili authorization
- **THEN** the server creates a room-scoped temporary authorization flow and returns only non-sensitive flow details to the host

#### Scenario: Member cannot start authorization

- **WHEN** a non-host room member attempts to start authorization
- **THEN** the server rejects the request and does not create or expose any provider auth state

### Requirement: Non-persistent credential storage

The system SHALL store provider credentials only in temporary server-side state and MUST NOT write them to durable room storage, databases, files, logs, Admin payloads, member payloads, or error responses.

#### Scenario: Credential saved temporarily

- **WHEN** Bilibili login succeeds
- **THEN** the server stores the required credential such as SESSDATA only in the temporary authorization store

#### Scenario: API response redaction

- **WHEN** any auth status, parse, playback, error, or Admin API response is returned
- **THEN** it contains no raw Cookie, token, SESSDATA, auth header, or equivalent provider credential

#### Scenario: Log redaction

- **WHEN** provider authorization, parsing, or proxy requests fail
- **THEN** structured logs omit raw credentials and sensitive headers

### Requirement: Authorization owner binding

The temporary authorization state SHALL be bound to room code, provider id, owner member identity, and owner session continuity rather than to a global user account.

#### Scenario: Refresh preserves authorization

- **WHEN** the room host refreshes the web page and rejoins with the same valid owner member identity before the offline TTL expires
- **THEN** the room's temporary Bilibili authorization remains available to the host

#### Scenario: Different host identity cannot reuse authorization

- **WHEN** a different member becomes connected to the room without the original owner identity
- **THEN** the previous owner's provider credentials are not exposed or reused

### Requirement: Authorization cleanup lifecycle

The system SHALL clear temporary provider authorization when the host manually logs out, the host leaves the room, the room is destroyed, the server restarts, or the owner offline TTL expires.

#### Scenario: Manual logout

- **WHEN** the host clicks logout or clear authorization
- **THEN** the temporary provider credential and non-sensitive auth state are removed

#### Scenario: Host leaves room

- **WHEN** the host leaves the room
- **THEN** the room's provider authorization is removed and future provider parses require new authorization

#### Scenario: Room destroyed

- **WHEN** the room is closed, expired, or deleted
- **THEN** all provider authorization state for that room is removed

#### Scenario: Offline TTL expires

- **WHEN** the host is disconnected longer than the configured server-side offline TTL
- **THEN** the provider authorization is removed even if the room still exists

### Requirement: Configurable owner offline TTL

The system SHALL provide a server-side owner offline TTL for temporary provider authorization, with an initial default of 10 minutes.

#### Scenario: Default TTL

- **WHEN** no explicit auth offline TTL is configured
- **THEN** the server uses a 10-minute owner offline TTL for temporary provider authorization

#### Scenario: Configured TTL

- **WHEN** operators configure a supported provider auth offline TTL
- **THEN** the server uses that TTL for host offline cleanup

### Requirement: Non-sensitive auth status

The web room SHALL show only non-sensitive authorization status such as authorized/unauthorized, display name, avatar, and VIP-like status when available.

#### Scenario: Host views me status

- **WHEN** the host opens the Bilibili authorization panel after login
- **THEN** the UI shows non-sensitive profile/status information without raw credentials

#### Scenario: Member views auth status

- **WHEN** a non-host member views room video-site status
- **THEN** the UI only indicates whether host authorization is available for playback and exposes no credential-bearing fields
