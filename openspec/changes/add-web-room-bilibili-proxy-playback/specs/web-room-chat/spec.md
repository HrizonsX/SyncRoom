## ADDED Requirements

### Requirement: Room-scoped text chat

The system SHALL add room-scoped text chat for the web room using the existing room WebSocket/session channel unless a future explicit decision creates a separate namespace.

#### Scenario: Member sends chat message

- **WHEN** a joined web room member sends a valid chat message
- **THEN** the server validates the member token and broadcasts the message to attached sessions in the same room

#### Scenario: Non-member sends chat message

- **WHEN** a session that is not joined to the target room sends a chat message
- **THEN** the server rejects the message without broadcasting it

### Requirement: Chat message fields

Chat messages SHALL include room id or room code, sender session/member id, display name or anonymous name, text content, and server timestamp in the shared protocol contract.

#### Scenario: Broadcast message shape

- **WHEN** the server broadcasts a chat message
- **THEN** recipients receive the sender identity, display name, content, timestamp, and room identifier needed for rendering

### Requirement: Non-persistent chat lifecycle

The system SHALL NOT persist chat messages to a database or durable room store, and the web client SHALL only keep messages for the current page lifecycle unless a later feature adds explicit history.

#### Scenario: Page refresh loses chat

- **WHEN** a user refreshes the web room page
- **THEN** prior chat messages are not required to be restored

#### Scenario: Server restart loses chat

- **WHEN** the SyncRoom server restarts
- **THEN** any in-memory chat history is lost and no durable chat records are read back

### Requirement: Chat XSS protection

The web room client SHALL render chat content as text or escaped content, and the server SHALL enforce message length limits before broadcasting.

#### Scenario: HTML input is displayed safely

- **WHEN** a member sends `<img src=x onerror=alert(1)>`
- **THEN** recipients see text content rather than executable HTML

#### Scenario: Overlong message

- **WHEN** a member sends a message longer than the configured maximum length
- **THEN** the server rejects the message and the client displays a clear validation error

### Requirement: Session-level chat rate limit

The system SHALL enforce a 5-second-per-message session-level chat rate limit on the server, and the web client SHALL disable sending or show a countdown until the limit resets.

#### Scenario: Client countdown

- **WHEN** a member sends a chat message
- **THEN** the web client prevents another send until the 5-second countdown has ended

#### Scenario: Server rate limit

- **WHEN** a session sends a second chat message before 5 seconds elapse
- **THEN** the server rejects it with a rate-limited error and does not broadcast it

#### Scenario: Reconnect resets session limit

- **WHEN** a user reconnects with a new WebSocket session
- **THEN** the session-level chat rate limit may start fresh for the new session
