import assert from "node:assert/strict";
import test from "node:test";
import { decidePlaybackAcceptance } from "../src/playback-authority.js";

test("playback authority ignores non-explicit follow-up play during another actor's authority window", () => {
  const decision = decidePlaybackAcceptance({
    currentPlayback: {
      currentTime: 42,
      playState: "playing",
      playbackRate: 1,
      updatedAt: 100,
      serverTime: 0,
      actorId: "owner",
    },
    authority: {
      actorId: "owner",
      kind: "play",
      until: 200,
      baselineCurrentTime: 42,
      baselineUpdatedAt: 100,
      baselinePlaybackRate: 1,
    },
    incomingPlayback: {
      currentTime: 42.3,
      playState: "playing",
      playbackRate: 1,
      updatedAt: 110,
      serverTime: 0,
      actorId: "guest",
    },
    currentTime: 150,
  });

  assert.deepEqual(decision, {
    decision: "ignore-as-follow",
    reason: "authority-window-follow",
  });
});

test("playback authority ignores stale-like playing updates that regress behind current playback", () => {
  const decision = decidePlaybackAcceptance({
    currentPlayback: {
      currentTime: 20,
      playState: "playing",
      playbackRate: 1,
      updatedAt: 100,
      serverTime: 0,
      actorId: "owner",
    },
    authority: null,
    incomingPlayback: {
      currentTime: 19,
      playState: "playing",
      playbackRate: 1,
      updatedAt: 110,
      serverTime: 0,
      actorId: "guest",
    },
    currentTime: 150,
  });

  assert.deepEqual(decision, {
    decision: "ignore-stale-like",
    reason: "timeline-regression",
  });
});

test("playback authority ignores same-actor weak-network play resumes behind projected playback", () => {
  const decision = decidePlaybackAcceptance({
    currentPlayback: {
      currentTime: 30,
      playState: "playing",
      playbackRate: 1,
      updatedAt: 1_000,
      serverTime: 1_000,
      actorId: "guest",
    },
    authority: null,
    incomingPlayback: {
      currentTime: 30.4,
      playState: "playing",
      playbackRate: 1,
      updatedAt: 2_500,
      serverTime: 2_500,
      actorId: "guest",
    },
    currentTime: 2_500,
  });

  assert.deepEqual(decision, {
    decision: "ignore-stale-like",
    reason: "timeline-regression",
  });
});

test("playback authority projects movie progress before rejecting refreshed zero-time updates", () => {
  const decision = decidePlaybackAcceptance({
    currentPlayback: {
      currentTime: 0,
      playState: "playing",
      playbackRate: 1,
      updatedAt: 1_000,
      serverTime: 1_000,
      actorId: "owner",
    },
    authority: null,
    incomingPlayback: {
      currentTime: 0,
      playState: "playing",
      playbackRate: 1,
      updatedAt: 26_000,
      serverTime: 26_000,
      actorId: "guest",
    },
    currentTime: 26_000,
  });

  assert.deepEqual(decision, {
    decision: "ignore-stale-like",
    reason: "timeline-regression",
  });
});

test("playback authority ignores stale non-explicit zero-time pause after another member joins", () => {
  const decision = decidePlaybackAcceptance({
    currentPlayback: {
      currentTime: 120,
      playState: "paused",
      playbackRate: 1,
      updatedAt: 1_000,
      serverTime: 1_000,
      actorId: "owner",
    },
    authority: null,
    incomingPlayback: {
      currentTime: 0,
      playState: "paused",
      playbackRate: 1,
      updatedAt: 2_000,
      serverTime: 2_000,
      actorId: "guest",
    },
    currentTime: 2_000,
  });

  assert.deepEqual(decision, {
    decision: "ignore-stale-like",
    reason: "timeline-regression",
  });
});

test("playback authority still accepts explicit seek back to the beginning", () => {
  const decision = decidePlaybackAcceptance({
    currentPlayback: {
      currentTime: 120,
      playState: "paused",
      playbackRate: 1,
      updatedAt: 1_000,
      serverTime: 1_000,
      actorId: "owner",
    },
    authority: null,
    incomingPlayback: {
      currentTime: 0,
      playState: "paused",
      playbackRate: 1,
      updatedAt: 2_000,
      serverTime: 2_000,
      actorId: "guest",
      syncIntent: "explicit-seek",
    },
    currentTime: 2_000,
  });

  assert.deepEqual(decision, {
    decision: "accept",
    reason: "default",
  });
});

