export function shouldReconnect(args: {
  connected: boolean;
  reconnectTimer: number | null;
  roomCode: string | null;
  pendingCreateRoom: boolean;
  pendingJoinRoomCode: string | null;
  reconnectAttempt: number;
  maxReconnectAttempts: number;
}): boolean {
  if (args.connected || args.reconnectTimer !== null) {
    return false;
  }
  if (!args.roomCode && !args.pendingCreateRoom && !args.pendingJoinRoomCode) {
    return false;
  }
  return args.reconnectAttempt < args.maxReconnectAttempts;
}

export function getReconnectDelayMs(reconnectAttempt: number): number {
  return Math.min(1000 * 2 ** Math.max(0, reconnectAttempt - 1), 10000);
}
