# AGENTS

## Purpose

- This file is for AI agents, coding assistants, and repository automations working in this codebase.
- Human contribution rules live in [CONTRIBUTING.md](./CONTRIBUTING.md). This file only adds agent-specific execution constraints and decision rules.

## Language Rules

- Agents must respond in Chinese throughout the entire interaction unless the user explicitly requests another language.

## Project Overview

syncRoom is a monorepo for synchronized web video playback across multiple users. It supports Bilibili-specific pages and generic pages that expose a standard HTML5 `<video>` element. It consists of:

- **`packages/protocol/`** — Shared TypeScript types, type guards, and URL normalization utilities
- **`extension/`** — Chrome/Edge browser extension (service worker + content scripts + popup)
- **`server/`** — Node.js WebSocket server with admin panel

## Commands

```bash
# Install dependencies
npm install

# Build all packages (protocol → server + extension, in dependency order)
npm run build

# Development server (watch mode)
npm run dev:server

# Build extension only (Chrome/Edge → extension/dist)
npm run build:extension

# Build the Firefox target (event-page background → extension/dist-firefox)
npm run build:extension:firefox

# Code quality checks
npm run lint
npm run lint:fix
npm run format:check
npm run typecheck

# Testing
npm test
npm run coverage

# Release
npm run build:release          # Package Chrome + Firefox (zip + xpi)
npm run build:release:chrome   # Chrome/Edge zip only
npm run build:release:firefox  # Firefox zip + xpi only
npm run release:version        # Bump version numbers
```

**Before every commit**, run in order:

```bash
npm run format:check && npm run lint && npm run typecheck && npm run build && npm test
```

## Architecture

### Data Flow

1. Content script detects supported video playback changes
2. Sends to background service worker via `chrome.runtime.sendMessage`
3. Background worker validates, updates room state, forwards to WebSocket server
4. Server broadcasts to all room members
5. Other clients receive the message and apply playback state to their video player

### Key Extension Controllers (`extension/src/background/`)

| Controller                   | Responsibility                                                |
| ---------------------------- | ------------------------------------------------------------- |
| `socket-controller.ts`       | WebSocket connection, reconnection, health checks             |
| `room-session-controller.ts` | Room create/join/leave/state                                  |
| `share-controller.ts`        | Shared video and pending local shares                         |
| `clock-controller.ts`        | NTP-style clock offset for playback sync                      |
| `tab-controller.ts`          | Supported video tab tracking, shared vs. local page switching |
| `message-controller.ts`      | Routes popup/content messages to handlers                     |

The `background/index.ts` entry file only bootstraps and wires controllers — keep it thin.

### Web Room (`apps/web-room/src/`)

- `index.ts` is the browser entry point and should stay limited to bootstrap, render wiring, and dependency assembly.
- `room/` owns room orchestration, WebSocket/session persistence, member permissions, room-state adaptation, invite actions, and browser-local web-room preferences. Keep `room/app-controller.ts` focused on orchestration; keep entry-page state helpers in `room/entry-state.ts`, page/server URL normalization in `room/server-url.ts`, chat history/system-message helpers in `room/chat-state.ts`, pure room-state adaptation in `room/state.ts`, and browser-local identity/theme persistence in `room/web-room-preferences.ts`.
- `playback/` owns media engine selection, playback element reuse, playback sync controls, buffer reporting, keyboard shortcuts, fullscreen target wiring, and playback error mapping. Keep engine-specific details in focused modules such as `shaka-engine.ts`, `mpegts-engine.ts`, and `native-engine.ts`; keep source loading and element reuse in `playback-element-controller.ts`; keep autoplay/play-retry recovery in `playback-play-retry.ts`; keep `playback-controller.ts` focused on orchestration.
- `providers/` owns provider API transport, provider host routing, provider authorization copy, and provider-facing metadata. Add new platform routing and copy in `providers/provider-metadata.ts`; keep HTTP/API calls in `providers/provider-api-client.ts`.
- `ui/` owns render-only HTML generation, DOM event delegation, disclosure state, and theme tokens. Keep product state changes out of `ui/render.ts`; keep render-facing state types in `ui/render-types.ts`; route user events through `ui/dom-event-bindings.ts` into the room controller.
- `chat/`, `danmaku/`, and `voice/` own their feature-specific browser state and runtime helpers. Cross-render preservation for chat drafts, chat scroll, danmaku animation, and voice runtime behavior should stay in those feature folders.
- `styles.css` intentionally remains at `apps/web-room/src/styles.css` because the web-room build script copies it as a static asset.
- `apps/web-room/test/` mirrors the same feature folders so tests live next to the feature boundary they protect.

### Server (`server/src/`)

- `app.ts` — HTTP/WebSocket setup and message routing
- `config/` — Centralized environment parsing (`ALLOWED_ORIGINS`, `PORT`, `REDIS_URL`)
- `admin/` — Admin panel, command bus, event store, session management

Optional Redis support enables multi-node deployments.

### Protocol Package (`packages/protocol/`)

Single source of truth for `ClientMessage`, `ServerMessage`, domain types (`RoomState`, `SharedVideo`, `PlaybackState`, `RoomMember`), type guards, and URL normalization. Always export through the package root to preserve import stability.

