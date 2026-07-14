import assert from "node:assert/strict";
import test from "node:test";
import {
  acceptInitialRoomStateHydration,
  acceptInitialRoomStateHydrationIfPending,
  beginInitialRoomStateHydration,
  clearPendingHydrationWhenRoomMissing,
  clearRoomHydrationState,
  markHydrationReady,
  recordHydrationResponseMetadata,
} from "../src/content/hydration-runtime-state";
import { createContentRuntimeState } from "../src/content/runtime-state";

test("accepts initial room state hydration as one runtime transition", () => {
  const state = createContentRuntimeState();

  acceptInitialRoomStateHydration(state);

  assert.equal(state.pendingRoomStateHydration, false);
  assert.equal(state.hasReceivedInitialRoomState, true);
  assert.equal(acceptInitialRoomStateHydrationIfPending(state), false);
});

test("begins initial hydration by reopening the pending gate", () => {
  const state = createContentRuntimeState();
  state.pendingRoomStateHydration = false;
  state.hasReceivedInitialRoomState = true;

  beginInitialRoomStateHydration(state);

  assert.equal(state.pendingRoomStateHydration, true);
  assert.equal(state.hasReceivedInitialRoomState, false);
});

test("clears room hydration state when content leaves a room", () => {
  const state = createContentRuntimeState();
  state.pendingRoomStateHydration = true;
  state.hasReceivedInitialRoomState = true;

  clearRoomHydrationState(state);

  assert.equal(state.pendingRoomStateHydration, false);
  assert.equal(state.hasReceivedInitialRoomState, false);
});

test("accepts pending hydration only once", () => {
  const state = createContentRuntimeState();

  assert.equal(acceptInitialRoomStateHydrationIfPending(state), true);
  assert.equal(state.pendingRoomStateHydration, false);
  assert.equal(state.hasReceivedInitialRoomState, true);
  assert.equal(acceptInitialRoomStateHydrationIfPending(state), false);
});

test("records hydration response metadata without losing room context", () => {
  const state = createContentRuntimeState();
  state.activeRoomCode = "ROOM01";
  state.localMemberId = "member-old";

  recordHydrationResponseMetadata(state, {
    roomCode: null,
    memberId: null,
  });

  assert.equal(state.activeRoomCode, "ROOM01");
  assert.equal(state.localMemberId, null);

  recordHydrationResponseMetadata(state, {
    roomCode: "ROOM02",
    memberId: "member-new",
  });

  assert.equal(state.activeRoomCode, "ROOM02");
  assert.equal(state.localMemberId, "member-new");
});

test("clears pending hydration only when the background has no active room", () => {
  const state = createContentRuntimeState();

  assert.equal(
    clearPendingHydrationWhenRoomMissing(state, { roomCode: "ROOM01" }),
    false,
  );
  assert.equal(state.pendingRoomStateHydration, true);

  assert.equal(clearPendingHydrationWhenRoomMissing(state, {}), true);
  assert.equal(state.pendingRoomStateHydration, false);
});

test("marks hydration ready without changing room ownership metadata", () => {
  const state = createContentRuntimeState();
  state.activeRoomCode = "ROOM01";
  state.localMemberId = "member-self";

  markHydrationReady(state);

  assert.equal(state.hydrationReady, true);
  assert.equal(state.activeRoomCode, "ROOM01");
  assert.equal(state.localMemberId, "member-self");
});
