import assert from "node:assert/strict";
import { once } from "node:events";
import test from "node:test";
import { PROTOCOL_VERSION } from "@syncroom/protocol";
import { WebSocket, type RawData } from "ws";
import {
  createSyncServer,
  getDefaultPersistenceConfig,
  getDefaultSecurityConfig,
} from "../src/app.js";

const ALLOWED_ORIGIN = "https://web-room.example.test";

type Message = {
  type?: string;
  payload?: Record<string, unknown>;
};

type RoomStatePayload = {
  playback?: {
    currentTime: number;
    serverTime: number;
    playState: string;
  };
  playbackSync?: {
    strategy: string;
    hold: {
      active: boolean;
      deadlineAt?: number;
      playbackRevision?: string;
    };
    bufferingMemberIds: string[];
  };
};

async function startServer() {
  const server = await createSyncServer(
    {
      ...getDefaultSecurityConfig(),
      allowedOrigins: [ALLOWED_ORIGIN],
    },
    getDefaultPersistenceConfig(),
    {
      logEvent: () => {},
      serviceVersion: "0.0.0-playback-wait-e2e",
      adminUiConfig: { enabled: false, demoEnabled: false },
    },
  );

  await new Promise<void>((resolve, reject) => {
    server.httpServer.listen(0, "127.0.0.1", resolve);
    server.httpServer.once("error", reject);
  });

  const address = server.httpServer.address();
  if (!address || typeof address === "string") {
    throw new Error("Failed to resolve test server address.");
  }

  return {
    wsUrl: `ws://127.0.0.1:${address.port}`,
    close: () => server.close(),
  };
}

async function connect(wsUrl: string): Promise<WebSocket> {
  const socket = new WebSocket(wsUrl, { origin: ALLOWED_ORIGIN });
  await once(socket, "open");
  return socket;
}

function createCollector(socket: WebSocket) {
  const queue: Message[] = [];
  socket.on("message", (raw: RawData) => {
    queue.push(JSON.parse(raw.toString()) as Message);
  });

  return {
    async next(type: string, timeoutMs = 3_000): Promise<Message> {
      const deadline = Date.now() + timeoutMs;
      while (Date.now() < deadline) {
        const index = queue.findIndex((message) => message.type === type);
        if (index >= 0) {
          return queue.splice(index, 1)[0]!;
        }
        await new Promise((resolve) => setTimeout(resolve, 10));
      }
      throw new Error(
        `Timed out waiting for ${type}; queued: ${queue.map((message) => message.type).join(", ")}`,
      );
    },
    async absent(type: string, windowMs = 150): Promise<void> {
      const deadline = Date.now() + windowMs;
      while (Date.now() < deadline) {
        assert.equal(
          queue.some((message) => message.type === type),
          false,
          `Unexpected ${type} broadcast`,
        );
        await new Promise((resolve) => setTimeout(resolve, 10));
      }
    },
  };
}

async function closeSocket(socket: WebSocket): Promise<void> {
  if (socket.readyState >= WebSocket.CLOSING) return;
  await new Promise<void>((resolve) => {
    const timeout = setTimeout(resolve, 300);
    socket.once("close", () => {
      clearTimeout(timeout);
      resolve();
    });
    socket.close();
  });
}

function roomState(message: Message): RoomStatePayload {
  return (message.payload ?? {}) as RoomStatePayload;
}

