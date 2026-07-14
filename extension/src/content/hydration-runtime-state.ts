import type { ContentRuntimeState } from "./runtime-state";

export interface HydrationResponseMetadata {
  memberId?: string | null;
  roomCode?: string | null;
}

export function beginInitialRoomStateHydration(
  state: ContentRuntimeState,
): void {
  state.hasReceivedInitialRoomState = false;
  state.pendingRoomStateHydration = true;
}

export function clearRoomHydrationState(state: ContentRuntimeState): void {
  state.pendingRoomStateHydration = false;
  state.hasReceivedInitialRoomState = false;
}

/**
 * Accepting an initial room-state snapshot is a paired transition: broadcasts
 * may resume only after the pending flag is cleared and future sync-status
 * events know the initial snapshot has already been seen.
 */
export function acceptInitialRoomStateHydration(
  state: ContentRuntimeState,
): void {
  state.pendingRoomStateHydration = false;
  state.hasReceivedInitialRoomState = true;
}

export function acceptInitialRoomStateHydrationIfPending(
  state: ContentRuntimeState,
): boolean {
  if (!state.pendingRoomStateHydration) {
    return false;
  }
  acceptInitialRoomStateHydration(state);
  return true;
}

/**
 * Hydration responses can omit roomCode during transient background/content
 * races. Preserve the last known room context so retry logs, guards, and
 * follow-up status events still refer to the room being hydrated.
 */
export function recordHydrationResponseMetadata(
  state: ContentRuntimeState,
  metadata: HydrationResponseMetadata,
): void {
  state.localMemberId = metadata.memberId ?? null;
  state.activeRoomCode = metadata.roomCode ?? state.activeRoomCode;
}

export function markHydrationReady(state: ContentRuntimeState): void {
  state.hydrationReady = true;
}

export function clearPendingHydrationWhenRoomMissing(
  state: ContentRuntimeState,
  metadata: Pick<HydrationResponseMetadata, "roomCode">,
): boolean {
  if (metadata.roomCode) {
    return false;
  }
  state.pendingRoomStateHydration = false;
  return true;
}
