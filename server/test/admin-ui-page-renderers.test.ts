import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import {
  bindRoomActionButtons,
  createPageLoaders,
  createRoomActionConfig,
  memberActionButtons,
} from "../admin-ui/page-renderers.js";

const adminStyles = readFileSync(
  new URL("../admin-ui/styles.css", import.meta.url),
  "utf8",
);

function createButton(attributes: Record<string, string> = {}) {
  const listeners = new Map<string, (event?: unknown) => unknown>();
  return {
    addEventListener(type: string, handler: (event?: unknown) => unknown) {
      listeners.set(type, handler);
    },
    getAttribute(name: string) {
      return attributes[name] ?? null;
    },
    async click() {
      return listeners.get("click")?.({
        preventDefault() {},
        currentTarget: this,
        target: this,
      });
    },
  };
}

function createDocumentStub({
  single = {},
  many = {},
}: {
  single?: Record<string, unknown>;
  many?: Record<string, unknown[]>;
} = {}) {
  return {
    querySelector(selector: string) {
      return single[selector] ?? null;
    },
    querySelectorAll(selector: string) {
      return many[selector] ?? [];
    },
  };
}

function countOccurrences(value: string, pattern: string): number {
  return value.split(pattern).length - 1;
}

function createAnnouncementEditorDocumentStub() {
  const listeners = new Map<string, (event?: unknown) => unknown>();
  const indexNode = { textContent: "" };
  const idInput = {
    name: "announcement-id-0",
    placeholder: "",
    value: "notice-1",
  };
  const textInput = {
    name: "announcement-text-0",
    value: "Last notice",
  };
  let rowRemoved = false;
  const row = {
    setAttribute() {},
    querySelector(selector: string) {
      if (selector === "[data-announcement-row-index]") {
        return indexNode;
      }
      if (selector === 'input[name^="announcement-id-"]') {
        return idInput;
      }
      if (selector === 'textarea[name^="announcement-text-"]') {
        return textInput;
      }
      return null;
    },
    remove() {
      rowRemoved = true;
    },
  };
  const deleteButton = {
    closest(selector: string) {
      if (selector === "[data-delete-announcement]") {
        return this;
      }
      if (selector === "[data-announcement-item]") {
        return row;
      }
      return null;
    },
  };
  const list = {
    querySelectorAll(selector: string) {
      if (selector !== "[data-announcement-item]" || rowRemoved) {
        return [];
      }
      return [row];
    },
    contains(value: unknown) {
      return value === deleteButton;
    },
    insertAdjacentHTML() {},
    addEventListener(type: string, handler: (event?: unknown) => unknown) {
      listeners.set(`list:${type}`, handler);
    },
  };
  const form = {
    addEventListener(type: string, handler: (event?: unknown) => unknown) {
      listeners.set(`form:${type}`, handler);
    },
  };
  const addButton = {
    disabled: false,
    addEventListener(type: string, handler: (event?: unknown) => unknown) {
      listeners.set(`add:${type}`, handler);
    },
  };
  const emptyState = { hidden: true };
  const refreshButton = {
    addEventListener(type: string, handler: (event?: unknown) => unknown) {
      listeners.set(`refresh:${type}`, handler);
    },
  };

  return {
    deleteButton,
    emptyState,
    document: createDocumentStub({
      single: {
        "[data-refresh-announcements]": refreshButton,
        "#announcements-form": form,
        "[data-announcement-list]": list,
        "[data-add-announcement]": addButton,
        "[data-announcement-empty]": emptyState,
      },
    }),
    async clickDelete() {
      await listeners.get("list:click")?.({
        target: deleteButton,
      });
    },
  };
}

function ruleBody(selector: string): string {
  const escaped = selector.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  const match = new RegExp(`${escaped}\\s*\\{([\\s\\S]*?)\\}`).exec(
    adminStyles,
  );
  assert.ok(match, `Missing CSS rule for ${selector}`);
  return match[1];
}

test("filter footer button groups align to the right edge", () => {
  assert.match(
    ruleBody(".filter-footer.full-width"),
    /grid-column:\s*1\s*\/\s*-1/,
  );
  assert.match(ruleBody(".filter-footer .actions"), /margin-left:\s*auto/);
  assert.match(
    ruleBody(".filter-footer .actions"),
    /justify-content:\s*flex-end/,
  );
});

