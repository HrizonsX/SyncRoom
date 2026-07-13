import type {
  ClientMessage,
  RoomChatMessage,
  RoomSystemChatEventType,
} from "@syncroom/protocol";
import type { WebSocket } from "ws";
import { performance } from "node:perf_hooks";
import type {
  MetricsCollector,
  MonitoredMessageType,
} from "./admin/metrics.js";
import {
  consumeFixedWindow,
  consumeTokenBucket,
  WINDOW_10_SECONDS_MS,
  WINDOW_5_SECONDS_MS,
  WINDOW_MINUTE_MS,
} from "./rate-limit.js";
import {
  CHAT_RATE_LIMITED_MESSAGE,
  DANMAKU_RATE_LIMITED_MESSAGE,
  MEMBER_KICKED_MESSAGE,
  MEMBER_TOKEN_INVALID_MESSAGE,
  RATE_LIMITED_MESSAGE,
  UNSUPPORTED_PROTOCOL_VERSION_MESSAGE,
  MIN_PROTOCOL_VERSION,
  CURRENT_PROTOCOL_VERSION,
  VOICE_UNAVAILABLE_MESSAGE,
} from "./messages.js";
import { RoomServiceError, type LeaveRoomOptions } from "./room-service.js";
import type { RoomEventBusMessage } from "./room-event-bus.js";
import { hasAttachedSocket } from "./types.js";
import type { LogEvent, SendError, SendMessage, Session } from "./types.js";
import { VoiceServiceError, type VoiceAccessDetails } from "./voice-service.js";

type RoomEventBusPublishInput<T> = T extends unknown
  ? Omit<T, "sourceInstanceId" | "emittedAt">
  : never;

const HOST_DISCONNECT_TRANSFER_GRACE_MS = 5_000;

