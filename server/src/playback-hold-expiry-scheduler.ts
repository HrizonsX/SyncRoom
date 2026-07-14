import type { PlaybackSyncState } from "@syncroom/protocol";
import { getPlaybackHoldDeadline } from "./playback-coordinator.js";
import type { LogEvent, PersistedRoom } from "./types.js";

type PlaybackHoldRoomSnapshot = {
  code?: string;
  roomCode?: string;
  playbackSync?: PlaybackSyncState;
};

type ScheduledExpiry = {
  deadline: number;
  timer: ReturnType<typeof setTimeout>;
};

export type PlaybackHoldExpiryScheduler = {
  observeRoom: (room: PlaybackHoldRoomSnapshot | null) => void;
  forgetRoom: (roomCode: string) => void;
  stop: () => void;
};

const EXPIRY_RETRY_DELAY_MS = 1_000;

export function createPlaybackHoldExpiryScheduler(options: {
  releaseExpiredHold: (
    roomCode: string,
    expectedDeadline: number,
  ) => Promise<{ room: PersistedRoom | null; changed: boolean }>;
  publishRoomStateUpdated: (roomCode: string) => Promise<void>;
  logEvent: LogEvent;
  now?: () => number;
}): PlaybackHoldExpiryScheduler {
  const now = options.now ?? Date.now;
  const scheduledByRoom = new Map<string, ScheduledExpiry>();
  let stopped = false;

  function forgetRoom(roomCode: string): void {
    const scheduled = scheduledByRoom.get(roomCode);
    if (!scheduled) {
      return;
    }
    clearTimeout(scheduled.timer);
    scheduledByRoom.delete(roomCode);
  }

  function schedule(
    roomCode: string,
    deadline: number,
    delayMs = Math.max(1, deadline - now()),
    replaceSameDeadline = false,
  ): void {
    if (stopped) {
      return;
    }
    const existing = scheduledByRoom.get(roomCode);
    if (existing?.deadline === deadline && !replaceSameDeadline) {
      return;
    }
    forgetRoom(roomCode);

    const scheduled: ScheduledExpiry = {
      deadline,
      timer: setTimeout(() => {
        if (scheduledByRoom.get(roomCode) !== scheduled) {
          return;
        }
        scheduledByRoom.delete(roomCode);
        void expire(roomCode, deadline);
      }, delayMs),
    };
    scheduled.timer.unref?.();
    scheduledByRoom.set(roomCode, scheduled);
  }

  function observeRoom(room: PlaybackHoldRoomSnapshot | null): void {
    if (!room) {
      return;
    }
    const roomCode = room.code ?? room.roomCode;
    if (!roomCode) {
      return;
    }
    const deadline = getPlaybackHoldDeadline(room.playbackSync);
    if (deadline === undefined) {
      forgetRoom(roomCode);
      return;
    }
    schedule(roomCode, deadline);
  }

  async function expire(roomCode: string, deadline: number): Promise<void> {
    try {
      const result = await options.releaseExpiredHold(roomCode, deadline);
      observeRoom(result.room);
      if (!result.changed) {
        return;
      }
      await options.publishRoomStateUpdated(roomCode);
    } catch (error) {
      options.logEvent("playback_hold_expiry_failed", {
        roomCode,
        deadline,
        result: "error",
        error: error instanceof Error ? error.message : String(error),
      });
      if (!scheduledByRoom.has(roomCode)) {
        schedule(roomCode, deadline, EXPIRY_RETRY_DELAY_MS, true);
      }
    }
  }

  return {
    observeRoom,
    forgetRoom,
    stop() {
      stopped = true;
      for (const scheduled of scheduledByRoom.values()) {
        clearTimeout(scheduled.timer);
      }
      scheduledByRoom.clear();
    },
  };
}
