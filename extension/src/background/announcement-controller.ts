import {
  isAnnouncementState,
  type AnnouncementState,
} from "@bili-syncplay/protocol";
import {
  loadAnnouncementState,
  saveAnnouncementState,
} from "../shared/storage";
import type { DebugLogEntry } from "../shared/messages";
import type { AnnouncementRuntimeState } from "./runtime-state";

interface AnnouncementApiResponse {
  ok?: boolean;
  data?: unknown;
}

export interface AnnouncementController {
  loadCachedAnnouncements(): Promise<void>;
  refreshAnnouncements(): Promise<void>;
  applyAnnouncementUpdate(state: AnnouncementState): Promise<void>;
}

export function createAnnouncementController(args: {
  announcementState: AnnouncementRuntimeState;
  getServerUrl: () => string;
  fetchImpl?: typeof fetch;
  log: (scope: DebugLogEntry["scope"], message: string) => void;
  notifyAll: () => void;
}): AnnouncementController {
  const fetchAnnouncements = args.fetchImpl ?? fetch;

  async function loadCachedAnnouncements(): Promise<void> {
    try {
      args.announcementState.current = await loadAnnouncementState();
      args.notifyAll();
    } catch (error) {
      args.log(
        "background",
        `Announcement cache load failed: ${formatError(error)}`,
      );
    }
  }

  async function refreshAnnouncements(): Promise<void> {
    if (args.announcementState.refreshInFlight) {
      return args.announcementState.refreshInFlight;
    }

    const refreshTask = doRefreshAnnouncements().finally(() => {
      if (args.announcementState.refreshInFlight === refreshTask) {
        args.announcementState.refreshInFlight = null;
      }
    });
    args.announcementState.refreshInFlight = refreshTask;
    return refreshTask;
  }

  async function doRefreshAnnouncements(): Promise<void> {
    const url = toAnnouncementsApiUrl(args.getServerUrl());
    if (!url) {
      args.log("background", "Skipped announcement refresh for invalid URL.");
      return;
    }

    try {
      const response = await fetchAnnouncements(url, {
        method: "GET",
        cache: "no-store",
      });
      if (!response.ok) {
        args.log(
          "background",
          `Announcement refresh failed with status ${response.status}.`,
        );
        return;
      }

      const payload = (await response.json()) as AnnouncementApiResponse;
      if (payload.ok !== true || !isAnnouncementState(payload.data)) {
        args.log("background", "Announcement refresh returned invalid data.");
        return;
      }

      await applyAnnouncementUpdate(payload.data);
      args.notifyAll();
    } catch (error) {
      args.log(
        "background",
        `Announcement refresh failed: ${formatError(error)}`,
      );
    }
  }

  async function applyAnnouncementUpdate(
    state: AnnouncementState,
  ): Promise<void> {
    args.announcementState.current = state;
    try {
      await saveAnnouncementState(state);
    } catch (error) {
      args.log(
        "background",
        `Announcement cache save failed: ${formatError(error)}`,
      );
    }
  }

  return {
    loadCachedAnnouncements,
    refreshAnnouncements,
    applyAnnouncementUpdate,
  };
}

export function toAnnouncementsApiUrl(serverUrl: string): string | null {
  try {
    const parsed = new URL(serverUrl);
    if (parsed.protocol === "ws:") {
      parsed.protocol = "http:";
    } else if (parsed.protocol === "wss:") {
      parsed.protocol = "https:";
    } else {
      return null;
    }

    parsed.pathname = "/api/announcements";
    parsed.search = "";
    parsed.hash = "";
    return parsed.toString();
  } catch {
    return null;
  }
}

function formatError(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}