test("wait strategy freezes the shared timeline until every buffering member is ready", async () => {
  const server = await startServer();
  const ownerSocket = await connect(server.wsUrl);
  const joinerSocket = await connect(server.wsUrl);
  const ownerMessages = createCollector(ownerSocket);
  const joinerMessages = createCollector(joinerSocket);

  try {
    ownerSocket.send(
      JSON.stringify({
        type: "room:create",
        payload: { displayName: "Owner", protocolVersion: PROTOCOL_VERSION },
      }),
    );
    const created = await ownerMessages.next("room:created");
    const owner = created.payload as {
      roomCode: string;
      joinToken: string;
      memberId: string;
      memberToken: string;
    };
    await ownerMessages.next("room:state");

    joinerSocket.send(
      JSON.stringify({
        type: "room:join",
        payload: {
          roomCode: owner.roomCode,
          joinToken: owner.joinToken,
          displayName: "Joiner",
          protocolVersion: PROTOCOL_VERSION,
        },
      }),
    );
    const joined = await joinerMessages.next("room:joined");
    const joiner = joined.payload as {
      memberId: string;
      memberToken: string;
    };
    await joinerMessages.next("room:state");
    await ownerMessages.next("room:member-joined");

    const videoUrl = "https://www.bilibili.com/video/BV1xx411c7mD?p=1";
    ownerSocket.send(
      JSON.stringify({
        type: "video:share",
        payload: {
          memberToken: owner.memberToken,
          video: {
            videoId: "BV1xx411c7mD",
            url: videoUrl,
            title: "Wait mode test",
          },
          playback: {
            url: videoUrl,
            currentTime: 120,
            playState: "playing",
            playbackRate: 1,
            updatedAt: Date.now(),
            serverTime: 0,
            actorId: owner.memberId,
            seq: 1,
          },
        },
      }),
    );
    await ownerMessages.next("room:state");
    await joinerMessages.next("room:state");

    ownerSocket.send(
      JSON.stringify({
        type: "playback:sync-strategy:set",
        payload: { memberToken: owner.memberToken, strategy: "wait" },
      }),
    );
    const ownerHeld = roomState(await ownerMessages.next("room:state"));
    const joinerHeld = roomState(await joinerMessages.next("room:state"));
    const playbackRevision = ownerHeld.playbackSync?.hold.playbackRevision;
    assert.equal(ownerHeld.playbackSync?.hold.active, true);
    assert.ok(playbackRevision);
    assert.deepEqual(
      new Set(ownerHeld.playbackSync?.bufferingMemberIds),
      new Set([owner.memberId, joiner.memberId]),
    );
    assert.deepEqual(ownerHeld.playback, joinerHeld.playback);

    joinerSocket.send(
      JSON.stringify({
        type: "playback:buffer",
        payload: {
          memberToken: joiner.memberToken,
          state: "ready",
          currentTime: 120,
          bufferAheadSeconds: 8,
          playbackRevision: "stale-revision",
        },
      }),
    );
    await ownerMessages.absent("room:state");
    await joinerMessages.absent("room:state");

    ownerSocket.send(
      JSON.stringify({
        type: "playback:buffer",
        payload: {
          memberToken: owner.memberToken,
          state: "ready",
          currentTime: ownerHeld.playback?.currentTime ?? 120,
          bufferAheadSeconds: 6,
          playbackRevision,
        },
      }),
    );
    const ownerWaitingForJoiner = roomState(
      await ownerMessages.next("room:state"),
    );
    const joinerWaitingForJoiner = roomState(
      await joinerMessages.next("room:state"),
    );
    assert.deepEqual(ownerWaitingForJoiner.playbackSync?.bufferingMemberIds, [
      joiner.memberId,
    ]);
    assert.deepEqual(
      ownerWaitingForJoiner.playback,
      joinerWaitingForJoiner.playback,
    );

    await new Promise((resolve) => setTimeout(resolve, 120));
    ownerSocket.send(
      JSON.stringify({
        type: "sync:request",
        payload: { memberToken: owner.memberToken },
      }),
    );
    const stillFrozen = roomState(await ownerMessages.next("room:state"));
    assert.deepEqual(stillFrozen.playback, ownerHeld.playback);

    joinerSocket.send(
      JSON.stringify({
        type: "playback:buffer",
        payload: {
          memberToken: joiner.memberToken,
          state: "ready",
          currentTime: ownerHeld.playback?.currentTime ?? 120,
          bufferAheadSeconds: 4,
          playbackRevision,
        },
      }),
    );
    await ownerMessages.absent("room:state");
    await joinerMessages.absent("room:state");

    ownerSocket.send(
      JSON.stringify({
        type: "sync:request",
        payload: { memberToken: owner.memberToken },
      }),
    );
    const shallowReadyState = roomState(await ownerMessages.next("room:state"));
    assert.equal(shallowReadyState.playbackSync?.hold.active, true);
    assert.deepEqual(shallowReadyState.playback, ownerHeld.playback);

    joinerSocket.send(
      JSON.stringify({
        type: "playback:buffer",
        payload: {
          memberToken: joiner.memberToken,
          state: "ready",
          currentTime: ownerHeld.playback?.currentTime ?? 120,
          bufferAheadSeconds: 6,
          playbackRevision,
        },
      }),
    );
    const ownerReleased = roomState(await ownerMessages.next("room:state"));
    const joinerReleased = roomState(await joinerMessages.next("room:state"));
    assert.equal(ownerReleased.playbackSync?.hold.active, false);
    assert.deepEqual(ownerReleased.playbackSync?.bufferingMemberIds, []);
    assert.equal(
      ownerReleased.playback?.currentTime,
      ownerHeld.playback?.currentTime,
    );
    assert.ok(
      (ownerReleased.playback?.serverTime ?? 0) >
        (ownerHeld.playback?.serverTime ?? 0),
    );
    assert.deepEqual(ownerReleased.playback, joinerReleased.playback);
    assert.deepEqual(ownerReleased.playbackSync, joinerReleased.playbackSync);
  } finally {
    await closeSocket(ownerSocket);
    await closeSocket(joinerSocket);
    await server.close();
  }
});