## Structural Constraints

- `index.ts` files: bootstrap and wiring only; extract logic to controllers/helpers/stores.
- Do not combine templates, DOM updates, business rules, and message dispatch in one file.
- Separate popup rendering, actions, and state management.
- When refactoring a large feature, split it into cohesive components that jointly implement the larger behavior. Each component should own a closed set of state and rules, expose an explicit interface, and avoid reaching into another component's internals.
- Prefer practical abstractions that match current behavior and credible near-term extensions. Do not create generic frameworks without an immediate maintenance benefit.
- URL normalization must stay centralized (`normalizeSharedVideoUrl`).
- Protocol types/guards must stay in `@syncroom/protocol`.
- Server env parsing must stay in the server config layer.

## Engineering Constraints

- Repository-wide contribution and refactoring constraints are defined in [CONTRIBUTING.md](./CONTRIBUTING.md).
- When working on structural changes, follow `CONTRIBUTING.md` as the primary source of truth for workflow, module boundary, shared source, and regression test expectations.
- Add code comments for important or non-obvious logic during refactors. Comments should explain why the logic exists, what boundary or invariant it protects, or what regression it prevents; avoid line-by-line comments that merely restate the code.
- Before extracting an abstraction, identify the concrete responsibility it owns, the inputs and outputs it exchanges with neighboring modules, and the tests that prove the behavior stayed intact.

## Git Constraints

- ALWAYS create a feature branch before making changes; NEVER push directly to `main`.
- Do not rewrite published history unless explicitly requested by the repository maintainer.
- Before every `git push`, run `npm run format:check` and the full pre-commit check sequence to avoid CI failures.
- Before committing changes, run `npm run format:check`, `npm run lint`, `npm run typecheck`, `npm run build`, and `npm test`.
- Keep formatting-only changes separate from behavior changes whenever practical.
- Do not mix unrelated refactors, docs updates, and feature or bug-fix changes in a single commit when they can be reviewed independently.
- Prefer small, reviewable commits that preserve behavior at each step of a refactor.

## Commit Conventions

- Prefer Conventional Commit style prefixes such as `feat:`, `fix:`, `refactor:`, `test:`, `docs:`, `chore:`, and `ci:`.
- Keep the subject line concise and focused on the primary change in that commit.
- A single commit should represent one reviewable unit of change.
- Do not hide behavior changes inside `chore:` or `docs:` commits.
- Use `refactor:` only when behavior is intended to stay unchanged; if behavior changes, use a more accurate prefix.

## Review Feedback Process

- After addressing review feedback, re-verify related code paths for similar issues (e.g., state cleanup, error handling) before declaring the fix complete.
- When addressing Codex/reviewer feedback, audit ALL related code paths for the same class of bug, not just the specific line flagged.
- For state-cleanup/reset functions, grep for every piece of related state and verify each is handled.
- For async Redis/lock operations, always `await` and wrap in try/catch to avoid orphan locks or race conditions.

## Testing Focus

Refactors touching these areas require regression coverage:

- Extension sync flow
- Popup state and rendering flow
- Server config loading
- Protocol validation (type guards)
- Server room lifecycle and admin routing
- Web-room media-chrome playback sync changes must cover control-bar requests, video-surface requests, keyboard seeks, rapid opposite toggles, new-member/refresh hydration, and delayed native media play/pause/seek/rate echoes; only semantic request events are authoritative user intent, while native hydration echoes must remain non-explicit.
- Web-room VOD playback revisions are command boundaries: member, chat, permission, and buffer-only `room:state` updates must not re-project and re-seek the same playback revision. Regression tests must prove that a new playback revision still applies.
- Web-room wait-mode changes must cover false `waiting` events with sufficient buffer, player-chrome rerenders without buffer-reporter resets, frozen playback timeline rebasing on hold/release, no-op buffer reports without room broadcasts, strategy changes, and buffering-member departure.
- Provider parse and picker-error changes must cover unsupported URLs, no playable candidates, auth-required responses, transport/non-JSON failures, and must not leak raw backend or English provider errors into user-facing picker copy.

## Agent Execution Rules

- Do not perform destructive git operations such as `git reset --hard`, force-pushes, or overwriting unrelated uncommitted user changes unless explicitly requested.
- Do not change secrets, `.env` files, release credentials, or production deployment settings unless explicitly requested.
- Do not update versions, lockfiles, or release artifacts unless the task clearly requires it.
- Prefer the smallest relevant verification command first; if validation was not run, say so explicitly.
- Do not claim a change was verified if the relevant checks were not actually run.
- Keep changes scoped to the task. Avoid opportunistic edits in unrelated files.
- When code changes affect developer workflow, architecture, or shared rules, update the relevant documentation files in the same change.
- When refactors change or invalidate existing documentation, update the affected docs in the same change. Do not add new documentation churn when no old wording exists or the behavior is unchanged.
- When repo-specific agent memory, constraints, or proven workflows should carry into future conversations, update this file with concise reusable rules instead of leaving them only in chat history.
- When reviewing code, report findings first, with concrete file references and impact, before giving summary commentary.
