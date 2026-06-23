import type {
  PlaybackState,
  RoomChatMessage,
  RoomMemberPermissions,
  SharedVideo,
} from "@syncroom/protocol";
import type { RoomListQuery } from "./admin/types.js";
import type { ActiveRoom, PersistedRoom, RoomStoreRoomState } from "./types.js";

const ROOM_CODE_ALPHABET = "ABCDEFGHJKLMNPQRSTUVWXYZ23456789";
const ROOM_CHAT_HISTORY_LIMIT = 200;

export type CreatePersistedRoomInput = {
  code: string;
  joinToken: string;
  createdAt: number;
  ownerMemberId?: string | null;
  ownerDisplayName?: string | null;
};

export type PersistedRoomPatch = {
  ownerMemberId?: string | null;
  ownerDisplayName?: string | null;
  memberPermissions?: Record<string, RoomMemberPermissions>;
  sharedVideo?: SharedVideo | null;
  playback?: PlaybackState | null;
  chatMessages?: RoomChatMessage[];
  lastActiveAt?: number;
  expiresAt?: number | null;
};

export type RoomUpdateResult =
  | { ok: true; room: PersistedRoom }
  | { ok: false; reason: "not_found" | "version_conflict" };

export type ExpiredRoomsDeletionResult = {
  deletedCount: number;
  roomCodes: string[];
};

export type RoomStore = {
  createRoom: (input: CreatePersistedRoomInput) => Promise<PersistedRoom>;
  getRoom: (code: string) => Promise<PersistedRoom | null>;
  saveRoom: (room: PersistedRoom) => Promise<PersistedRoom>;
  updateRoom: (
    code: string,
    expectedVersion: number,
    patch: PersistedRoomPatch,
  ) => Promise<RoomUpdateResult>;
  deleteRoom: (code: string) => Promise<void>;
  deleteExpiredRooms: (now: number) => Promise<number>;
  deleteExpiredRoomsWithCodes?: (
    now: number,
  ) => Promise<ExpiredRoomsDeletionResult>;
  listRooms: (
    query: Pick<
      RoomListQuery,
      | "keyword"
      | "includeExpired"
      | "page"
      | "pageSize"
      | "sortBy"
      | "sortOrder"
    >,
  ) => Promise<PersistedRoom[]>;
  countRooms: (
    query: Pick<RoomListQuery, "keyword" | "includeExpired">,
  ) => Promise<number>;
  isReady: () => Promise<boolean>;
};

type CreateInMemoryRoomStoreOptions = {
  now?: () => number;
};

export function createRoomCode(): string {
  return Array.from(
    { length: 6 },
    () =>
      ROOM_CODE_ALPHABET[Math.floor(Math.random() * ROOM_CODE_ALPHABET.length)],
  ).join("");
}

function cloneRoom(room: PersistedRoom): PersistedRoom {
  return {
    ...room,
    memberPermissions: cloneMemberPermissions(room.memberPermissions),
    sharedVideo: room.sharedVideo ? { ...room.sharedVideo } : null,
    playback: room.playback ? { ...room.playback } : null,
    chatMessages: (room.chatMessages ?? []).map((message) => ({
      ...message,
    })),
  };
}

export function cloneMemberPermissions(
  permissions: Record<string, RoomMemberPermissions> | undefined,
): Record<string, RoomMemberPermissions> {
  const next: Record<string, RoomMemberPermissions> = {};
  for (const [memberId, memberPermissions] of Object.entries(
    permissions ?? {},
  )) {
    next[memberId] = { ...memberPermissions };
  }
  return next;
}

export function createPersistedRoom(
  input: CreatePersistedRoomInput,
): PersistedRoom {
  return {
    code: input.code,
    joinToken: input.joinToken,
    createdAt: input.createdAt,
    ownerMemberId: input.ownerMemberId ?? null,
    ownerDisplayName: input.ownerDisplayName ?? null,
    memberPermissions: {},
    sharedVideo: null,
    playback: null,
    chatMessages: [],
    version: 0,
    lastActiveAt: input.createdAt,
    expiresAt: null,
  };
}

