# Generic Media Extractor Provider Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add a lowest-priority generic provider backed by a separately deployable media extractor service while leaving the tested Bilibili provider path unchanged.

**Architecture:** SyncRoom keeps provider routing, room state, cookie ownership, proxy registration, and playback descriptors. A new Python `media-extractor-service` exposes an internal JSON extraction contract around yt-dlp and returns normalized candidates. The SyncRoom `generic` provider is stateless, has no auth, and calls that service only after higher-priority providers do not match.

**Tech Stack:** TypeScript provider layer, existing `@syncroom/protocol` guards, Node `fetch`, Python stdlib HTTP server, optional `yt-dlp` Python package.

---

### Task 1: Protocol Provider Id

**Files:**

- Modify: `packages/protocol/src/types/domain.ts`
- Test: `packages/protocol/test/web-room-protocol.test.ts`

- [ ] Add `generic` to `VIDEO_PROVIDER_IDS`.
- [ ] Add tests proving provider descriptors and client messages accept `providerId: "generic"`.
- [ ] Run: `npm run --ignore-scripts test -w @syncroom/protocol -- web-room-protocol.test.ts`

### Task 2: Extractor Service Contract

**Files:**

- Create: `services/media-extractor-service/app.py`
- Create: `services/media-extractor-service/requirements.txt`
- Create: `services/media-extractor-service/README.md`
- Create: `services/media-extractor-service/test_app.py`

- [ ] Implement `GET /health` with yt-dlp version metadata.
- [ ] Implement `POST /extract` with JSON input `{ url, platform, headers }`.
- [ ] Normalize yt-dlp info into `{ title, sourceUrl, isLive, candidates }`.
- [ ] Keep cookies/headers request-scoped and never persist them.
- [ ] Run: `python services/media-extractor-service/test_app.py`

### Task 3: SyncRoom Extractor Client

**Files:**

- Create: `server/src/providers/media-extractor-client.ts`
- Test: `server/test/media-extractor-client.test.ts`

- [ ] Add a small typed HTTP client for extractor `/extract`.
- [ ] Validate responses before handing them to provider code.
- [ ] Convert HTTP and validation failures into `VideoProviderError`.
- [ ] Run: `npx tsx --test server/test/media-extractor-client.test.ts`

### Task 4: Generic Provider

**Files:**

- Create: `server/src/providers/generic-provider.ts`
- Modify: `server/src/app.ts`
- Test: `server/test/video-provider.test.ts`

- [ ] Implement `generic` adapter with `createUnavailableProviderAuth("generic")`.
- [ ] Match HTTP/HTTPS URLs that no higher-priority provider matched.
- [ ] Call the extractor client and map candidates to `ProviderParseResult`.
- [ ] Register generic after Bilibili.
- [ ] Run: `npx tsx --test server/test/video-provider.test.ts`

### Task 5: Frontend Provider Routing

**Files:**

- Modify: `apps/web-room/src/provider-api-client.ts`
- Modify: `apps/web-room/src/app-controller.ts`
- Test: `apps/web-room/test/provider-api-client.test.ts`
- Test: `apps/web-room/test/app-controller.test.ts`

- [ ] Route Bilibili URLs to `/api/providers/bilibili/parse`; route all other URLs to `/api/providers/generic/parse`.
- [ ] Keep Bilibili auth UI Bilibili-only.
- [ ] Show generic parse failures without Bilibili-specific shared/auth guidance.
- [ ] Run focused web-room tests for provider parsing.

### Task 6: Verification

**Files:**

- All touched files.

- [ ] Run touched-file Prettier.
- [ ] Run targeted protocol, server, web-room tests.
- [ ] Run `npm run typecheck -w @syncroom/server`.
- [ ] Run `npm run typecheck -w @syncroom/web-room`.
- [ ] Run `npm run build -w @syncroom/server`.
- [ ] Run `npm run build -w @syncroom/web-room`.
- [ ] Run `git diff --check`.