test("announcement intro copy stays on a single line without an English kicker", () => {
  assert.match(ruleBody(".announcement-intro-text"), /white-space:\s*nowrap/);
  assert.match(ruleBody(".announcement-intro-text"), /max-width:\s*none/);
});

test("runtime room limit controls use a dedicated aligned row", () => {
  assert.match(ruleBody(".runtime-limits-panel"), /grid-column:\s*1\s*\/\s*-1/);
  assert.match(ruleBody(".runtime-limit-row"), /display:\s*grid/);
  assert.match(ruleBody(".runtime-limit-row"), /grid-template-columns:/);
  assert.match(ruleBody(".runtime-limit-save"), /justify-self:\s*end/);
});

test("overview page toggles auto refresh and supports manual refresh binding", async () => {
  const refreshButton = createButton();
  const toggleButton = createButton();
  let rerenderCount = 0;
  const state = { overviewAutoRefresh: true, lastOverviewData: null };

  const pageLoaders = createPageLoaders({
    document: createDocumentStub({
      single: {
        "[data-refresh-overview]": refreshButton,
        "[data-toggle-overview-refresh]": toggleButton,
      },
    }),
    location: { search: "" },
    history: { replaceState() {} },
    state,
    api: {
      async getReady() {
        return { status: "ready", checks: { roomStore: "ok" } };
      },
      async getOverview() {
        return {
          service: {
            instanceId: "instance-1",
            name: "syncroom-server",
            version: "1.0.0-test",
            uptimeMs: 12_345,
          },
          storage: { provider: "memory", redisConnected: false },
          runtime: {
            connectionCount: 3,
            activeRoomCount: 2,
            activeMemberCount: 5,
          },
          rooms: { totalNonExpired: 4, idle: 1 },
          nodes: {
            total: 2,
            online: 1,
            stale: 1,
            offline: 0,
            items: [
              {
                instanceId: "instance-1",
                version: "1.0.0-test",
                connectionCount: 3,
                currentRoomCount: 2,
                currentMemberCount: 5,
                roomCodes: ["ROOM8A", "ROOM2B"],
                lastHeartbeatAt: Date.now(),
                health: "ok",
              },
              {
                instanceId: "instance-2",
                version: "1.0.0-test",
                connectionCount: 1,
                currentRoomCount: 1,
                currentMemberCount: 2,
                roomCodes: ["ROOM8A"],
                lastHeartbeatAt: Date.now(),
                health: "stale",
              },
            ],
          },
          events: {
            lastMinute: {
              room_created: 1,
              room_joined: 2,
              rate_limited: 0,
              ws_connection_rejected: 0,
            },
            lastHour: {
              room_created: 3,
              room_joined: 8,
              rate_limited: 1,
              ws_connection_rejected: 1,
            },
            lastDay: {
              room_created: 9,
              room_joined: 30,
              rate_limited: 2,
              ws_connection_rejected: 4,
            },
            totals: {
              room_created: 10,
              room_joined: 20,
              rate_limited: 1,
              ws_connection_rejected: 2,
            },
          },
        };
      },
    },
    routeHref(path: string) {
      return `/admin${path}`;
    },
    withDemoQuery(url: string) {
      return url;
    },
    serializeQuery() {
      return "";
    },
    navigate() {},
    navigateToUrl() {},
    rerender() {
      rerenderCount += 1;
    },
    canManage() {
      return true;
    },
    confirmAction() {},
    openReasonDialog() {},
  });

  const page = await pageLoaders.renderOverviewPage();
  assert.equal(page.html.includes("连接数"), true);
  assert.equal(page.html.includes("最近一小时"), true);
  assert.equal(page.html.includes("最近一天"), true);
  assert.equal(page.html.includes("创建 3 · 加入 8 · 限流 1 · 拒绝 1"), true);
  assert.equal(page.html.includes("创建 9 · 加入 30 · 限流 2 · 拒绝 4"), true);
  assert.equal(page.html.includes("在线节点 (2)"), true);
  assert.equal(page.html.includes("instance-1"), true);
  assert.equal(page.html.includes("ROOM8A、ROOM2B"), false);
  assert.equal(page.html.includes("data-refresh-overview"), true);

  page.bind?.();
  await refreshButton.click();
  await toggleButton.click();

  assert.equal(rerenderCount, 2);
  assert.equal(state.overviewAutoRefresh, false);
});