export function createMessageHandler(options: {
  config: {
    maxMembersPerRoom: number;
    rateLimits: {
      roomCreatePerMinute: number;
      roomJoinPerMinute: number;
      videoSharePer10Seconds: number;
      playbackUpdatePerSecond: number;
      playbackUpdateBurst: number;
      syncRequestPer10Seconds: number;
      chatMessagePer5Seconds: number;
      danmakuMessagePer5Seconds: number;
      syncPingPerSecond: number;
      syncPingBurst: number;
    };
  };
  roomService: {
    createRoomForSession: (
      session: Session,
      displayName?: string,
    ) => Promise<{
      room: { code: string; joinToken: string };
      memberToken: string;
    }>;
    joinRoomForSession: (
      session: Session,
      roomCode: string,
      joinToken: string,
      displayName?: string,
      previousMemberToken?: string,
    ) => Promise<{ room: { code: string }; memberToken: string }>;
    leaveRoomForSession: (
      session: Session,
      options?: LeaveRoomOptions,
    ) => Promise<{
      room: { code: string } | null;
      notifyRoom?: boolean;
      memberRemoved?: boolean;
      hostTransferred?: boolean;
    }>;
    setRoomMemberPermissionForSession?: (
      session: Session,
      memberToken: string,
      targetMemberId: string,
      permission: Extract<
        ClientMessage,
        { type: "room:member-permission:set" }
      >["payload"]["permission"],
      allowed: boolean,
    ) => Promise<{ room: { code: string } }>;
    kickRoomMemberForSession?: (
      session: Session,
      memberToken: string,
      targetMemberId: string,
    ) => Promise<{
      room: { code: string };
      targetSession: Session;
      targetMemberId: string;
      targetMemberToken: string;
    }>;
    transferRoomHostForSession?: (
      session: Session,
      memberToken: string,
      targetMemberId: string,
    ) => Promise<{ room: { code: string } }>;
    transferDisconnectedHostIfMissing?: (
      roomCode: string,
      ownerMemberId: string,
    ) => Promise<{ room: { code: string } | null; hostTransferred: boolean }>;
    shareVideoForSession: (
      session: Session,
      memberToken: string,
      video: ClientMessage extends never
        ? never
        : Extract<ClientMessage, { type: "video:share" }>["payload"]["video"],
      playback?: ClientMessage extends never
        ? never
        : Extract<
            ClientMessage,
            { type: "video:share" }
          >["payload"]["playback"],
    ) => Promise<{ room: { code: string } }>;
    updatePlaybackForSession: (
      session: Session,
      memberToken: string,
      playback: Extract<
        ClientMessage,
        { type: "playback:update" }
      >["payload"]["playback"],
    ) => Promise<{ room: { code: string } | null; ignored: boolean }>;
    updatePlaybackBufferForSession?: (
      session: Session,
      memberToken: string,
      report: Omit<
        Extract<ClientMessage, { type: "playback:buffer" }>["payload"],
        "memberToken"
      >,
    ) => Promise<{ room: { code: string }; changed?: boolean }>;
    setPlaybackSyncStrategyForSession?: (
      session: Session,
      memberToken: string,
      strategy: Extract<
        ClientMessage,
        { type: "playback:sync-strategy:set" }
      >["payload"]["strategy"],
    ) => Promise<{ room: { code: string } }>;
    updateProfileForSession: (
      session: Session,
      memberToken: string,
      displayName: string,
    ) => Promise<{ room: { code: string } }>;
    getRoomStateForSession: (
      session: Session,
      memberToken: string,
      messageType: ClientMessage["type"],
    ) => Promise<import("./types.js").RoomStoreRoomState>;
    appendChatMessageForSession?: (
      session: Session,
      memberToken: string,
      message: RoomChatMessage,
    ) => Promise<{ room: { code: string } }>;
    appendSystemChatMessageForRoom?: (
      roomCode: string,
      message: RoomChatMessage,
    ) => Promise<{ room: { code: string } } | null>;
    getVoiceMemberAccessForSession?: (
      session: Session,
      memberToken: string,
    ) => Promise<{ roomCode: string; memberId: string; displayName: string }>;
    updateVoiceStateForSession?: (
      session: Session,
      memberToken: string,
      voiceState: { connected: boolean; muted: boolean },
    ) => Promise<{
      roomCode: string;
      memberId: string;
      displayName: string;
      microphoneEnabled: boolean;
    }>;
  };
  voiceService?: {
    issueAccess: (
      session: Session,
      memberToken: string,
    ) => Promise<VoiceAccessDetails>;
  };
  logEvent: LogEvent;
  send: SendMessage;
  sendError: SendError;
  publishRoomEvent: (message: RoomEventBusMessage) => Promise<void>;
  instanceId: string;
  metricsCollector?: Pick<
    MetricsCollector,
    | "observeMessageHandlerDuration"
    | "recordRoomEventPublishDropped"
    | "recordPlaybackStartupFailure"
    | "recordDirectLinkPlaybackOutcome"
    | "recordMemberPlayerError"
  >;
  maxPendingPublishes?: number;
  backpressureWaitMs?: number;
  publishTimeoutMs?: number;
  hostDisconnectTransferGraceMs?: number;
  onRoomJoined?: (
    session: Session,
    roomCode: string,
    previousRoomCode: string | null,
  ) => void | Promise<void>;
  onRoomLeft?: (session: Session, roomCode: string) => void;
  now?: () => number;
}): {
  handleClientMessage: (
    session: Session,
    message: ClientMessage,
  ) => Promise<void>;
  leaveRoom: (session: Session) => Promise<void>;
  flushPendingPublishes: () => Promise<void>;
} {
  const { config, roomService, logEvent, send, sendError } = options;
  const now = options.now ?? Date.now;
  const metricsCollector = options.metricsCollector;
  const pendingPublishes = new Set<Promise<void>>();
  const maxPendingPublishes = options.maxPendingPublishes ?? 256;
  const backpressureWaitMs = options.backpressureWaitMs ?? 5_000;
  const publishTimeoutMs = options.publishTimeoutMs ?? 5_000;
  const hostDisconnectTransferGraceMs =
    options.hostDisconnectTransferGraceMs ?? HOST_DISCONNECT_TRANSFER_GRACE_MS;

  const systemChatSuffix: Record<RoomSystemChatEventType, string> = {
    member_joined: "加入了房间",
    member_left: "离开了房间",
    voice_unmuted: "开启了麦克风",
    voice_muted: "关闭了麦克风",
  };

  function recordPlaybackReport(
    roomCode: string,
    payload: Extract<ClientMessage, { type: "playback:report" }>["payload"],
  ): void {
    if (payload.event === "startup_failure") {
      metricsCollector?.recordPlaybackStartupFailure({
        roomCode,
        providerId: payload.providerId,
        stage: payload.stage ?? "unknown",
      });
      return;
    }

    if (payload.event === "direct_link_success") {
      metricsCollector?.recordDirectLinkPlaybackOutcome({
        roomCode,
        providerId: payload.providerId,
        outcome: "success",
      });
      return;
    }

    if (payload.event === "direct_link_failure") {
      metricsCollector?.recordDirectLinkPlaybackOutcome({
        roomCode,
        providerId: payload.providerId,
        outcome: "failure",
      });
      return;
    }

    if (payload.event === "proxy_fallback") {
      metricsCollector?.recordDirectLinkPlaybackOutcome({
        roomCode,
        providerId: payload.providerId,
        outcome: "proxy_fallback",
      });
      return;
    }

    metricsCollector?.recordMemberPlayerError({
      roomCode,
      providerId: payload.providerId,
      stage: payload.stage ?? "unknown",
      browser: payload.browser ?? "unknown",
      system: payload.system ?? "unknown",
    });
  }

  async function runRoomJoinedHook(
    session: Session,
    roomCode: string,
    previousRoomCode: string | null,
  ): Promise<void> {
    try {
      await options.onRoomJoined?.(session, roomCode, previousRoomCode);
    } catch (error) {
      logEvent("room_join_hook_failed", {
        sessionId: session.id,
        roomCode,
        previousRoomCode,
        remoteAddress: session.remoteAddress,
        origin: session.origin,
        result: "error",
        error: error instanceof Error ? error.message : String(error),
      });
    }
  }

  function runRoomLeftHook(session: Session, roomCode: string): void {
    try {
      options.onRoomLeft?.(session, roomCode);
    } catch (error) {
      logEvent("room_left_hook_failed", {
        sessionId: session.id,
        roomCode,
        remoteAddress: session.remoteAddress,
        origin: session.origin,
        result: "error",
        error: error instanceof Error ? error.message : String(error),
      });
    }
  }

  async function sendRoomStateToSession(
    session: Session,
    memberToken: string,
    messageType: ClientMessage["type"],
  ): Promise<void> {
    if (!hasAttachedSocket(session)) {
      return;
    }
    try {
      const state = await roomService.getRoomStateForSession(
        session,
        memberToken,
        messageType,
      );
      if (!hasAttachedSocket(session)) {
        return;
      }
      send(session.socket, {
        type: "room:state",
        payload: state,
      });
    } catch (error) {
      logEvent("room_state_bootstrap_failed", {
        sessionId: session.id,
        roomCode: session.roomCode,
        remoteAddress: session.remoteAddress,
        origin: session.origin,
        result: "error",
        reason:
          error instanceof RoomServiceError
            ? error.reason
            : "room_state_bootstrap_failed",
      });
    }
  }

  async function firePublishRoomEvent(
    message: RoomEventBusPublishInput<RoomEventBusMessage>,
    context: {
      reason: string;
      sessionId?: string;
      remoteAddress?: string | null;
      origin?: string | null;
    },
  ): Promise<void> {
    const { type, roomCode } = message;
    if (pendingPublishes.size >= maxPendingPublishes) {
      logEvent("room_event_publish_backpressure", {
        sessionId: context.sessionId,
        roomCode,
        remoteAddress: context.remoteAddress,
        origin: context.origin,
        result: "throttled",
        reason: context.reason,
        eventType: type,
        pendingCount: pendingPublishes.size,
        maxPending: maxPendingPublishes,
      });
      // Loop and re-check size synchronously after each wake-up. A slot
      // freeing wakes every concurrent waiter at once; the first one
      // through grabs the slot synchronously (no await between size
      // check and pendingPublishes.add), the rest see the cap is full
      // again and wait another round. Total wait is bounded by an
      // absolute deadline so callers can't be starved past
      // backpressureWaitMs.
      const deadline = now() + backpressureWaitMs;
      while (pendingPublishes.size >= maxPendingPublishes) {
        const remainingMs = deadline - now();
        if (remainingMs <= 0) {
          logEvent("room_event_publish_dropped", {
            sessionId: context.sessionId,
            roomCode,
            remoteAddress: context.remoteAddress,
            origin: context.origin,
            result: "dropped",
            reason: context.reason,
            eventType: type,
            pendingCount: pendingPublishes.size,
            maxPending: maxPendingPublishes,
            waitMs: backpressureWaitMs,
          });
          metricsCollector?.recordRoomEventPublishDropped(type);
          return;
        }
        let waitTimeoutHandle: ReturnType<typeof setTimeout> | null = null;
        const slotFreed = Promise.race(Array.from(pendingPublishes)).then(
          () => "ok" as const,
        );
        const waitTimedOut = new Promise<"timeout">((resolve) => {
          waitTimeoutHandle = setTimeout(() => resolve("timeout"), remainingMs);
        });
        const result = await Promise.race([slotFreed, waitTimedOut]);
        if (waitTimeoutHandle !== null) {
          clearTimeout(waitTimeoutHandle);
        }
        if (result === "timeout") {
          logEvent("room_event_publish_dropped", {
            sessionId: context.sessionId,
            roomCode,
            remoteAddress: context.remoteAddress,
            origin: context.origin,
            result: "dropped",
            reason: context.reason,
            eventType: type,
            pendingCount: pendingPublishes.size,
            maxPending: maxPendingPublishes,
            waitMs: backpressureWaitMs,
          });
          metricsCollector?.recordRoomEventPublishDropped(type);
          return;
        }
      }
    }
    // Bound each publish so a hung bus call (Redis disconnect, slow network)
    // can't pin a slot indefinitely. Track the wrapper rather than the raw
    // publish so:
    //   - The cap reflects what message-handler is willing to wait for, not
    //     the bus's true in-flight count (which the bus driver is responsible
    //     for managing).
    //   - flushPendingPublishes() always drains within publishTimeoutMs
    //     regardless of whether the underlying call ever resolves.
    // The underlying publish keeps running after timeout so the bus can still
    // deliver if it eventually unblocks; we just stop accounting for it here.
    const realPublish = options.publishRoomEvent({
      ...message,
      sourceInstanceId: options.instanceId,
      emittedAt: now(),
    } as RoomEventBusMessage);
    let timeoutHandle: ReturnType<typeof setTimeout> | null = null;
    let timedOut = false;
    const wrapper = Promise.race<"ok" | "timeout">([
      realPublish.then(
        () => "ok" as const,
        (error: unknown) => {
          // If the publish rejects after the timeout has already won, the
          // timeout log captured the incident — suppress the duplicate.
          if (!timedOut) {
            logEvent("room_event_publish_failed", {
              sessionId: context.sessionId,
              roomCode,
              remoteAddress: context.remoteAddress,
              origin: context.origin,
              result: "error",
              reason: context.reason,
              eventType: type,
              error: error instanceof Error ? error.message : String(error),
            });
          }
          return "ok" as const;
        },
      ),
      new Promise<"timeout">((resolve) => {
        timeoutHandle = setTimeout(() => {
          timedOut = true;
          resolve("timeout");
        }, publishTimeoutMs);
      }),
    ]).then((outcome) => {
      if (timeoutHandle !== null) {
        clearTimeout(timeoutHandle);
        timeoutHandle = null;
      }
      if (outcome === "timeout") {
        logEvent("room_event_publish_timeout", {
          sessionId: context.sessionId,
          roomCode,
          remoteAddress: context.remoteAddress,
          origin: context.origin,
          result: "timeout",
          reason: context.reason,
          eventType: type,
          timeoutMs: publishTimeoutMs,
        });
      }
    });
    pendingPublishes.add(wrapper);
    void wrapper.finally(() => {
      pendingPublishes.delete(wrapper);
    });
  }

  async function flushPendingPublishes(): Promise<void> {
    while (pendingPublishes.size > 0) {
      await Promise.allSettled(Array.from(pendingPublishes));
    }
  }

  async function appendSystemChatHistory(args: {
    roomCode: string;
    memberId: string;
    displayName: string;
    eventType: RoomSystemChatEventType;
    timestamp: number;
    session: Session;
    reason: string;
  }): Promise<void> {
    if (!roomService.appendSystemChatMessageForRoom) {
      return;
    }
    try {
      await roomService.appendSystemChatMessageForRoom(args.roomCode, {
        kind: "system",
        systemEventType: args.eventType,
        memberId: args.memberId,
        displayName: args.displayName,
        content: `${args.displayName} ${systemChatSuffix[args.eventType]}`,
        timestamp: args.timestamp,
      });
    } catch (error) {
      logEvent("chat_history_system_persist_failed", {
        sessionId: args.session.id,
        roomCode: args.roomCode,
        memberId: args.memberId,
        remoteAddress: args.session.remoteAddress,
        origin: args.session.origin,
        result: "error",
        reason: args.reason,
        error: error instanceof Error ? error.message : String(error),
      });
    }
  }

  async function leaveRoom(
    session: Session,
    reason: LeaveRoomOptions["reason"] = "disconnect",
  ): Promise<void> {
    const roomCode = session.roomCode;
    const memberId = session.memberId ?? session.id;
    const displayName = session.displayName;
    const { room, notifyRoom, memberRemoved, hostTransferred } =
      await roomService.leaveRoomForSession(session, { reason });
    if (!roomCode || (!room && !notifyRoom)) {
      return;
    }
    runRoomLeftHook(session, roomCode);
    if (!memberRemoved && !notifyRoom) {
      return;
    }

    await appendSystemChatHistory({
      roomCode,
      memberId,
      displayName,
      eventType: "member_left",
      timestamp: now(),
      session,
      reason: "member_left_history_failed",
    });

    await firePublishRoomEvent(
      {
        type: "room_member_left",
        roomCode,
        memberId,
        displayName,
      },
      {
        reason: "leave_room_broadcast_failed",
        sessionId: session.id,
        remoteAddress: session.remoteAddress,
        origin: session.origin,
      },
    );
    if (hostTransferred && room) {
      await firePublishRoomEvent(
        {
          type: "room_state_updated",
          roomCode: room.code,
        },
        {
          reason: "host_transfer_broadcast_failed",
          sessionId: session.id,
          remoteAddress: session.remoteAddress,
          origin: session.origin,
        },
      );
    }
    if (
      reason === "disconnect" &&
      memberRemoved &&
      room &&
      roomService.transferDisconnectedHostIfMissing
    ) {
      // Closing a tab and refreshing both surface as WebSocket disconnects.
      // Wait briefly so a refreshed host can reclaim the same member token
      // before we promote the next still-online member.
      const transferTimer = setTimeout(() => {
        void (async () => {
          try {
            const transfer =
              await roomService.transferDisconnectedHostIfMissing!(
                roomCode,
                memberId,
              );
            if (!transfer.hostTransferred || !transfer.room) {
              return;
            }
            await firePublishRoomEvent(
              {
                type: "room_state_updated",
                roomCode: transfer.room.code,
              },
              {
                reason: "host_disconnect_transfer_broadcast_failed",
                sessionId: session.id,
                remoteAddress: session.remoteAddress,
                origin: session.origin,
              },
            );
          } catch (error) {
            logEvent("host_disconnect_transfer_failed", {
              sessionId: session.id,
              roomCode,
              memberId,
              remoteAddress: session.remoteAddress,
              origin: session.origin,
              result: "error",
              error: error instanceof Error ? error.message : String(error),
            });
          }
        })();
      }, hostDisconnectTransferGraceMs);
      transferTimer.unref?.();
    }
  }

  function handleRateLimitedMessage(
    session: Session,
    messageType: string,
  ): void {
    logEvent("rate_limited", {
      sessionId: session.id,
      roomCode: session.roomCode,
      remoteAddress: session.remoteAddress,
      origin: session.origin,
      messageType,
      result: "rejected",
    });
  }

  function getFixedWindowRetryAfterMs(args: {
    windowStart: number;
    windowMs: number;
    currentTime: number;
  }): number {
    const elapsedMs = Math.max(0, args.currentTime - args.windowStart);
    return Math.max(1, Math.ceil(args.windowMs - elapsedMs));
  }

  async function measureMessageHandling(
    messageType: MonitoredMessageType,
    handler: () => Promise<void>,
  ): Promise<void> {
    const startedAt = performance.now();
    try {
      await handler();
    } finally {
      metricsCollector?.observeMessageHandlerDuration(
        messageType,
        performance.now() - startedAt,
      );
    }
  }

  function checkProtocolVersion(
    session: Session,
    socket: WebSocket,
    clientVersion: number | undefined,
  ): boolean {
    if (clientVersion === undefined) {
      // Old extension without protocolVersion — compatible baseline, log deprecation
      session.protocolVersion = MIN_PROTOCOL_VERSION;
      logEvent("protocol_version_missing", {
        sessionId: session.id,
        remoteAddress: session.remoteAddress,
        origin: session.origin,
        result: "accepted",
        reason: "legacy_client",
      });
      return true;
    }
    if (clientVersion < MIN_PROTOCOL_VERSION) {
      sendError(
        socket,
        "unsupported_protocol_version",
        UNSUPPORTED_PROTOCOL_VERSION_MESSAGE,
      );
      logEvent("protocol_version_rejected", {
        sessionId: session.id,
        remoteAddress: session.remoteAddress,
        origin: session.origin,
        result: "rejected",
        clientVersion,
        minVersion: MIN_PROTOCOL_VERSION,
      });
      return false;
    }
    session.protocolVersion = clientVersion;
    return true;
  }

  async function handleClientMessage(
    session: Session,
    message: ClientMessage,
  ): Promise<void> {
    const currentTime = now();
    if (!hasAttachedSocket(session)) {
      throw new Error(
        `Detached session cannot process client message: ${session.id}.`,
      );
    }
    const socket = session.socket;

    try {
      switch (message.type) {
        case "room:create": {
          const previousRoomCode = session.roomCode;
          if (
            !consumeFixedWindow(
              session.rateLimitState.roomCreate,
              config.rateLimits.roomCreatePerMinute,
              WINDOW_MINUTE_MS,
              currentTime,
            )
          ) {
            handleRateLimitedMessage(session, message.type);
            sendError(socket, "rate_limited", RATE_LIMITED_MESSAGE);
            return;
          }
          if (
            !checkProtocolVersion(
              session,
              socket,
              message.payload?.protocolVersion,
            )
          ) {
            return;
          }

          const { room, memberToken } = await roomService.createRoomForSession(
            session,
            message.payload?.displayName,
          );
          if (previousRoomCode && previousRoomCode !== room.code) {
            runRoomLeftHook(session, previousRoomCode);
          }
          await runRoomJoinedHook(session, room.code, previousRoomCode);
          await appendSystemChatHistory({
            roomCode: room.code,
            memberId: session.memberId ?? session.id,
            displayName: session.displayName,
            eventType: "member_joined",
            timestamp: currentTime,
            session,
            reason: "member_joined_history_failed",
          });
          send(socket, {
            type: "room:created",
            payload: {
              roomCode: room.code,
              memberId: session.memberId ?? session.id,
              joinToken: room.joinToken,
              memberToken,
              serverProtocolVersion: CURRENT_PROTOCOL_VERSION,
            },
          });
          await sendRoomStateToSession(session, memberToken, message.type);
          logEvent("room_created", {
            sessionId: session.id,
            roomCode: room.code,
            memberId: session.memberId ?? session.id,
            displayName: session.displayName,
            remoteAddress: session.remoteAddress,
            origin: session.origin,
            result: "ok",
          });
          return;
        }
        case "room:join": {
          const previousRoomCode = session.roomCode;
          if (
            !consumeFixedWindow(
              session.rateLimitState.roomJoin,
              config.rateLimits.roomJoinPerMinute,
              WINDOW_MINUTE_MS,
              currentTime,
            )
          ) {
            handleRateLimitedMessage(session, message.type);
            sendError(socket, "rate_limited", RATE_LIMITED_MESSAGE);
            return;
          }
          if (
            !checkProtocolVersion(
              session,
              socket,
              message.payload.protocolVersion,
            )
          ) {
            return;
          }

          await measureMessageHandling("room:join", async () => {
            const { room, memberToken } = await roomService.joinRoomForSession(
              session,
              message.payload.roomCode,
              message.payload.joinToken,
              message.payload.displayName,
              message.payload.memberToken,
            );
            if (previousRoomCode && previousRoomCode !== room.code) {
              runRoomLeftHook(session, previousRoomCode);
            }
            await runRoomJoinedHook(session, room.code, previousRoomCode);
            const joinedRoomCode = room.code;
            const joinedMemberId = session.memberId ?? session.id;
            const joinedDisplayName = session.displayName;
            await appendSystemChatHistory({
              roomCode: joinedRoomCode,
              memberId: joinedMemberId,
              displayName: joinedDisplayName,
              eventType: "member_joined",
              timestamp: currentTime,
              session,
              reason: "member_joined_history_failed",
            });
            send(socket, {
              type: "room:joined",
              payload: {
                roomCode: joinedRoomCode,
                memberId: joinedMemberId,
                memberToken,
                serverProtocolVersion: CURRENT_PROTOCOL_VERSION,
              },
            });
            await sendRoomStateToSession(session, memberToken, message.type);
            if (
              session.roomCode !== joinedRoomCode ||
              session.memberId !== joinedMemberId
            ) {
              logEvent("room_join_delta_skipped", {
                sessionId: session.id,
                roomCode: joinedRoomCode,
                memberId: joinedMemberId,
                remoteAddress: session.remoteAddress,
                origin: session.origin,
                result: "skipped",
                reason: "session_no_longer_joined",
              });
              return;
            }
            await firePublishRoomEvent(
              {
                type: "room_member_joined",
                roomCode: joinedRoomCode,
                memberId: joinedMemberId,
                displayName: joinedDisplayName,
              },
              {
                reason: "join_room_broadcast_failed",
                sessionId: session.id,
                remoteAddress: session.remoteAddress,
                origin: session.origin,
              },
            );
            logEvent("room_joined", {
              sessionId: session.id,
              roomCode: joinedRoomCode,
              memberId: joinedMemberId,
              displayName: joinedDisplayName,
              remoteAddress: session.remoteAddress,
              origin: session.origin,
              result: "ok",
            });
          });
          return;
        }
        case "room:leave": {
          if (
            message.payload?.memberToken &&
            session.memberToken &&
            message.payload.memberToken !== session.memberToken
          ) {
            sendError(
              socket,
              "member_token_invalid",
              MEMBER_TOKEN_INVALID_MESSAGE,
            );
            return;
          }
          await measureMessageHandling("room:leave", () =>
            leaveRoom(session, "explicit"),
          );
          return;
        }
        case "room:member-permission:set": {
          const result = await roomService.setRoomMemberPermissionForSession!(
            session,
            message.payload.memberToken,
            message.payload.targetMemberId,
            message.payload.permission,
            message.payload.allowed,
          );
          await firePublishRoomEvent(
            {
              type: "room_state_updated",
              roomCode: result.room.code,
            },
            {
              reason: "member_permission_broadcast_failed",
              sessionId: session.id,
              remoteAddress: session.remoteAddress,
              origin: session.origin,
            },
          );
          return;
        }
        case "room:member:kick": {
          const result = await roomService.kickRoomMemberForSession!(
            session,
            message.payload.memberToken,
            message.payload.targetMemberId,
          );
          if (hasAttachedSocket(result.targetSession)) {
            const targetSocket = result.targetSession.socket;
            sendError(targetSocket, "member_kicked", MEMBER_KICKED_MESSAGE, {
              messageType: message.type,
            });
            targetSocket.close(1000, MEMBER_KICKED_MESSAGE);
          }
          await firePublishRoomEvent(
            {
              type: "room_member_left",
              roomCode: result.room.code,
              memberId: result.targetMemberId,
              displayName: result.targetSession.displayName,
            },
            {
              reason: "member_kick_broadcast_failed",
              sessionId: session.id,
              remoteAddress: session.remoteAddress,
              origin: session.origin,
            },
          );
          return;
        }
        case "room:host:transfer": {
          const result = await roomService.transferRoomHostForSession!(
            session,
            message.payload.memberToken,
            message.payload.targetMemberId,
          );
          await firePublishRoomEvent(
            {
              type: "room_state_updated",
              roomCode: result.room.code,
            },
            {
              reason: "host_transfer_broadcast_failed",
              sessionId: session.id,
              remoteAddress: session.remoteAddress,
              origin: session.origin,
            },
          );
          return;
        }
        case "profile:update": {
          const { room } = await roomService.updateProfileForSession(
            session,
            message.payload.memberToken,
            message.payload.displayName,
          );
          await firePublishRoomEvent(
            {
              type: "room_state_updated",
              roomCode: room.code,
            },
            {
              reason: "profile_update_broadcast_failed",
              sessionId: session.id,
              remoteAddress: session.remoteAddress,
              origin: session.origin,
            },
          );
          return;
        }
        case "video:share": {
          if (
            !consumeFixedWindow(
              session.rateLimitState.videoShare,
              config.rateLimits.videoSharePer10Seconds,
              WINDOW_10_SECONDS_MS,
              currentTime,
            )
          ) {
            handleRateLimitedMessage(session, message.type);
            sendError(socket, "rate_limited", RATE_LIMITED_MESSAGE);
            return;
          }

          await measureMessageHandling("video:share", async () => {
            const { room } = await roomService.shareVideoForSession(
              session,
              message.payload.memberToken,
              message.payload.video,
              message.payload.playback,
            );
            await firePublishRoomEvent(
              {
                type: "room_state_updated",
                roomCode: room.code,
              },
              {
                reason: "video_share_broadcast_failed",
                sessionId: session.id,
                remoteAddress: session.remoteAddress,
                origin: session.origin,
              },
            );
          });
          return;
        }
        case "playback:update": {
          if (
            !consumeTokenBucket(
              session.rateLimitState.playbackUpdate,
              config.rateLimits.playbackUpdatePerSecond,
              config.rateLimits.playbackUpdateBurst,
              currentTime,
            )
          ) {
            handleRateLimitedMessage(session, message.type);
            return;
          }

          await measureMessageHandling("playback:update", async () => {
            const result = await roomService.updatePlaybackForSession(
              session,
              message.payload.memberToken,
              message.payload.playback,
            );
            if (!result.ignored && result.room) {
              await firePublishRoomEvent(
                {
                  type: "room_state_updated",
                  roomCode: result.room.code,
                },
                {
                  reason: "playback_update_broadcast_failed",
                  sessionId: session.id,
                  remoteAddress: session.remoteAddress,
                  origin: session.origin,
                },
              );
            }
          });
          return;
        }
        case "playback:buffer": {
          await measureMessageHandling("playback:buffer", async () => {
            const serviceResult =
              await roomService.updatePlaybackBufferForSession?.(
                session,
                message.payload.memberToken,
                {
                  state: message.payload.state,
                  currentTime: message.payload.currentTime,
                  ...(message.payload.bufferAheadSeconds === undefined
                    ? {}
                    : {
                        bufferAheadSeconds: message.payload.bufferAheadSeconds,
                      }),
                  ...(message.payload.playbackRevision === undefined
                    ? {}
                    : {
                        playbackRevision: message.payload.playbackRevision,
                      }),
                },
              );
            if (serviceResult?.changed === false) {
              return;
            }
            if (serviceResult) {
              await firePublishRoomEvent(
                {
                  type: "room_state_updated",
                  roomCode: serviceResult.room.code,
                },
                {
                  reason: "playback_buffer_broadcast_failed",
                  sessionId: session.id,
                  remoteAddress: session.remoteAddress,
                  origin: session.origin,
                },
              );
            } else {
              await roomService.getRoomStateForSession(
                session,
                message.payload.memberToken,
                message.type,
              );
            }
          });
          return;
        }
        case "playback:sync-strategy:set": {
          await measureMessageHandling(
            "playback:sync-strategy:set",
            async () => {
              const serviceResult =
                await roomService.setPlaybackSyncStrategyForSession?.(
                  session,
                  message.payload.memberToken,
                  message.payload.strategy,
                );
              if (serviceResult) {
                await firePublishRoomEvent(
                  {
                    type: "room_state_updated",
                    roomCode: serviceResult.room.code,
                  },
                  {
                    reason: "playback_sync_strategy_broadcast_failed",
                    sessionId: session.id,
                    remoteAddress: session.remoteAddress,
                    origin: session.origin,
                  },
                );
              } else {
                await roomService.getRoomStateForSession(
                  session,
                  message.payload.memberToken,
                  message.type,
                );
              }
            },
          );
          return;
        }
        case "sync:request": {
          if (
            !consumeFixedWindow(
              session.rateLimitState.syncRequest,
              config.rateLimits.syncRequestPer10Seconds,
              WINDOW_10_SECONDS_MS,
              currentTime,
            )
          ) {
            const retryAfterMs = getFixedWindowRetryAfterMs({
              windowStart: session.rateLimitState.syncRequest.windowStart,
              windowMs: WINDOW_10_SECONDS_MS,
              currentTime,
            });
            handleRateLimitedMessage(session, message.type);
            sendError(socket, "rate_limited", RATE_LIMITED_MESSAGE, {
              messageType: message.type,
              retryAfterMs,
            });
            return;
          }

          const state = await roomService.getRoomStateForSession(
            session,
            message.payload.memberToken,
            message.type,
          );
          send(socket, {
            type: "room:state",
            payload: state,
          });
          return;
        }
        case "chat:message": {
          if (
            !consumeFixedWindow(
              session.rateLimitState.chatMessage,
              config.rateLimits.chatMessagePer5Seconds,
              WINDOW_5_SECONDS_MS,
              currentTime,
            )
          ) {
            const retryAfterMs = getFixedWindowRetryAfterMs({
              windowStart: session.rateLimitState.chatMessage.windowStart,
              windowMs: WINDOW_5_SECONDS_MS,
              currentTime,
            });
            handleRateLimitedMessage(session, message.type);
            sendError(socket, "chat_rate_limited", CHAT_RATE_LIMITED_MESSAGE, {
              messageType: message.type,
              retryAfterMs,
            });
            return;
          }

          const chatMessage = {
            memberId: session.memberId ?? session.id,
            displayName: session.displayName,
            content: message.payload.content,
            timestamp: currentTime,
          };
          const stored = await roomService.appendChatMessageForSession?.(
            session,
            message.payload.memberToken,
            chatMessage,
          );
          if (!stored) {
            await roomService.getRoomStateForSession(
              session,
              message.payload.memberToken,
              message.type,
            );
          }
          const roomCode = stored?.room.code ?? session.roomCode;
          if (!roomCode) {
            sendError(socket, "not_in_room", "Join a room first.");
            return;
          }

          await firePublishRoomEvent(
            {
              type: "room_chat_message",
              roomCode,
              ...chatMessage,
            },
            {
              reason: "chat_message_broadcast_failed",
              sessionId: session.id,
              remoteAddress: session.remoteAddress,
              origin: session.origin,
            },
          );
          logEvent("chat_message_sent", {
            sessionId: session.id,
            roomCode,
            memberId: session.memberId ?? session.id,
            remoteAddress: session.remoteAddress,
            origin: session.origin,
            result: "ok",
          });
          return;
        }
        case "danmaku:message": {
          if (
            !consumeFixedWindow(
              session.rateLimitState.danmakuMessage,
              config.rateLimits.danmakuMessagePer5Seconds,
              WINDOW_5_SECONDS_MS,
              currentTime,
            )
          ) {
            const retryAfterMs = getFixedWindowRetryAfterMs({
              windowStart: session.rateLimitState.danmakuMessage.windowStart,
              windowMs: WINDOW_5_SECONDS_MS,
              currentTime,
            });
            handleRateLimitedMessage(session, message.type);
            sendError(
              socket,
              "chat_rate_limited",
              DANMAKU_RATE_LIMITED_MESSAGE,
              {
                messageType: message.type,
                retryAfterMs,
              },
            );
            return;
          }

          await roomService.getRoomStateForSession(
            session,
            message.payload.memberToken,
            message.type,
          );
          const roomCode = session.roomCode;
          if (!roomCode) {
            sendError(socket, "not_in_room", "Join a room first.");
            return;
          }

          await firePublishRoomEvent(
            {
              type: "room_danmaku_message",
              roomCode,
              memberId: session.memberId ?? session.id,
              displayName: session.displayName,
              content: message.payload.content,
              videoTime: message.payload.videoTime,
              mode: message.payload.mode ?? "scroll",
              color: message.payload.color ?? "#ffffff",
              timestamp: currentTime,
            },
            {
              reason: "danmaku_message_broadcast_failed",
              sessionId: session.id,
              remoteAddress: session.remoteAddress,
              origin: session.origin,
            },
          );
          logEvent("danmaku_message_sent", {
            sessionId: session.id,
            roomCode,
            memberId: session.memberId ?? session.id,
            remoteAddress: session.remoteAddress,
            origin: session.origin,
            result: "ok",
          });
          return;
        }
        case "playback:report": {
          const state = await roomService.getRoomStateForSession(
            session,
            message.payload.memberToken,
            message.type,
          );
          recordPlaybackReport(
            session.roomCode ?? state.roomCode,
            message.payload,
          );
          return;
        }
        case "sync:ping": {
          if (
            !consumeTokenBucket(
              session.rateLimitState.syncPing,
              config.rateLimits.syncPingPerSecond,
              config.rateLimits.syncPingBurst,
              currentTime,
            )
          ) {
            handleRateLimitedMessage(session, message.type);
            return;
          }

          send(socket, {
            type: "sync:pong",
            payload: {
              clientSendTime: message.payload.clientSendTime,
              serverReceiveTime: currentTime,
              serverSendTime: now(),
            },
          });
          return;
        }
        case "voice:access": {
          if (!options.voiceService) {
            sendError(socket, "voice_unavailable", VOICE_UNAVAILABLE_MESSAGE);
            logEvent("voice_access_rejected", {
              sessionId: session.id,
              roomCode: session.roomCode,
              remoteAddress: session.remoteAddress,
              origin: session.origin,
              result: "rejected",
              reason: "voice_unavailable",
            });
            return;
          }

          const access = await options.voiceService.issueAccess(
            session,
            message.payload.memberToken,
          );
          send(socket, {
            type: "voice:access-granted",
            payload: access,
          });
          logEvent("voice_access_granted", {
            sessionId: session.id,
            roomCode: session.roomCode,
            memberId: session.memberId ?? session.id,
            remoteAddress: session.remoteAddress,
            origin: session.origin,
            result: "ok",
          });
          return;
        }
        case "voice:state": {
          if (
            !roomService.updateVoiceStateForSession &&
            !roomService.getVoiceMemberAccessForSession
          ) {
            sendError(socket, "voice_unavailable", VOICE_UNAVAILABLE_MESSAGE);
            return;
          }

          const previousMicrophoneEnabled =
            session.voiceState?.microphoneEnabled ?? false;
          const memberAccess = roomService.updateVoiceStateForSession
            ? await roomService.updateVoiceStateForSession(
                session,
                message.payload.memberToken,
                {
                  connected: message.payload.connected,
                  muted: message.payload.muted,
                },
              )
            : await roomService.getVoiceMemberAccessForSession!(
                session,
                message.payload.memberToken,
              );
          const microphoneEnabled =
            message.payload.connected && !message.payload.muted;
          if (previousMicrophoneEnabled !== microphoneEnabled) {
            await appendSystemChatHistory({
              roomCode: memberAccess.roomCode,
              memberId: memberAccess.memberId,
              displayName: memberAccess.displayName,
              eventType: microphoneEnabled ? "voice_unmuted" : "voice_muted",
              timestamp: currentTime,
              session,
              reason: "voice_state_history_failed",
            });
          }
          await firePublishRoomEvent(
            {
              type: "voice_state_updated",
              roomCode: memberAccess.roomCode,
              memberId: memberAccess.memberId,
              connected: message.payload.connected,
              muted: message.payload.muted,
              ...(message.payload.speaking === undefined
                ? {}
                : { speaking: message.payload.speaking }),
            },
            {
              reason: "voice_state_broadcast_failed",
              sessionId: session.id,
              remoteAddress: session.remoteAddress,
              origin: session.origin,
            },
          );
          return;
        }
        default: {
          const exhaustiveCheck: never = message;
          return exhaustiveCheck;
        }
      }
    } catch (error) {
      if (error instanceof VoiceServiceError) {
        sendError(socket, error.code, error.message);
        logEvent("voice_access_rejected", {
          sessionId: session.id,
          roomCode: session.roomCode,
          remoteAddress: session.remoteAddress,
          origin: session.origin,
          result: "rejected",
          reason: error.reason,
        });
        return;
      }

      if (error instanceof RoomServiceError) {
        sendError(socket, error.code, error.message);
        if (error.reason === "internal_error") {
          logEvent("room_persist_failed", {
            sessionId: session.id,
            roomCode: session.roomCode,
            remoteAddress: session.remoteAddress,
            origin: session.origin,
            result: "error",
            reason: error.reason,
          });
        }
        return;
      }

      throw error;
    }
  }

  return {
    handleClientMessage,
    leaveRoom,
    flushPendingPublishes,
  };
}
