# Web Room Feature Structure Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Reorganize `apps/web-room` source and tests by feature while preserving current behavior.

**Architecture:** Keep `apps/web-room/src/index.ts` as the browser entry point and keep `styles.css` at the source root because the build script copies it directly. Move room orchestration, playback, provider, voice, chat, danmaku, and UI rendering helpers into feature folders with matching test folders. Avoid changing server, extension, or protocol behavior in this pass.

**Tech Stack:** TypeScript, NodeNext modules, media-chrome, Shaka Player, mpegts.js, `tsx --test`, `tsc`.

---

### Task 1: Move Files By Feature

**Files:**

- Move `apps/web-room/src/*.ts` into feature folders except `index.ts` and `styles.css`.
- Move matching `apps/web-room/test/*.test.ts` into feature folders.

- [x] Create `room`, `playback`, `providers`, `voice`, `chat`, `danmaku`, and `ui` folders under both `src` and `test`.
- [x] Move files without editing behavior.
- [x] Keep `apps/web-room/src/index.ts` and `apps/web-room/src/styles.css` in place.

### Task 2: Repair Imports

**Files:**

- Modify all moved `apps/web-room/src/**/*.ts` imports.
- Modify all moved `apps/web-room/test/**/*.test.ts` imports.

- [x] Update relative imports so each file resolves from its new folder.
- [x] Preserve all public function and type names.
- [x] Run `npm run typecheck -w @syncroom/web-room` and fix module resolution errors.

### Task 3: Keep Entry Point Thin Enough For This Pass

**Files:**

- Modify `apps/web-room/src/index.ts`.
- Create `apps/web-room/src/ui/dom-event-bindings.ts`.

- [x] Leave dependency wiring and render invocation in `index.ts`.
- [x] Extract only low-risk DOM event delegation and input helpers into `ui/dom-event-bindings.ts`.
- [x] Do not rewrite app-controller or playback behavior.

### Task 4: Verify

**Files:**

- All moved web-room source and test files.

- [x] Run `npm run test -w @syncroom/web-room`.
- [x] Run `npm run typecheck -w @syncroom/web-room`.
- [x] Run `npm run build -w @syncroom/web-room`.
- [x] Run touched-file Prettier check and `git diff --check`.