test("rooms and events pages render direct admin ui tables", async () => {
  const pageLoaders = createPageLoaders({
    document: createDocumentStub(),
    location: { search: "" },
    history: { replaceState() {} },
    state: {
      overviewAutoRefresh: true,
      lastOverviewData: { instanceId: "instance-1" },
    },
    api: {
      async listRooms() {
        return {
          items: [
            {
              roomCode: "ROOM8A",
              isActive: true,
              ownerDisplayName: "Alice",
              ownerMemberId: "member-alice",
              memberCount: 3,
              sharedVideo: { title: "测试视频" },
              playback: {
                playState: "playing",
                currentTime: 12.3,
                playbackRate: 1,
                serverTime: Date.now(),
              },
              lastActiveAt: Date.now(),
              expiresAt: Date.now() + 60_000,
            },
          ],
          pagination: { total: 1 },
        };
      },
      async listEvents() {
        return {
          items: [
            {
              timestamp: Date.now(),
              event: "room_joined",
              roomCode: "ROOM8A",
              sessionId: "sess-1",
              origin: "https://www.bilibili.com",
              result: "ok",
              details: { memberId: "member-alice", displayName: "Alice" },
            },
            {
              timestamp: Date.now() - 1_000,
              event: "custom_runtime_probe",
              roomCode: "ROOM8A",
              sessionId: "sess-1",
              origin: "https://www.bilibili.com",
              result: "ok",
              details: {},
            },
          ],
          total: 2,
        };
      },
    },
    routeHref(path: string) {
      return `/admin${path}`;
    },
    withDemoQuery(url: string) {
      return url;
    },
    serializeQuery() {
      return "";
    },
    navigate() {},
    navigateToUrl() {},
    rerender() {},
    canManage() {
      return true;
    },
    confirmAction() {},
    openReasonDialog() {},
  });

  const roomsPage = await pageLoaders.renderRoomsPage();
  const eventsPage = await pageLoaders.renderEventsPage();

  assert.equal(roomsPage.html.includes("ROOM8A"), true);
  assert.equal(roomsPage.html.includes("<th>播放状态</th>"), true);
  assert.equal(roomsPage.html.includes("播放中"), true);
  assert.equal(roomsPage.html.includes("关闭房间"), true);
  assert.equal(eventsPage.html.includes("房间 ROOM8A"), true);
  assert.equal(eventsPage.html.includes("Alice 加入了房间"), true);
  assert.equal(
    eventsPage.html.includes("Alice 加入了房间 · 房间 ROOM8A"),
    false,
  );
  assert.equal(eventsPage.html.includes("custom runtime probe"), true);
  assert.equal(eventsPage.html.includes("查看详情 JSON 获取完整上下文"), false);
  assert.equal(eventsPage.html.includes("room_joined"), true);
  assert.equal(eventsPage.html.includes("data-view-json"), true);
});

