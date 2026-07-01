import assert from "node:assert/strict";
import test from "node:test";
import { DEFAULT_VOICE_AUDIO_CAPTURE_OPTIONS } from "../src/voice/livekit-voice-runtime";

test("enables native WebRTC microphone processing by default", () => {
  assert.deepEqual(DEFAULT_VOICE_AUDIO_CAPTURE_OPTIONS, {
    echoCancellation: true,
    noiseSuppression: true,
    autoGainControl: true,
  });
});
