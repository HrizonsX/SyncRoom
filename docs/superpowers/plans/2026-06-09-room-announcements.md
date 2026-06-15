# Room Announcements Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add compact room-adjacent announcements that admins can maintain, clients can cache locally, and the server can push over the existing WebSocket connection.

**Architecture:** Announcements stay outside `RoomState`: the server exposes HTTP read/admin write APIs and pushes `announcement:update` messages to existing WebSocket clients. The extension background owns fetching, storage, and message handling; popup rendering only consumes background state.

**Tech Stack:** TypeScript protocol/server/extension packages, Node HTTP routes, existing `ws` connection, `chrome.storage.local`, static admin UI JavaScript/CSS.

---

### Task 1: Protocol Types And Guards

**Files:**

- Modify: `packages/protocol/src/types/domain.ts`
- Modify: `packages/protocol/src/types/server-message.ts`
- Modify: `packages/protocol/src/guards/server-message.ts`
- Test: `packages/protocol/test/server-message.test.ts`

- [ ] Add `AnnouncementItem` and `AnnouncementState` domain types.
- [ ] Add `announcement:update` to `ServerMessage`.
- [ ] Write failing protocol guard tests for a valid update and invalid item fields.
- [ ] Implement bounded string and array validation.
- [ ] Run `npm run --ignore-scripts test -w @syncroom/protocol`.

### Task 2: Server Announcement Store, Read API, And Push

**Files:**

- Create: `server/src/announcement-store.ts`
- Modify: `server/src/bootstrap/admin-services.ts`
- Modify: `server/src/bootstrap/admin-http-bootstrap.ts`
- Modify: `server/src/app.ts`
- Modify: `server/src/global-admin-app.ts`
- Modify: `server/src/admin/router-types.ts`
- Modify: `server/src/admin/routes/read-routes.ts`
- Modify: `server/src/admin/routes/action-routes.ts`
- Test: `server/test/admin-backend.test.ts`

- [ ] Write failing backend tests for `GET /api/announcements`, admin `GET /api/admin/announcements`, and admin `PUT /api/admin/announcements`.
- [ ] Write a failing WebSocket test proving admin updates push `announcement:update` to an already connected client.
- [ ] Implement an in-memory announcement store with versioned state and bounded input normalization.
- [ ] Wire public read and admin write routes through existing admin router helpers.
- [ ] Broadcast updates by iterating local cluster sessions with attached sockets, using existing `send`.
- [ ] Run focused server tests.

### Task 3: Extension Announcement Cache And Background State

**Files:**

- Create: `extension/src/background/announcement-controller.ts`
- Modify: `extension/src/background/runtime-state.ts`
- Modify: `extension/src/background/storage-manager.ts`
- Modify: `extension/src/background/server-message-controller.ts`
- Modify: `extension/src/background/popup-bus.ts`
- Modify: `extension/src/background/index.ts`
- Modify: `extension/src/shared/messages.ts`
- Test: `extension/test/storage-manager.test.ts`
- Test: `extension/test/server-message-controller.test.ts`
- Test: `extension/test/popup-store.test.ts` or `extension/test/popup-render.test.ts`

- [ ] Write failing tests that load cached announcements from `chrome.storage.local`.
- [ ] Write failing tests that `announcement:update` updates runtime state and triggers notify without touching room state.
- [ ] Implement HTTP fetch URL derivation from `ws://` or `wss://`, one-shot refresh, and local cache persistence.
- [ ] Ensure fetch failure leaves cached announcements intact and does not mark the socket unhealthy.
- [ ] Run focused extension tests.

### Task 4: Popup Announcement UI

**Files:**

- Modify: `extension/src/popup/popup-template.ts`
- Modify: `extension/src/popup/popup-view.ts`
- Modify: `extension/src/popup/popup-render.ts`
- Modify: `extension/public/popup.css`
- Modify: `extension/src/shared/i18n.ts`
- Test: `extension/test/popup-template.test.ts`
- Test: `extension/test/popup-render.test.ts`
- Test: `extension/test/popup-css.test.ts`

- [ ] Write failing tests that the announcement region exists above joined/idle room panels.
- [ ] Write failing render tests for hidden empty state and visible first announcement.
- [ ] Add compact styling using existing popup palette and fixed height to prevent layout shift.
- [ ] Add CSS animation for horizontal marquee and no-JS loop support.
- [ ] Run focused popup tests.

### Task 5: Admin UI Maintenance Page

**Files:**

- Modify: `server/admin-ui/state.js`
- Modify: `server/admin-ui/api.js`
- Modify: `server/admin-ui/app-runtime.js`
- Modify: `server/admin-ui/page-renderers.js`
- Modify: `server/admin-ui/styles.css`
- Modify: `server/admin-ui/demo-data.js`
- Test: `server/test/admin-ui-page-renderers.test.ts`

- [ ] Write failing page-renderer tests for the announcement maintenance form.
- [ ] Add `/announcements` nav route and API calls.
- [ ] Render editable announcement rows with add/remove/save actions for operator/admin users.
- [ ] Keep viewer role read-only.
- [ ] Run focused admin UI tests.

### Task 6: Verification

- [ ] Run `npm run format:check`.
- [ ] Run `npm run lint`.
- [ ] Run `npm run typecheck`.
- [ ] Run `npm run build`.
- [ ] Run `npm test`.