test("room views show safe current host identity without tokens", async () => {
  const secretValues = ["member-secret-token", "SESSDATA=secret", "raw-cookie"];
  const pageLoaders = createPageLoaders({
    document: createDocumentStub(),
    location: { search: "" },
    history: { replaceState() {} },
    state: {
      overviewAutoRefresh: true,
      lastOverviewData: { instanceId: "instance-1" },
    },
    api: {
      async listRooms() {
        return {
          items: [
            {
              roomCode: "ROOM8A",
              isActive: true,
              ownerDisplayName: "Alice Host",
              ownerMemberId: "member-host",
              memberToken: secretValues[0],
              providerCredential: secretValues[1],
              memberCount: 2,
              sharedVideo: { title: "测试视频" },
              playback: null,
              lastActiveAt: Date.now(),
              expiresAt: Date.now() + 60_000,
            },
          ],
          pagination: { total: 1 },
        };
      },
      async getRoomDetail() {
        return {
          instanceId: "instance-1",
          room: {
            roomCode: "ROOM8A",
            isActive: true,
            memberCount: 2,
            instanceId: "instance-1",
            ownerDisplayName: "Alice Host",
            ownerMemberId: "member-host",
            memberToken: secretValues[0],
            providerCredential: secretValues[1],
            createdAt: Date.now(),
            lastActiveAt: Date.now(),
            expiresAt: Date.now() + 60_000,
            sharedVideo: null,
            playback: null,
          },
          members: [
            {
              displayName: "Alice Host",
              memberId: "member-host",
              sessionId: "session-host",
              joinedAt: Date.now(),
              remoteAddress: "127.0.0.1",
              origin: "https://example.com",
              cookie: secretValues[2],
            },
          ],
          recentEvents: [],
        };
      },
    },
    routeHref(path: string) {
      return `/admin${path}`;
    },
    withDemoQuery(url: string) {
      return url;
    },
    serializeQuery() {
      return "";
    },
    navigate() {},
    navigateToUrl() {},
    rerender() {},
    canManage() {
      return true;
    },
    confirmAction() {},
    openReasonDialog() {},
  });

  const roomsPage = await pageLoaders.renderRoomsPage();
  const detailPage = await pageLoaders.renderRoomDetailPage("ROOM8A");

  assert.equal(roomsPage.html.includes("<th>房主</th>"), true);
  assert.equal(roomsPage.html.includes("Alice Host"), true);
  assert.equal(roomsPage.html.includes("memberId member-host"), true);
  assert.equal(detailPage.html.includes("<dt>房主</dt>"), true);
  assert.equal(detailPage.html.includes("Alice Host"), true);
  assert.equal(detailPage.html.includes("memberId member-host"), true);
  for (const secret of secretValues) {
    assert.equal(roomsPage.html.includes(secret), false);
    assert.equal(detailPage.html.includes(secret), false);
  }
});

test("ip block page renders add form and blacklist rows", async () => {
  const pageLoaders = createPageLoaders({
    document: createDocumentStub(),
    location: { search: "" },
    history: { replaceState() {} },
    state: {
      overviewAutoRefresh: true,
      lastOverviewData: { instanceId: "instance-1" },
    },
    api: {
      async listIpBlocks() {
        return {
          items: [
            {
              ip: "203.0.113.4",
              createdAt: 1_000,
              actor: { username: "admin", role: "admin" },
              reason: "spam",
            },
          ],
          total: 1,
        };
      },
    },
    routeHref(path: string) {
      return `/admin${path}`;
    },
    withDemoQuery(url: string) {
      return url;
    },
    serializeQuery() {
      return "";
    },
    navigate() {},
    navigateToUrl() {},
    rerender() {},
    canManage() {
      return true;
    },
    confirmAction() {},
    openReasonDialog() {},
  });

  const page = await pageLoaders.renderIpBlocksPage();

  assert.equal(page.html.includes("小黑屋"), true);
  assert.equal(page.html.includes("203.0.113.4"), true);
  assert.equal(page.html.includes("spam"), true);
  assert.equal(page.html.includes("data-ip-block-form"), true);
  assert.equal(page.html.includes('data-ip-block-action="delete"'), true);
});

test("announcements page renders only published items with add and delete controls", async () => {
  const pageLoaders = createPageLoaders({
    document: createDocumentStub(),
    location: { search: "" },
    history: { replaceState() {} },
    state: {
      overviewAutoRefresh: true,
      lastOverviewData: { instanceId: "instance-1" },
    },
    api: {
      async getAnnouncements() {
        return {
          version: 4,
          updatedAt: 1_710_000_000_000,
          items: [
            { id: "notice-1", text: "今晚 20:00 维护 10 分钟" },
            { id: "notice-2", text: "插件已支持通用 HTML5 视频同步" },
          ],
        };
      },
    },
    routeHref(path: string) {
      return `/admin${path}`;
    },
    withDemoQuery(url: string) {
      return url;
    },
    serializeQuery() {
      return "";
    },
    navigate() {},
    navigateToUrl() {},
    rerender() {},
    canManage() {
      return true;
    },
    confirmAction() {},
    openReasonDialog() {},
  });

  const page = await pageLoaders.renderAnnouncementsPage();

  assert.equal(page.html.includes("今晚 20:00 维护 10 分钟"), true);
  assert.equal(page.html.includes("插件已支持通用 HTML5 视频同步"), true);
  assert.equal(page.html.includes("ANNOUNCEMENTS"), false);
  assert.equal(page.html.includes("panel-intro-kicker"), false);
  assert.equal(page.html.includes("announcement-intro-text"), true);
  assert.equal(page.html.includes('id="announcements-form"'), true);
  assert.equal(countOccurrences(page.html, "data-announcement-item="), 2);
  assert.equal(page.html.includes("announcement-text-2"), false);
  assert.equal(page.html.includes("data-add-announcement"), true);
  assert.equal(countOccurrences(page.html, "data-delete-announcement"), 2);
  assert.equal(page.html.includes('data-action="save-announcements"'), true);
});

