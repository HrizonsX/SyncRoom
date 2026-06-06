export interface SyncRequestDecisionInput {
  connected: boolean;
  roomCode: string | null;
  memberToken: string | null;
  hasCachedRoomState: boolean;
}

export interface SyncRequestController {
  shouldRequestRoomState(input: SyncRequestDecisionInput): boolean;
  markRoomStateRequested(roomCode: string): void;
  markRoomStateReceived(roomCode: string): void;
  markRateLimited(): boolean;
  reset(): void;
}

export interface SyncRequestControllerOptions {
  now?: () => number;
  minIntervalMs?: number;
  inFlightTimeoutMs?: number;
  rateLimitedCooldownMs?: number;
  rateLimitedAttributionWindowMs?: number;
}

const DEFAULT_MIN_INTERVAL_MS = 2_000;
const DEFAULT_IN_FLIGHT_TIMEOUT_MS = 5_000;
const DEFAULT_RATE_LIMITED_COOLDOWN_MS = 30_000;
const DEFAULT_RATE_LIMITED_ATTRIBUTION_WINDOW_MS = 10_000;

export function createSyncRequestController(
  options: SyncRequestControllerOptions = {},
): SyncRequestController {
  const nowOf = options.now ?? Date.now;
  const minIntervalMs = options.minIntervalMs ?? DEFAULT_MIN_INTERVAL_MS;
  const inFlightTimeoutMs =
    options.inFlightTimeoutMs ?? DEFAULT_IN_FLIGHT_TIMEOUT_MS;
  const rateLimitedCooldownMs =
    options.rateLimitedCooldownMs ?? DEFAULT_RATE_LIMITED_COOLDOWN_MS;
  const rateLimitedAttributionWindowMs =
    options.rateLimitedAttributionWindowMs ??
    DEFAULT_RATE_LIMITED_ATTRIBUTION_WINDOW_MS;

  let lastRequestAt: number | null = null;
  let inFlightSince: number | null = null;
  let inFlightRoomCode: string | null = null;
  let cooldownUntil = 0;

  function shouldRequestRoomState(input: SyncRequestDecisionInput): boolean {
    if (
      input.hasCachedRoomState ||
      !input.connected ||
      !input.roomCode ||
      !input.memberToken
    ) {
      return false;
    }

    const now = nowOf();
    if (now < cooldownUntil) {
      return false;
    }

    if (
      inFlightSince !== null &&
      inFlightRoomCode === input.roomCode &&
      now - inFlightSince < inFlightTimeoutMs
    ) {
      return false;
    }

    if (
      lastRequestAt !== null &&
      inFlightRoomCode === input.roomCode &&
      now - lastRequestAt < minIntervalMs
    ) {
      return false;
    }

    return true;
  }

  function markRoomStateRequested(roomCode: string): void {
    const now = nowOf();
    lastRequestAt = now;
    inFlightSince = now;
    inFlightRoomCode = roomCode;
  }

  function markRoomStateReceived(roomCode: string): void {
    if (inFlightRoomCode !== null && inFlightRoomCode !== roomCode) {
      return;
    }
    inFlightSince = null;
    inFlightRoomCode = null;
    cooldownUntil = 0;
  }

  function markRateLimited(): boolean {
    if (lastRequestAt === null) {
      return false;
    }

    const now = nowOf();
    if (now - lastRequestAt > rateLimitedAttributionWindowMs) {
      return false;
    }

    cooldownUntil = now + rateLimitedCooldownMs;
    inFlightSince = null;
    return true;
  }

  function reset(): void {
    lastRequestAt = null;
    inFlightSince = null;
    inFlightRoomCode = null;
    cooldownUntil = 0;
  }

  return {
    shouldRequestRoomState,
    markRoomStateRequested,
    markRoomStateReceived,
    markRateLimited,
    reset,
  };
}