test("playback authority does not project live progress when accepting live pause controls", () => {
  const decision = decidePlaybackAcceptance({
    currentPlayback: {
      currentTime: 0,
      playState: "playing",
      playbackRate: 1,
      updatedAt: 1_000,
      serverTime: 1_000,
      actorId: "owner",
    },
    authority: null,
    incomingPlayback: {
      currentTime: 0,
      playState: "paused",
      playbackRate: 1,
      updatedAt: 26_000,
      serverTime: 26_000,
      actorId: "guest",
      syncIntent: "explicit-pause",
    },
    currentTime: 26_000,
    isLivePlayback: true,
  });

  assert.deepEqual(decision, {
    decision: "accept",
    reason: "default",
  });
});

test("playback authority ignores non-explicit live pauses while the room is playing", () => {
  const decision = decidePlaybackAcceptance({
    currentPlayback: {
      currentTime: 0,
      playState: "playing",
      playbackRate: 1,
      updatedAt: 1_000,
      serverTime: 1_000,
      actorId: "owner",
    },
    authority: null,
    incomingPlayback: {
      currentTime: 0,
      playState: "paused",
      playbackRate: 1,
      updatedAt: 26_000,
      serverTime: 26_000,
      actorId: "guest",
    },
    currentTime: 26_000,
    isLivePlayback: true,
  });

  assert.deepEqual(decision, {
    decision: "ignore-as-follow",
    reason: "live-non-explicit-stop",
  });
});

test("playback authority accepts explicit control even inside another actor's authority window", () => {
  const decision = decidePlaybackAcceptance({
    currentPlayback: {
      currentTime: 42,
      playState: "playing",
      playbackRate: 1,
      updatedAt: 100,
      serverTime: 0,
      actorId: "owner",
    },
    authority: {
      actorId: "owner",
      kind: "seek",
      until: 200,
      baselineCurrentTime: 42,
      baselineUpdatedAt: 100,
      baselinePlaybackRate: 1,
    },
    incomingPlayback: {
      currentTime: 43,
      playState: "paused",
      playbackRate: 1,
      updatedAt: 110,
      serverTime: 0,
      actorId: "guest",
      syncIntent: "explicit-seek",
    },
    currentTime: 150,
  });

  assert.deepEqual(decision, {
    decision: "accept",
    reason: "default",
  });
});

test("playback authority ignores an explicit rate request that keeps the current rate", () => {
  const decision = decidePlaybackAcceptance({
    currentPlayback: {
      currentTime: 120,
      playState: "playing",
      playbackRate: 1,
      updatedAt: 1_000,
      serverTime: 1_000,
      actorId: "owner",
    },
    authority: null,
    incomingPlayback: {
      currentTime: 125,
      playState: "playing",
      playbackRate: 1,
      updatedAt: 6_000,
      serverTime: 6_000,
      actorId: "guest",
      syncIntent: "explicit-ratechange",
    },
    currentTime: 6_000,
  });

  assert.deepEqual(decision, {
    decision: "ignore-as-follow",
    reason: "unchanged-ratechange",
  });
});

test("playback authority accepts explicit play or pause controls inside another actor's authority window", () => {
  for (const [playState, syncIntent] of [
    ["playing", "explicit-play"],
    ["paused", "explicit-pause"],
  ] as const) {
    const decision = decidePlaybackAcceptance({
      currentPlayback: {
        currentTime: 42,
        playState: playState === "playing" ? "paused" : "playing",
        playbackRate: 1,
        updatedAt: 100,
        serverTime: 0,
        actorId: "owner",
      },
      authority: {
        actorId: "owner",
        kind: "play",
        until: 200,
        baselineCurrentTime: 42,
        baselineUpdatedAt: 100,
        baselinePlaybackRate: 1,
      },
      incomingPlayback: {
        currentTime: 42.2,
        playState,
        playbackRate: 1,
        updatedAt: 110,
        serverTime: 0,
        actorId: "guest",
        syncIntent,
      },
      currentTime: 150,
    });

    assert.deepEqual(decision, {
      decision: "accept",
      reason: "default",
    });
  }
});