test("announcements page publishes an empty list when deleting the last announcement row", async () => {
  const editor = createAnnouncementEditorDocumentStub();
  const updates: unknown[] = [];
  let rerenderCount = 0;
  const pageLoaders = createPageLoaders({
    document: editor.document,
    location: { search: "" },
    history: { replaceState() {} },
    state: {
      overviewAutoRefresh: true,
      lastOverviewData: { instanceId: "instance-1" },
    },
    api: {
      async getAnnouncements() {
        return {
          version: 1,
          updatedAt: 1_710_000_000_000,
          items: [{ id: "notice-1", text: "Last notice" }],
        };
      },
      async updateAnnouncements(items: unknown) {
        updates.push(items);
      },
    },
    routeHref(path: string) {
      return `/admin${path}`;
    },
    withDemoQuery(url: string) {
      return url;
    },
    serializeQuery() {
      return "";
    },
    navigate() {},
    navigateToUrl() {},
    rerender() {
      rerenderCount += 1;
    },
    canManage() {
      return true;
    },
    confirmAction() {},
    openReasonDialog() {},
  });

  const page = await pageLoaders.renderAnnouncementsPage();
  page.bind();
  await editor.clickDelete();

  assert.deepEqual(updates, [[]]);
  assert.equal(editor.emptyState.hidden, false);
  assert.equal(rerenderCount, 1);
});

test("member action buttons include blacklist action only when member has an IP", () => {
  const withIp = memberActionButtons(
    "ROOM8A",
    {
      memberId: "member-1",
      sessionId: "session-1",
      remoteAddress: "203.0.113.4",
    },
    true,
  );
  assert.equal(withIp.includes("加入黑名单"), true);
  assert.equal(withIp.includes('data-member-action="block-ip"'), true);
  assert.equal(withIp.includes('data-remote-address="203.0.113.4"'), true);

  const withoutIp = memberActionButtons(
    "ROOM8A",
    {
      memberId: "member-1",
      sessionId: "session-1",
      remoteAddress: null,
    },
    true,
  );
  assert.equal(withoutIp.includes("加入黑名单"), false);
});

test("room detail renders member microphone open and closed states", async () => {
  const pageLoaders = createPageLoaders({
    document: createDocumentStub(),
    location: { search: "" },
    history: { replaceState() {} },
    state: {},
    api: {
      async getRoomDetail() {
        return {
          instanceId: "instance-1",
          room: {
            roomCode: "ROOM8A",
            isActive: true,
            memberCount: 2,
            instanceId: "instance-1",
            createdAt: Date.now(),
            lastActiveAt: Date.now(),
            expiresAt: Date.now() + 60_000,
            sharedVideo: null,
            playback: null,
          },
          members: [
            {
              displayName: "Alice",
              memberId: "member-alice",
              sessionId: "session-alice",
              joinedAt: Date.now(),
              remoteAddress: "203.0.113.4",
              origin: "chrome-extension://allowed-extension",
              microphoneEnabled: true,
            },
            {
              displayName: "Bob",
              memberId: "member-bob",
              sessionId: "session-bob",
              joinedAt: Date.now(),
              remoteAddress: null,
              origin: null,
              microphoneEnabled: false,
            },
          ],
          recentEvents: [],
        };
      },
    },
    routeHref(path: string) {
      return `/admin${path}`;
    },
    withDemoQuery(url: string) {
      return url;
    },
    serializeQuery() {
      return "";
    },
    navigate() {},
    navigateToUrl() {},
    rerender() {},
    canManage() {
      return true;
    },
    confirmAction() {},
    openReasonDialog() {},
  });

  const page = await pageLoaders.renderRoomDetailPage("ROOM8A");

  assert.equal(page.html.includes("<th>语音状态</th>"), true);
  assert.equal(page.html.includes("开麦"), true);
  assert.equal(page.html.includes("关麦"), true);
});

