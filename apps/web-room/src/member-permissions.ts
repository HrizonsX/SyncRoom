import type {
  RoomMemberPermissionName,
  RoomMemberPermissions,
} from "@syncroom/protocol";

export type WebRoomMemberPermissionCarrier = {
  permissions?: Partial<RoomMemberPermissions>;
};

export const DEFAULT_WEB_ROOM_MEMBER_PERMISSIONS: RoomMemberPermissions = {
  voice: true,
  playbackControl: true,
  chat: true,
  danmaku: true,
};

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null;
}

export function readMemberPermissions(
  value: unknown,
): RoomMemberPermissions | undefined {
  if (!isRecord(value)) {
    return undefined;
  }

  const permissions = {
    voice: value.voice,
    playbackControl: value.playbackControl,
    chat: value.chat,
    danmaku: value.danmaku,
  };
  if (
    typeof permissions.voice !== "boolean" ||
    typeof permissions.playbackControl !== "boolean" ||
    typeof permissions.chat !== "boolean" ||
    typeof permissions.danmaku !== "boolean"
  ) {
    return undefined;
  }

  return {
    voice: permissions.voice,
    playbackControl: permissions.playbackControl,
    chat: permissions.chat,
    danmaku: permissions.danmaku,
  };
}

export function getEffectiveMemberPermissions(
  member: WebRoomMemberPermissionCarrier | null | undefined,
): RoomMemberPermissions {
  return {
    ...DEFAULT_WEB_ROOM_MEMBER_PERMISSIONS,
    ...(member?.permissions ?? {}),
  };
}

export function isMemberPermissionAllowed(
  member: WebRoomMemberPermissionCarrier | null | undefined,
  permission: RoomMemberPermissionName,
): boolean {
  return getEffectiveMemberPermissions(member)[permission];
}
