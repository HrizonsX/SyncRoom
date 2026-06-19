import type { ClientMessage, ServerMessage } from "@syncroom/protocol";
import { isServerMessage, PROTOCOL_VERSION } from "@syncroom/protocol";
import type { DebugLogEntry } from "../shared/messages";
import type { ConnectionState, RoomSessionState } from "./runtime-state";
import { getConnectionErrorMessage } from "./connection-error";
import { getExtensionOrigin } from "../shared/extension-origin";
import {
  shouldReconnect as shouldScheduleReconnect,
  getReconnectDelayMs,
} from "./socket-manager";
import { validateServerUrl } from "./server-url";

export interface SocketController {
  connect(): Promise<void>;
  scheduleReconnect(): void;
  clearReconnectTimer(): void;
  getRetryInMs(): number | null;
  resetReconnectState(): void;
}

export function createSocketController(args: {
  connectionState: ConnectionState;
  roomSessionState: RoomSessionState;
  maxReconnectAttempts: number;
  log: (scope: DebugLogEntry["scope"], message: string) => void;
  logInvalidServerUrl: (context: string, invalidUrl: string) => void;
  logConnectionProbeFailure: (details: {
    stage: "connection-check" | "healthcheck" | "websocket";
    serverUrl: string;
    reason?: string | null;
    extensionOrigin?: string | null;
    readyState?: number | null;
  }) => void;
  notifyAll: () => void;
  stopClockSyncTimer: () => void;
  syncClock: () => void;
  startClockSyncTimer: () => void;
  clearPendingLocalShare: (reason: string) => void;
  sendJoinRequest: (targetRoomCode: string, targetJoinToken: string) => void;
  sendToServer: (message: ClientMessage) => void;
  handleServerMessage: (message: ServerMessage) => Promise<void>;
  buildConnectionCheckUrl: (serverUrl: string) => string | null;
  buildHealthcheckUrl: (serverUrl: string) => string | null;
  onOpen: () => void;
  onAdminSessionReset: (reason: string) => void;
  formatAdminSessionResetReason: (reason: string) => string;
  reconnectFailedMessage: () => string;
  persistState?: () => Promise<void> | void;
}): SocketController {
  async function connect(): Promise<void> {
    if (
      args.connectionState.socket &&
      (args.connectionState.socket.readyState === WebSocket.OPEN ||
        args.connectionState.socket.readyState === WebSocket.CONNECTING)
    ) {
      return;
    }
    const serverUrlResult = validateServerUrl(args.connectionState.serverUrl);
    if ("message" in serverUrlResult) {
      args.connectionState.lastError = serverUrlResult.message;
      args.connectionState.connected = false;
      args.stopClockSyncTimer();
      args.logInvalidServerUrl("connect", args.connectionState.serverUrl);
      args.notifyAll();
      return;
    }

    if (args.connectionState.connectProbe) {
      if (
        args.connectionState.connectProbeServerUrl ===
        serverUrlResult.normalizedUrl
      ) {
        return args.connectionState.connectProbe;
      }
      args.connectionState.connectProbeAbortController?.abort();
    }

    clearReconnectTimer();
    args.log("background", `Connecting to ${serverUrlResult.normalizedUrl}`);
    const abortController = new AbortController();
    const connectProbe = openSocketWithProbe(
      serverUrlResult.normalizedUrl,
      abortController.signal,
    );
    args.connectionState.connectProbe = connectProbe;
    args.connectionState.connectProbeServerUrl = serverUrlResult.normalizedUrl;
    args.connectionState.connectProbeAbortController = abortController;
    try {
      await connectProbe;
    } finally {
      if (args.connectionState.connectProbe === connectProbe) {
        args.connectionState.connectProbe = null;
        args.connectionState.connectProbeServerUrl = null;
        args.connectionState.connectProbeAbortController = null;
      }
    }
  }

  async function openSocketWithProbe(
    targetServerUrl: string,
    signal: AbortSignal,
  ): Promise<void> {
    const serverUrlResult = validateServerUrl(targetServerUrl);
    if ("message" in serverUrlResult) {
      args.connectionState.lastError = serverUrlResult.message;
      args.connectionState.connected = false;
      args.stopClockSyncTimer();
      args.logInvalidServerUrl("open-socket", targetServerUrl);
      args.notifyAll();
      return;
    }

    const extensionOrigin = getExtensionOrigin();
    const connectionCheckUrl = args.buildConnectionCheckUrl(
      serverUrlResult.normalizedUrl,
    );
    const healthUrl = args.buildHealthcheckUrl(serverUrlResult.normalizedUrl);
    let healthcheckReachable = false;

    if (connectionCheckUrl) {
      try {
        const response = await fetch(connectionCheckUrl, {
          method: "GET",
          cache: "no-store",
          signal,
        });
        if (!isCurrentServerUrl(serverUrlResult.normalizedUrl)) {
          return;
        }
        if (response.ok) {
          type ConnectionCheckResponse = {
            ok?: boolean;
            data?: {
              websocketAllowed?: boolean;
              reason?: string | null;
            };
          };

          const payload = (await response.json()) as ConnectionCheckResponse;
          if (!isCurrentServerUrl(serverUrlResult.normalizedUrl)) {
            return;
          }
          healthcheckReachable = true;
          if (payload.data?.websocketAllowed === false) {
            args.connectionState.lastError = getConnectionErrorMessage({
              healthcheckReachable: true,
              extensionOrigin,
              reason: payload.data.reason,
            });
            args.connectionState.connected = false;
            args.stopClockSyncTimer();
            args.logConnectionProbeFailure({
              stage: "connection-check",
              serverUrl: serverUrlResult.normalizedUrl,
              reason: payload.data.reason,
              extensionOrigin,
            });
            if (scheduleReconnect()) {
              args.notifyAll();
            }
            return;
          }
        }
      } catch {
        if (!isCurrentServerUrl(serverUrlResult.normalizedUrl)) {
          return;
        }
        // Fall back to the healthcheck probe for older servers that do not expose the preflight endpoint.
      }
    }

    if (healthUrl) {
      try {
        await fetch(healthUrl, {
          method: "GET",
          cache: "no-store",
          mode: "no-cors",
          signal,
        });
        if (!isCurrentServerUrl(serverUrlResult.normalizedUrl)) {
          return;
        }
        healthcheckReachable = true;
      } catch {
        if (!isCurrentServerUrl(serverUrlResult.normalizedUrl)) {
          return;
        }
        args.connectionState.lastError = getConnectionErrorMessage({
          healthcheckReachable: false,
          extensionOrigin,
        });
        args.connectionState.connected = false;
        args.stopClockSyncTimer();
        args.logConnectionProbeFailure({
          stage: "healthcheck",
          serverUrl: serverUrlResult.normalizedUrl,
          extensionOrigin,
        });
        if (scheduleReconnect()) {
          args.notifyAll();
        }
        return;
      }
    }

    if (!isCurrentServerUrl(serverUrlResult.normalizedUrl)) {
      return;
    }

    const socket = new WebSocket(serverUrlResult.normalizedUrl);
    args.connectionState.socket = socket;

    socket.addEventListener("open", () => {
      if (!isActiveSocket(socket, serverUrlResult.normalizedUrl)) {
        socket.close();
        return;
      }
      args.connectionState.connected = true;
      args.connectionState.lastError = null;
      args.connectionState.reconnectAttempt = 0;
      args.connectionState.reconnectDeadlineMs = null;
      args.log("background", "Socket connected");
      args.onOpen();
      if (args.roomSessionState.pendingCreateRoom) {
        args.roomSessionState.pendingCreateRoom = false;
        args.sendToServer({
          type: "room:create",
          payload: {
            displayName: args.roomSessionState.displayName ?? undefined,
            protocolVersion: PROTOCOL_VERSION,
          },
        });
      } else if (
        args.roomSessionState.pendingJoinRoomCode &&
        args.roomSessionState.pendingJoinToken &&
        !args.roomSessionState.pendingJoinRequestSent
      ) {
        args.sendJoinRequest(
          args.roomSessionState.pendingJoinRoomCode,
          args.roomSessionState.pendingJoinToken,
        );
      } else if (
        args.roomSessionState.roomCode &&
        args.roomSessionState.joinToken
      ) {
        args.sendJoinRequest(
          args.roomSessionState.roomCode,
          args.roomSessionState.joinToken,
        );
      }
      args.syncClock();
      args.startClockSyncTimer();
      args.notifyAll();
    });

    socket.addEventListener("message", (event) => {
      if (!isActiveSocket(socket, serverUrlResult.normalizedUrl)) {
        return;
      }
      let parsed: unknown;
      try {
        parsed = JSON.parse(event.data);
      } catch {
        args.log("background", "Received invalid JSON from server");
        return;
      }
      if (!isServerMessage(parsed)) {
        args.log("background", "Received unrecognized server message");
        return;
      }
      void args.handleServerMessage(parsed);
    });

    socket.addEventListener("close", (event) => {
      if (!isActiveSocket(socket, serverUrlResult.normalizedUrl)) {
        return;
      }
      args.connectionState.connected = false;
      args.stopClockSyncTimer();
      args.clearPendingLocalShare("socket closed before share confirmation");
      const closeReason = event.reason
        ? ` reason=${JSON.stringify(event.reason)}`
        : "";
      args.log(
        "background",
        `Socket closed code=${event.code} clean=${event.wasClean}${closeReason}`,
      );
      if (event.reason && ADMIN_SESSION_RESET_REASONS.has(event.reason)) {
        args.onAdminSessionReset(
          args.formatAdminSessionResetReason(event.reason),
        );
        return;
      }
      if (scheduleReconnect()) {
        args.notifyAll();
      }
    });

    socket.addEventListener("error", () => {
      if (!isActiveSocket(socket, serverUrlResult.normalizedUrl)) {
        return;
      }
      args.connectionState.lastError = getConnectionErrorMessage({
        healthcheckReachable,
        extensionOrigin,
      });
      args.connectionState.connected = false;
      args.stopClockSyncTimer();
      args.clearPendingLocalShare("socket error before share confirmation");
      args.logConnectionProbeFailure({
        stage: "websocket",
        serverUrl: serverUrlResult.normalizedUrl,
        extensionOrigin,
        readyState: args.connectionState.socket?.readyState ?? -1,
      });
      if (scheduleReconnect()) {
        args.notifyAll();
      }
    });
  }

  function scheduleReconnect(): boolean {
    if (
      !shouldScheduleReconnect({
        connected: args.connectionState.connected,
        reconnectTimer: args.connectionState.reconnectTimer,
        roomCode: args.roomSessionState.roomCode,
        pendingCreateRoom: args.roomSessionState.pendingCreateRoom,
        pendingJoinRoomCode: args.roomSessionState.pendingJoinRoomCode,
        reconnectAttempt: args.connectionState.reconnectAttempt,
        maxReconnectAttempts: args.maxReconnectAttempts,
      })
    ) {
      if (args.connectionState.reconnectAttempt >= args.maxReconnectAttempts) {
        args.connectionState.reconnectDeadlineMs = null;
        args.connectionState.lastError = args.reconnectFailedMessage();
        args.log(
          "background",
          `Reconnect exhausted after ${args.maxReconnectAttempts} attempts`,
        );
        clearPendingRoomEntryAfterReconnectExhausted();
        args.notifyAll();
      }
      return false;
    }

    args.connectionState.reconnectAttempt += 1;
    const retryDelayMs = getReconnectDelayMs(
      args.connectionState.reconnectAttempt,
    );
    args.connectionState.reconnectDeadlineMs = Date.now() + retryDelayMs;
    args.log("background", `Reconnect scheduled in ${retryDelayMs}ms`);
    args.connectionState.reconnectTimer = self.setTimeout(() => {
      args.connectionState.reconnectDeadlineMs = null;
      args.connectionState.reconnectTimer = null;
      void connect();
    }, retryDelayMs);
    return true;
  }

  function clearReconnectTimer(): void {
    if (args.connectionState.reconnectTimer !== null) {
      clearTimeout(args.connectionState.reconnectTimer);
      args.connectionState.reconnectTimer = null;
    }
    args.connectionState.reconnectDeadlineMs = null;
  }

  function getRetryInMs(): number | null {
    if (args.connectionState.reconnectDeadlineMs === null) {
      return null;
    }
    return Math.max(0, args.connectionState.reconnectDeadlineMs - Date.now());
  }

  function resetReconnectState(): void {
    clearReconnectTimer();
    args.connectionState.reconnectAttempt = 0;
  }

  function isCurrentServerUrl(targetServerUrl: string): boolean {
    const currentServerUrlResult = validateServerUrl(
      args.connectionState.serverUrl,
    );
    return (
      !("message" in currentServerUrlResult) &&
      currentServerUrlResult.normalizedUrl === targetServerUrl
    );
  }

  function isActiveSocket(socket: WebSocket, targetServerUrl: string): boolean {
    return (
      args.connectionState.socket === socket &&
      isCurrentServerUrl(targetServerUrl)
    );
  }

  function clearPendingRoomEntryAfterReconnectExhausted(): void {
    if (
      !args.roomSessionState.pendingCreateRoom &&
      !args.roomSessionState.pendingJoinRoomCode &&
      !args.roomSessionState.pendingJoinToken &&
      !args.roomSessionState.pendingJoinRequestSent
    ) {
      return;
    }

    args.roomSessionState.pendingCreateRoom = false;
    args.roomSessionState.pendingJoinRoomCode = null;
    args.roomSessionState.pendingJoinToken = null;
    args.roomSessionState.pendingJoinRequestSent = false;
    args.log("background", "Cleared pending room entry after reconnect failed");
    void Promise.resolve(args.persistState?.()).catch((error) => {
      args.log(
        "background",
        `Failed to persist pending room cleanup: ${
          error instanceof Error ? error.message : String(error)
        }`,
      );
    });
  }

  return {
    connect,
    scheduleReconnect,
    clearReconnectTimer,
    getRetryInMs,
    resetReconnectState,
  };
}

const ADMIN_SESSION_RESET_REASONS = new Set([
  "Admin kicked member",
  "Admin disconnected session",
  "Admin closed room",
]);