test("room detail renders playback position as media timestamp", async () => {
  const pageLoaders = createPageLoaders({
    document: createDocumentStub(),
    location: { search: "" },
    history: { replaceState() {} },
    state: {},
    api: {
      async getRoomDetail() {
        return {
          instanceId: "instance-1",
          room: {
            roomCode: "ROOM8A",
            isActive: true,
            memberCount: 1,
            instanceId: "instance-1",
            createdAt: Date.now(),
            lastActiveAt: Date.now(),
            expiresAt: Date.now() + 60_000,
            sharedVideo: {
              title: "长视频",
              videoId: "BV1TEST",
              url: "https://www.bilibili.com/video/BV1TEST",
            },
            playback: {
              playState: "playing",
              currentTime: 3723.4,
              playbackRate: 1,
              serverTime: Date.now(),
            },
          },
          members: [],
          recentEvents: [
            {
              id: "event-1",
              timestamp: Date.now(),
              event: "room_joined",
              roomCode: "ROOM8A",
              sessionId: "session-1",
              result: "ok",
              details: { displayName: "Alice" },
            },
          ],
        };
      },
    },
    routeHref(path: string) {
      return `/admin${path}`;
    },
    withDemoQuery(url: string) {
      return url;
    },
    serializeQuery() {
      return "";
    },
    navigate() {},
    navigateToUrl() {},
    rerender() {},
    canManage() {
      return true;
    },
    confirmAction() {},
    openReasonDialog() {},
  });

  const page = await pageLoaders.renderRoomDetailPage("ROOM8A");

  assert.equal(page.html.includes("<dt>当前时间</dt><dd>1:02:03</dd>"), true);
  assert.equal(page.html.includes("3723.4s"), false);
  assert.equal(page.html.includes("Alice 加入了房间"), true);
  assert.equal(page.html.includes("Alice 加入了房间 · 房间 ROOM8A"), false);
});

test("room pages mark stale playback snapshots instead of presenting them as live", async () => {
  const staleServerTime = Date.now() - 3 * 60 * 60 * 1000;
  const pageLoaders = createPageLoaders({
    document: createDocumentStub(),
    location: { search: "" },
    history: { replaceState() {} },
    state: {
      overviewAutoRefresh: true,
      lastOverviewData: { instanceId: "instance-1" },
    },
    api: {
      async listRooms() {
        return {
          items: [
            {
              roomCode: "ROOM8A",
              isActive: true,
              ownerDisplayName: "Alice",
              ownerMemberId: "member-alice",
              memberCount: 1,
              sharedVideo: { title: "测试视频" },
              playback: {
                playState: "playing",
                currentTime: 12.3,
                playbackRate: 1,
                serverTime: staleServerTime,
              },
              lastActiveAt: staleServerTime,
              expiresAt: Date.now() + 60_000,
            },
          ],
          pagination: { total: 1 },
        };
      },
      async getRoomDetail() {
        return {
          instanceId: "instance-1",
          room: {
            roomCode: "ROOM8A",
            isActive: true,
            memberCount: 1,
            instanceId: "instance-1",
            createdAt: staleServerTime,
            lastActiveAt: staleServerTime,
            expiresAt: Date.now() + 60_000,
            sharedVideo: {
              title: "测试视频",
              videoId: "BV1TEST",
              url: "https://www.bilibili.com/video/BV1TEST",
            },
            playback: {
              playState: "playing",
              currentTime: 12.3,
              playbackRate: 1,
              serverTime: staleServerTime,
            },
          },
          members: [],
          recentEvents: [],
        };
      },
    },
    routeHref(path: string) {
      return `/admin${path}`;
    },
    withDemoQuery(url: string) {
      return url;
    },
    serializeQuery() {
      return "";
    },
    navigate() {},
    navigateToUrl() {},
    rerender() {},
    canManage() {
      return true;
    },
    confirmAction() {},
    openReasonDialog() {},
  });

  const roomsPage = await pageLoaders.renderRoomsPage();
  const detailPage = await pageLoaders.renderRoomDetailPage("ROOM8A");

  assert.equal(roomsPage.html.includes("播放中（已陈旧）"), true);
  assert.equal(roomsPage.html.includes("上次同步 3 小时前"), true);
  assert.equal(detailPage.html.includes("播放中（已陈旧）"), true);
  assert.equal(detailPage.html.includes("<dt>上次同步</dt>"), true);
});

