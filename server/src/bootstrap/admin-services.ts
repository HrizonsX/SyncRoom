import type { IncomingMessage } from "node:http";
import type { AnnouncementState, ServerMessage } from "@syncroom/protocol";
import type { WebSocket } from "ws";
import {
  AdminActionError,
  createAdminActionService,
} from "../admin/action-service.js";
import {
  AnnouncementValidationError,
  type AnnouncementStore,
} from "../announcement-store.js";
import type { AdminCommandBus } from "../admin-command-bus.js";
import { createAuditLogService } from "../admin/audit-log.js";
import { createInMemoryAdminSessionStore } from "../admin/auth-store.js";
import { createAdminAuthService } from "../admin/auth-service.js";
import { createAdminConfigService } from "../admin/config-service.js";
import { createAdminLoginRateLimiter } from "../admin/login-rate-limit.js";
import type { IpBlockStore } from "../admin/ip-block-store.js";
import type { GlobalAuditStore } from "../admin/global-audit-store.js";
import type { GlobalEventStore } from "../admin/global-event-store.js";
import type { MetricsCollector } from "../admin/metrics.js";
import { createAdminOverviewService } from "../admin/overview-service.js";
import { createAdminRoomQueryService } from "../admin/room-query-service.js";
import { createRedisAuditStore } from "../admin/redis-audit-store.js";
import { createAdminRouter } from "../admin/router.js";
import type { AdminSession } from "../admin/types.js";
import type { AdminSessionStore } from "../admin-session-store.js";
import { createRedisAdminSessionStore } from "../redis-admin-session-store.js";
import {
  getRedisAdminSessionKeyPrefix,
  getRedisAuditStreamKey,
} from "../redis-namespace.js";
import { createRoomService } from "../room-service.js";
import type { RoomEventBusMessage } from "../room-event-bus.js";
import type { RoomStore } from "../room-store.js";
import type { RuntimeStore } from "../runtime-store.js";
import type {
  AdminConfig,
  LogEvent,
  PersistenceConfig,
  SecurityConfig,
  Session,
} from "../types.js";
import { hasAttachedSocket } from "../types.js";

