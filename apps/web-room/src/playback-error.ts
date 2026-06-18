import type { WebRoomPlaybackErrorStage } from "./render.js";

export function getPlaybackErrorStage(
  error: unknown,
): WebRoomPlaybackErrorStage {
  const message = error instanceof Error ? error.message : String(error);
  if (/manifest|mpd|m3u8|playlist/i.test(message)) {
    return "manifest";
  }
  if (/decode|codec|media/i.test(message)) {
    return "decode";
  }
  if (/segment|range|partial|404/i.test(message)) {
    return "segment";
  }
  if (/network|fetch|http|load/i.test(message)) {
    return "network";
  }
  return "unknown";
}

export function getPlaybackErrorMessage(
  stage: WebRoomPlaybackErrorStage,
): string {
  switch (stage) {
    case "manifest":
      return "播放清单加载失败，请确认授权或切换到 proxy 播放。";
    case "segment":
      return "视频分片加载失败，请确认授权或切换到 proxy 播放。";
    case "network":
      return "网络加载失败，请稍后重试或切换到 proxy 播放。";
    case "decode":
      return "浏览器无法解码当前视频，请切换兼容清晰度或使用 proxy。";
    case "unknown":
      return "播放器启动失败，请重试或切换到 proxy 播放。";
  }
}