test("config page renders editable runtime room limit", async () => {
  const pageLoaders = createPageLoaders({
    document: createDocumentStub(),
    location: { search: "" },
    history: { replaceState() {} },
    state: {},
    api: {
      async getConfig() {
        return {
          instanceId: "instance-1",
          persistence: {
            provider: "memory",
            emptyRoomTtlMs: 900_000,
            roomCleanupIntervalMs: 60_000,
            redisConfigured: false,
          },
          runtimeLimits: {
            maxActiveRoomsPerNode: 3,
          },
          admin: {
            configured: true,
            username: "admin",
            role: "admin",
            sessionTtlMs: 60_000,
          },
          security: {
            allowedOrigins: [],
            allowMissingOriginInDev: false,
            allowAnyOriginInDev: false,
            trustedProxyAddresses: [],
            maxConnectionsPerIp: 10,
            connectionAttemptsPerMinute: 20,
            maxMembersPerRoom: 8,
            maxMessageBytes: 8192,
            invalidMessageCloseThreshold: 3,
            rateLimits: {},
          },
        };
      },
    },
    routeHref(path: string) {
      return `/admin${path}`;
    },
    withDemoQuery(url: string) {
      return url;
    },
    serializeQuery() {
      return "";
    },
    navigate() {},
    navigateToUrl() {},
    rerender() {},
    canManage() {
      return true;
    },
    confirmAction() {},
    openReasonDialog() {},
  });

  const page = await pageLoaders.renderConfigPage();

  assert.equal(page.html.includes("data-runtime-limits-form"), true);
  assert.equal(page.html.includes("runtime-limits-panel"), true);
  assert.equal(page.html.includes("runtime-limit-row"), true);
  assert.equal(page.html.includes("runtime-limit-status"), true);
  assert.equal(page.html.includes('name="maxActiveRoomsPerNode"'), true);
  assert.equal(page.html.includes('value="3"'), true);
});

test("danger room actions require confirmed config before execution", async () => {
  const roomActionButton = createButton({
    "data-room-action": "close",
    "data-room-code": "ROOM8A",
  });
  const apiCalls: Array<{ roomCode: string; reason: string }> = [];
  const confirmConfigs: Array<Record<string, unknown>> = [];

  bindRoomActionButtons({
    document: createDocumentStub({
      many: { "[data-room-action]": [roomActionButton] },
    }),
    api: {
      async closeRoom(roomCode: string, reason: string) {
        apiCalls.push({ roomCode, reason });
      },
    },
    confirmAction: async (config: Record<string, unknown>) => {
      confirmConfigs.push(config);
      await (config.onConfirm as (reason: string) => Promise<void>)("排查异常");
    },
    navigate() {},
    rerender() {},
    currentRoute() {
      return "/rooms";
    },
  });

  await roomActionButton.click();

  assert.equal(confirmConfigs.length, 1);
  assert.equal(confirmConfigs[0].title, "关闭房间 ROOM8A");
  assert.equal(confirmConfigs[0].confirmLabel, "确认关闭");
  assert.deepEqual(apiCalls, [{ roomCode: "ROOM8A", reason: "排查异常" }]);

  const config = createRoomActionConfig("close", {
    roomCode: "ROOM8A",
    api: {
      async closeRoom() {},
    },
    navigate() {},
    rerender() {},
    currentRoute() {
      return "/rooms/ROOM8A";
    },
  });
  assert.equal(config.successMessage, "房间 ROOM8A 已关闭。");
});