export function createInMemoryRoomStore(
  options: CreateInMemoryRoomStoreOptions = {},
): RoomStore {
  const rooms = new Map<string, PersistedRoom>();
  const now = options.now ?? Date.now;

  function deleteExpiredRoomsWithCodes(
    currentTime: number,
  ): ExpiredRoomsDeletionResult {
    const roomCodes: string[] = [];
    for (const [code, room] of rooms.entries()) {
      if (room.expiresAt !== null && room.expiresAt <= currentTime) {
        rooms.delete(code);
        roomCodes.push(code);
      }
    }
    return {
      deletedCount: roomCodes.length,
      roomCodes,
    };
  }

  function matchesQuery(
    room: PersistedRoom,
    query: Pick<RoomListQuery, "keyword" | "includeExpired">,
  ): boolean {
    if (
      !query.includeExpired &&
      room.expiresAt !== null &&
      room.expiresAt <= now()
    ) {
      return false;
    }
    if (
      query.keyword &&
      !room.code.toLowerCase().includes(query.keyword.toLowerCase())
    ) {
      return false;
    }
    return true;
  }

  function sortRooms(
    left: PersistedRoom,
    right: PersistedRoom,
    query: Pick<RoomListQuery, "sortBy" | "sortOrder">,
  ): number {
    const factor = query.sortOrder === "asc" ? 1 : -1;
    return (left[query.sortBy] - right[query.sortBy]) * factor;
  }

  return {
    async createRoom(input): Promise<PersistedRoom> {
      if (rooms.has(input.code)) {
        throw new Error(`Room ${input.code} already exists.`);
      }

      const room = createPersistedRoom(input);
      rooms.set(room.code, room);
      return cloneRoom(room);
    },
    async getRoom(code): Promise<PersistedRoom | null> {
      const room = rooms.get(code);
      return room ? cloneRoom(room) : null;
    },
    async saveRoom(room): Promise<PersistedRoom> {
      const storedRoom = cloneRoom(room);
      rooms.set(room.code, storedRoom);
      return cloneRoom(storedRoom);
    },
    async updateRoom(code, expectedVersion, patch): Promise<RoomUpdateResult> {
      const currentRoom = rooms.get(code);
      if (!currentRoom) {
        return { ok: false, reason: "not_found" };
      }
      if (currentRoom.version !== expectedVersion) {
        return { ok: false, reason: "version_conflict" };
      }

      const nextRoom: PersistedRoom = {
        ...currentRoom,
        ...patch,
        chatMessages: patch.chatMessages
          ? patch.chatMessages.slice(-ROOM_CHAT_HISTORY_LIMIT)
          : currentRoom.chatMessages,
        version: currentRoom.version + 1,
        lastActiveAt: patch.lastActiveAt ?? now(),
      };
      rooms.set(code, nextRoom);
      return { ok: true, room: cloneRoom(nextRoom) };
    },
    async deleteRoom(code): Promise<void> {
      rooms.delete(code);
    },
    async deleteExpiredRooms(currentTime): Promise<number> {
      return deleteExpiredRoomsWithCodes(currentTime).deletedCount;
    },
    async deleteExpiredRoomsWithCodes(currentTime) {
      return deleteExpiredRoomsWithCodes(currentTime);
    },
    async listRooms(query) {
      const items = Array.from(rooms.values())
        .filter((room) => matchesQuery(room, query))
        .sort((left, right) => sortRooms(left, right, query));
      const start = (query.page - 1) * query.pageSize;
      return items.slice(start, start + query.pageSize).map(cloneRoom);
    },
    async countRooms(query) {
      return Array.from(rooms.values()).filter((room) =>
        matchesQuery(room, query),
      ).length;
    },
    async isReady() {
      return true;
    },
  };
}

export function roomStateOf(
  room: PersistedRoom,
  activeRoom: ActiveRoom | null,
): RoomStoreRoomState {
  return roomStateFromSessions(
    room,
    Array.from(activeRoom?.members.values() ?? []),
  );
}

export function roomStateFromSessions(
  room: PersistedRoom,
  sessions: Array<{
    id: string;
    memberId: string | null;
    displayName: string;
  }>,
): RoomStoreRoomState {
  type StateMember = {
    id: string;
    name: string;
    permissions?: RoomMemberPermissions;
  };
  const members = new Map<string, StateMember>();
  for (const session of sessions) {
    const memberId = session.memberId ?? session.id;
    const permissions = room.memberPermissions?.[memberId];
    members.set(memberId, {
      id: memberId,
      name: session.displayName,
      ...(permissions ? { permissions: { ...permissions } } : {}),
    });
  }

  return {
    roomCode: room.code,
    ...(room.ownerMemberId ? { hostMemberId: room.ownerMemberId } : {}),
    sharedVideo: room.sharedVideo,
    playback: room.playback,
    members: Array.from(members.values()),
    chatMessages: (room.chatMessages ?? []).slice(-ROOM_CHAT_HISTORY_LIMIT),
  };
}