export function createAdminServices(args: {
  securityConfig: SecurityConfig;
  persistenceConfig: PersistenceConfig;
  roomStore: RoomStore;
  runtimeStore: RuntimeStore;
  eventStore: GlobalEventStore;
  roomService: ReturnType<typeof createRoomService>;
  announcementStore: AnnouncementStore;
  send: (socket: WebSocket, message: ServerMessage) => void;
  listAnnouncementPushSessions: () => Promise<Session[]>;
  publishRoomEvent: (message: RoomEventBusMessage) => Promise<void>;
  requestAdminCommand: AdminCommandBus["request"];
  logEvent: LogEvent;
  metricsCollector: MetricsCollector;
  now: () => number;
  adminConfig?: AdminConfig;
  ipBlockStore: IpBlockStore;
  serviceVersion: string;
  serviceName?: string;
  createOverviewService?: typeof createAdminOverviewService;
  createRoomQueryService?: typeof createAdminRoomQueryService;
  getRequestIpKey?: (request: IncomingMessage) => string;
  adminSessionStoreOverride?: AdminSessionStore;
}): Promise<{
  adminRouter: ReturnType<typeof createAdminRouter>;
  close: () => Promise<void>;
}> {
  return (async () => {
    let auditLogService: GlobalAuditStore = createAuditLogService();
    let adminSessionStore: AdminSessionStore | undefined;
    let closeAdminSessionStore: (() => Promise<void>) | undefined;
    let closeAuditLogService: (() => Promise<void>) | undefined;

    if (args.adminConfig) {
      if (args.adminSessionStoreOverride) {
        adminSessionStore = args.adminSessionStoreOverride;
      } else if (args.adminConfig.sessionStoreProvider === "redis") {
        const redisAdminSessionStore = await createRedisAdminSessionStore(
          args.persistenceConfig.redisUrl,
          {
            keyPrefix: getRedisAdminSessionKeyPrefix(
              args.persistenceConfig.redisNamespace,
            ),
          },
        );
        adminSessionStore = redisAdminSessionStore;
        closeAdminSessionStore = redisAdminSessionStore.close;
      } else {
        adminSessionStore = createInMemoryAdminSessionStore();
      }

      if (args.adminConfig.auditStoreProvider === "redis") {
        const redisAuditStore = await createRedisAuditStore(
          args.persistenceConfig.redisUrl,
          {
            streamKey: getRedisAuditStreamKey(
              args.persistenceConfig.redisNamespace,
            ),
          },
        );
        auditLogService = redisAuditStore;
        closeAuditLogService = redisAuditStore.close;
      }
    }

    const createOverviewService =
      args.createOverviewService ?? createAdminOverviewService;
    const createRoomQueryService =
      args.createRoomQueryService ?? createAdminRoomQueryService;
    const authService =
      args.adminConfig && adminSessionStore
        ? createAdminAuthService(args.adminConfig, adminSessionStore, args.now)
        : undefined;
    const loginRateLimiter = authService
      ? createAdminLoginRateLimiter(
          {
            failuresPerIpPerMinute:
              args.securityConfig.rateLimits.adminLoginFailuresPerIpPerMinute,
            failuresPerUsernamePerMinute:
              args.securityConfig.rateLimits
                .adminLoginFailuresPerUsernamePerMinute,
          },
          args.now,
        )
      : undefined;
    const overviewService = createOverviewService({
      instanceId: args.persistenceConfig.instanceId,
      serviceName: args.serviceName ?? "syncroom-server",
      serviceVersion: args.serviceVersion,
      persistenceConfig: args.persistenceConfig,
      roomStore: args.roomStore,
      runtimeStore: args.runtimeStore,
      eventStore: args.eventStore,
      now: args.now,
    });
    const roomQueryService = createRoomQueryService({
      instanceId: args.persistenceConfig.instanceId,
      roomStore: args.roomStore,
      runtimeStore: args.runtimeStore,
      eventStore: args.eventStore,
    });
    const metricsService = args.metricsCollector;
    const configService = createAdminConfigService({
      adminConfig: args.adminConfig ?? null,
      persistenceConfig: args.persistenceConfig,
      securityConfig: args.securityConfig,
    });

    async function publishRoomStateUpdate(roomCode: string): Promise<void> {
      await args.publishRoomEvent({
        type: "room_state_updated",
        roomCode,
        sourceInstanceId: args.persistenceConfig.instanceId,
        emittedAt: args.now(),
      });
    }

    async function broadcastAnnouncementUpdate(
      state: AnnouncementState,
    ): Promise<{ pushedSessionCount: number; failedSessionCount: number }> {
      const sessions = await args.listAnnouncementPushSessions();
      let pushedSessionCount = 0;
      let failedSessionCount = 0;
      for (const session of sessions) {
        if (!hasAttachedSocket(session)) {
          continue;
        }
        try {
          args.send(session.socket, {
            type: "announcement:update",
            payload: state,
          });
          pushedSessionCount += 1;
        } catch {
          failedSessionCount += 1;
        }
      }
      return { pushedSessionCount, failedSessionCount };
    }

    async function updateAnnouncements(
      actor: AdminSession,
      items: unknown,
    ): Promise<AnnouncementState> {
      let state: AnnouncementState;
      try {
        state = args.announcementStore.replaceItems(items);
      } catch (error) {
        if (error instanceof AnnouncementValidationError) {
          throw new AdminActionError(400, "input_invalid", error.message);
        }
        throw error;
      }

      const { pushedSessionCount, failedSessionCount } =
        await broadcastAnnouncementUpdate(state);
      args.logEvent("admin_announcements_updated", {
        result: "ok",
        actor: actor.username,
        itemCount: state.items.length,
        pushedSessionCount,
        failedSessionCount,
      });
      return state;
    }

    const actionService = createAdminActionService({
      instanceId: args.persistenceConfig.instanceId,
      roomStore: args.roomStore,
      runtimeStore: args.runtimeStore,
      listClusterSessions: () => args.runtimeStore.listClusterSessions(),
      listClusterSessionsByRoom: (roomCode) =>
        args.runtimeStore.listClusterSessionsByRoom(roomCode),
      requestAdminCommand: args.requestAdminCommand,
      auditLogService,
      ipBlockStore: args.ipBlockStore,
      getRoomStateByCode: (roomCode) =>
        args.roomService.getRoomStateByCode(roomCode),
      publishRoomStateUpdate,
      publishRoomDeleted: async (roomCode) => {
        await args.publishRoomEvent({
          type: "room_deleted",
          roomCode,
          sourceInstanceId: args.persistenceConfig.instanceId,
          emittedAt: args.now(),
        });
      },
      logEvent: args.logEvent,
      now: args.now,
    });

    const adminRouter = createAdminRouter({
      getConfigSummary: () => configService.getSummary(),
      getMetrics: () => metricsService.render(),
      authService,
      roomStoreReady: () => args.roomStore.isReady(),
      getAnnouncements: () => args.announcementStore.getState(),
      updateAnnouncements,
      getOverview: () => overviewService.getOverview(),
      listRooms: (query: import("../admin/types.js").RoomListQuery) =>
        roomQueryService.listRooms(query),
      getRoomDetail: (roomCode: string) =>
        roomQueryService.getRoomDetail(roomCode),
      listIpBlocks: () => actionService.listIpBlocks(),
      listAuditLogs: (query: import("../admin/types.js").AuditLogQuery) =>
        Promise.resolve(auditLogService.query(query)),
      blockIp: (actor: AdminSession, ip: string, reason?: string) =>
        actionService.blockIp(actor, ip, reason),
      unblockIp: (actor: AdminSession, ip: string, reason?: string) =>
        actionService.unblockIp(actor, ip, reason),
      closeRoom: (actor: AdminSession, roomCode: string, reason?: string) =>
        actionService.closeRoom(actor, roomCode, reason),
      expireRoom: (actor: AdminSession, roomCode: string, reason?: string) =>
        actionService.expireRoom(actor, roomCode, reason),
      clearRoomVideo: (
        actor: AdminSession,
        roomCode: string,
        reason?: string,
      ) => actionService.clearRoomVideo(actor, roomCode, reason),
      kickMember: (
        actor: AdminSession,
        roomCode: string,
        memberId: string,
        reason?: string,
      ) => actionService.kickMember(actor, roomCode, memberId, reason),
      disconnectSession: (
        actor: AdminSession,
        sessionId: string,
        reason?: string,
      ) => actionService.disconnectSession(actor, sessionId, reason),
      eventStore: args.eventStore,
      serviceName: args.serviceName ?? "syncroom-server",
      now: args.now,
      writeOriginPolicy: {
        allowedOrigins: args.securityConfig.allowedOrigins,
      },
      loginRateLimiter,
      getRequestIpKey: args.getRequestIpKey,
    });

    return {
      adminRouter,
      async close() {
        await closeAdminSessionStore?.();
        await closeAuditLogService?.();
      },
    };
  })();
}
