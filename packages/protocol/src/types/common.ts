export const PROTOCOL_VERSION = 3;

export type RoomCode = string;
export type PlaybackPlayState = "playing" | "paused" | "buffering";

export const ERROR_CODES = [
  "origin_not_allowed",
  "room_not_found",
  "join_token_invalid",
  "member_token_invalid",
  "not_in_room",
  "rate_limited",
  "invalid_message",
  "payload_too_large",
  "room_full",
  "server_room_limit_reached",
  "unsupported_protocol_version",
  "voice_unavailable",
  "voice_capacity_reached",
  "voice_token_failed",
  "chat_rate_limited",
  "chat_validation_failed",
  "provider_auth_unavailable",
  "provider_auth_forbidden",
  "provider_parse_failed",
  "proxy_expired",
  "proxy_forbidden",
  "direct_playback_failed",
  "unsupported_source",
  "internal_error",
] as const;

export type ErrorCode = (typeof ERROR_CODES)[number];

export function isErrorCode(value: unknown): value is ErrorCode {
  return (
    typeof value === "string" &&
    (ERROR_CODES as readonly string[]).includes(value)
  );
}
