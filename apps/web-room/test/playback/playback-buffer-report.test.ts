import assert from "node:assert/strict";
import test from "node:test";
import {
  bindPlaybackBufferReporter,
  getBufferAheadSeconds,
  type BufferReportMediaElementLike,
} from "../../src/playback/playback-buffer-report.js";

function createBufferedRanges(
  ranges: Array<{ start: number; end: number }>,
): TimeRanges {
  return {
    length: ranges.length,
    start(index: number) {
      const range = ranges[index];
      if (!range) {
        throw new DOMException("IndexSizeError", "IndexSizeError");
      }
      return range.start;
    },
    end(index: number) {
      const range = ranges[index];
      if (!range) {
        throw new DOMException("IndexSizeError", "IndexSizeError");
      }
      return range.end;
    },
  };
}

function createMedia(): BufferReportMediaElementLike & {
  emit: (type: string) => void;
  setBuffered: (ranges: Array<{ start: number; end: number }>) => void;
} {
  const listeners = new Map<string, Set<() => void>>();
  return {
    currentTime: 12,
    buffered: createBufferedRanges([]),
    addEventListener(type: string, listener: () => void) {
      const eventListeners = listeners.get(type) ?? new Set<() => void>();
      eventListeners.add(listener);
      listeners.set(type, eventListeners);
    },
    removeEventListener(type: string, listener: () => void) {
      listeners.get(type)?.delete(listener);
    },
    emit(type: string) {
      listeners.get(type)?.forEach((listener) => listener());
    },
    setBuffered(ranges: Array<{ start: number; end: number }>) {
      this.buffered = createBufferedRanges(ranges);
    },
  };
}

test("buffer reporter measures buffer ahead near the current playback time", () => {
  const media = createMedia();

  media.setBuffered([{ start: 12.05, end: 18 }]);

  assert.equal(getBufferAheadSeconds(media), 6);
});

test("buffer reporter sends buffering and ready states without playback updates", (t) => {
  t.mock.timers.enable({ apis: ["setTimeout"] });
  const media = createMedia();
  const reports: unknown[] = [];

  const binding = bindPlaybackBufferReporter({
    media,
    reportDelayMs: 10,
    getContext: () => ({
      memberToken: "valid-member-token-123",
      actorId: "member-guest",
      url: "https://syncroom.example.test/video.mpd",
    }),
    dispatch(report) {
      reports.push(report);
    },
  });

  media.emit("waiting");
  t.mock.timers.tick(9);
  assert.deepEqual(reports, []);

  t.mock.timers.tick(1);
  assert.deepEqual(reports, [
    {
      state: "buffering",
      currentTime: 12,
      bufferAheadSeconds: 0,
    },
  ]);

  media.setBuffered([{ start: 12, end: 17 }]);
  media.emit("canplay");

  assert.deepEqual(reports.at(-1), {
    state: "ready",
    currentTime: 12,
    bufferAheadSeconds: 5,
  });

  binding.dispose();
});

test("buffer reporter treats waiting with enough buffered media as ready", (t) => {
  t.mock.timers.enable({ apis: ["setTimeout"] });
  const media = createMedia();
  const reports: unknown[] = [];
  media.setBuffered([{ start: 12, end: 20 }]);

  const binding = bindPlaybackBufferReporter({
    media,
    reportDelayMs: 10,
    getContext: () => ({
      memberToken: "valid-member-token-123",
      actorId: "member-guest",
      url: "https://syncroom.example.test/video.mpd",
    }),
    dispatch(report) {
      reports.push(report);
    },
  });

  media.emit("waiting");
  t.mock.timers.tick(10);

  assert.deepEqual(reports, [
    {
      state: "ready",
      currentTime: 12,
      bufferAheadSeconds: 8,
    },
  ]);
  binding.dispose();
});

test("buffer reporter polls ready state while wait mode is holding", (t) => {
  t.mock.timers.enable({
    apis: ["setTimeout"],
  });
  const media = createMedia();
  const reports: unknown[] = [];

  const binding = bindPlaybackBufferReporter({
    media,
    reportDelayMs: 10,
    pollIntervalMs: 500,
    getContext: () => ({
      memberToken: "valid-member-token-123",
      actorId: "member-guest",
      url: "https://syncroom.example.test/video.mpd",
    }),
    dispatch(report) {
      reports.push(report);
    },
  });

  binding.setPollingEnabled(true);
  media.setBuffered([{ start: 12, end: 16 }]);
  t.mock.timers.tick(499);
  assert.deepEqual(reports, []);

  t.mock.timers.tick(1);
  assert.deepEqual(reports, [
    {
      state: "ready",
      currentTime: 12,
      bufferAheadSeconds: 4,
    },
  ]);

  binding.dispose();
  media.setBuffered([{ start: 12, end: 20 }]);
  t.mock.timers.tick(500);
  assert.equal(reports.length, 1);
});

test("buffer reporter keeps a bounded heartbeat while a barrier has no buffer growth", (t) => {
  t.mock.timers.enable({ apis: ["setTimeout"] });
  const media = createMedia();
  const reports: unknown[] = [];
  let now = 1_000;
  const binding = bindPlaybackBufferReporter({
    media,
    reportDelayMs: 10,
    pollIntervalMs: 500,
    maxSilentReportIntervalMs: 2_000,
    now: () => now,
    getContext: () => ({
      memberToken: "valid-member-token-123",
      actorId: "member-guest",
      url: "https://syncroom.example.test/video.mpd",
      playbackRevision: "revision-1",
    }),
    dispatch(report) {
      reports.push(report);
    },
  });

  binding.reportNow();
  binding.setPollingEnabled(true);
  now = 2_500;
  t.mock.timers.tick(1_500);
  assert.equal(reports.length, 1);

  now = 3_000;
  t.mock.timers.tick(500);
  assert.equal(reports.length, 2);
  assert.deepEqual(reports.at(-1), {
    state: "buffering",
    currentTime: 12,
    bufferAheadSeconds: 0,
    playbackRevision: "revision-1",
  });

  binding.dispose();
});
