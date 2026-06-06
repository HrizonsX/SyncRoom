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
  markRateLimited(retryAfterMs?: number): boolean;
  reset(): void;
}

export interface SyncRequestControllerOptions {
  now?: () => number;
  minIntervalMs?: number;
  inFlightTimeoutMs?: number;
  requestBackoffMs?: readonly number[];
  rateLimitedBackoffMs?: readonly number[];
  rateLimitedAttributionWindowMs?: number;
  jitterRatio?: number;
  random?: () => number;
}

const DEFAULT_MIN_INTERVAL_MS = 2_000;
const DEFAULT_IN_FLIGHT_TIMEOUT_MS = 5_000;
const DEFAULT_RATE_LIMITED_ATTRIBUTION_WINDOW_MS = 10_000;
const DEFAULT_REQUEST_BACKOFF_MS = [2_000, 4_000, 8_000, 15_000] as const;
const DEFAULT_RATE_LIMITED_BACKOFF_MS = [12_000, 20_000, 30_000] as const;
const DEFAULT_JITTER_RATIO = 0.2;

export function createSyncRequestController(
  options: SyncRequestControllerOptions = {},
): SyncRequestController {
  const nowOf = options.now ?? Date.now;
  const minIntervalMs = options.minIntervalMs ?? DEFAULT_MIN_INTERVAL_MS;
  const inFlightTimeoutMs =
    options.inFlightTimeoutMs ?? DEFAULT_IN_FLIGHT_TIMEOUT_MS;
  const rateLimitedAttributionWindowMs =
    options.rateLimitedAttributionWindowMs ??
    DEFAULT_RATE_LIMITED_ATTRIBUTION_WINDOW_MS;
  const requestBackoffMs =
    options.requestBackoffMs ?? DEFAULT_REQUEST_BACKOFF_MS;
  const rateLimitedBackoffMs =
    options.rateLimitedBackoffMs ?? DEFAULT_RATE_LIMITED_BACKOFF_MS;
  const jitterRatio = options.jitterRatio ?? DEFAULT_JITTER_RATIO;
  const randomOf = options.random ?? Math.random;

  let lastRequestAt: number | null = null;
  let inFlightSince: number | null = null;
  let inFlightRoomCode: string | null = null;
  let cooldownUntil = 0;
  let requestBackoffIndex = 0;
  let rateLimitedBackoffIndex = 0;

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

    if (markExpiredInFlightRequest(input.roomCode, now)) {
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
    cooldownUntil = 0;
  }

  function markRoomStateReceived(roomCode: string): void {
    if (inFlightRoomCode !== null && inFlightRoomCode !== roomCode) {
      return;
    }
    inFlightSince = null;
    inFlightRoomCode = null;
    cooldownUntil = 0;
    requestBackoffIndex = 0;
    rateLimitedBackoffIndex = 0;
  }

  function markRateLimited(retryAfterMs?: number): boolean {
    if (lastRequestAt === null) {
      return false;
    }

    const now = nowOf();
    if (now - lastRequestAt > rateLimitedAttributionWindowMs) {
      return false;
    }

    const retryDelayMs = normalizeRetryAfterMs(retryAfterMs);
    if (retryDelayMs !== null) {
      cooldownUntil = now + applyPositiveJitter(retryDelayMs);
    } else {
      cooldownUntil = now + nextRateLimitedBackoffMs();
    }
    inFlightSince = null;
    inFlightRoomCode = null;
    return true;
  }

  function reset(): void {
    lastRequestAt = null;
    inFlightSince = null;
    inFlightRoomCode = null;
    cooldownUntil = 0;
    requestBackoffIndex = 0;
    rateLimitedBackoffIndex = 0;
  }

  function markExpiredInFlightRequest(roomCode: string, now: number): boolean {
    if (
      inFlightSince === null ||
      inFlightRoomCode !== roomCode ||
      now - inFlightSince < inFlightTimeoutMs
    ) {
      return false;
    }

    cooldownUntil = now + nextRequestBackoffMs();
    inFlightSince = null;
    inFlightRoomCode = null;
    return true;
  }

  function nextRequestBackoffMs(): number {
    const backoffMs = pickBackoffMs(requestBackoffMs, requestBackoffIndex);
    requestBackoffIndex = Math.min(
      requestBackoffIndex + 1,
      requestBackoffMs.length - 1,
    );
    return applySymmetricJitter(backoffMs);
  }

  function nextRateLimitedBackoffMs(): number {
    const backoffMs = pickBackoffMs(
      rateLimitedBackoffMs,
      rateLimitedBackoffIndex,
    );
    rateLimitedBackoffIndex = Math.min(
      rateLimitedBackoffIndex + 1,
      rateLimitedBackoffMs.length - 1,
    );
    return applySymmetricJitter(backoffMs);
  }

  function pickBackoffMs(sequence: readonly number[], index: number): number {
    if (sequence.length === 0) {
      return 0;
    }
    return sequence[Math.min(index, sequence.length - 1)];
  }

  function normalizeRetryAfterMs(value: number | undefined): number | null {
    if (typeof value !== "number" || !Number.isFinite(value) || value <= 0) {
      return null;
    }
    return Math.ceil(value);
  }

  function applySymmetricJitter(delayMs: number): number {
    if (jitterRatio <= 0 || delayMs <= 0) {
      return Math.ceil(delayMs);
    }
    const multiplier = 1 + (randomOf() * 2 - 1) * jitterRatio;
    return Math.max(1, Math.ceil(delayMs * multiplier));
  }

  function applyPositiveJitter(delayMs: number): number {
    if (jitterRatio <= 0 || delayMs <= 0) {
      return Math.ceil(delayMs);
    }
    const multiplier = 1 + randomOf() * jitterRatio;
    return Math.max(1, Math.ceil(delayMs * multiplier));
  }

  return {
    shouldRequestRoomState,
    markRoomStateRequested,
    markRoomStateReceived,
    markRateLimited,
    reset,
  };
}
