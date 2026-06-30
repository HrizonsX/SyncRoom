import assert from "node:assert/strict";
import test from "node:test";
import {
  JOINED_ROOM_REGION_ORDER,
  NARROW_ROOM_REGION_ORDER,
  renderWebRoomApp,
  type WebRoomState,
} from "../src/render.js";
import { webRoomThemeTokens } from "../src/theme.js";

const DANMAKU_TEST_RENDERED_AT = 1_725_000_005_000;

function withMockedNow<T>(now: number, callback: () => T): T {
  const originalNow = Date.now;
  Date.now = () => now;
  try {
    return callback();
  } finally {
    Date.now = originalNow;
  }
}

const joinedRoomState: WebRoomState = {
  view: "joined",
  connectionState: "connected",
  roomCode: "ABC123",
  currentMemberId: "member-host",
  hostMemberId: "member-host",
  displayName: "Alice",
  joinToken: "valid-join-token-123",
  announcement: "今晚 20:00 一起看第 3 集",
  videoTitle: "Bilibili video title",
  authStatus: "authorized",
  voice: {
    status: "idle",
    muted: true,
    speaking: false,
    error: null,
    roomCode: null,
    roomName: null,
    participantIdentity: null,
    expiresAt: null,
    accessRequestedFor: null,
    participants: {},
  },
  members: [
    { id: "member-host", name: "Alice" },
    { id: "member-2", name: "Bob" },
  ],
  chatMessages: [
    {
      memberId: "member-2",
      displayName: "Bob",
      content: "<img src=x onerror=alert(1)>",
      timestamp: 1_725_000_000_000,
    },
  ],
  danmakuMessages: [],
  diagnostics: ["connected"],
};

test("renders a room-first entry screen without marketing hero content", () => {
  const html = renderWebRoomApp({
    view: "entry",
    connectionState: "disconnected",
  });

  assert.match(html, /data-region="entry"/);
  assert.match(html, /class="entry-brand announcement-brand brand"/);
  assert.match(html, /class="brand-mark"/);
  assert.match(html, /class="brand-tagline"/);
  assert.doesNotMatch(html, /status-pill/);
  assert.match(html, /data-action="create-room"/);
  assert.match(html, /data-action="join-room"/);
  assert.match(html, /name="roomInvite"/);
  assert.match(html, /class="entry-room-action-row"/);
  assert.match(html, /class="entry-server-settings"/);
  assert.match(html, /name="serverUrl"/);
  assert.match(html, /data-entry-icon="nickname"/);
  assert.match(html, /data-entry-icon="invite"/);
  assert.match(html, /data-entry-icon="join"/);
  assert.match(html, /data-entry-icon="create"/);
  assert.match(html, /data-entry-icon="server"/);
  assert.match(html, /data-entry-icon="server-url"/);
  assert.match(html, /class="entry-button-icon"/);
  assert.match(html, /class="entry-label-icon"/);
  assert.doesNotMatch(html, /name="roomCode"/);
  assert.doesNotMatch(html, /name="joinToken"/);
  assert.doesNotMatch(html, /hero/i);
  assert.doesNotMatch(html, /landing/i);
  const inviteIndex = html.indexOf('name="roomInvite"');
  const joinIndex = html.indexOf('data-action="join-room"');
  const createIndex = html.indexOf('data-action="create-room"');
  const serverSettingsIndex = html.indexOf('class="entry-server-settings"');
  const headerStart = html.indexOf('class="entry-header"');
  const actionsStart = html.indexOf('class="entry-actions"');
  const headerHtml = html.slice(headerStart, actionsStart);
  const actionsHtml = html.slice(actionsStart, serverSettingsIndex);
  assert.ok(inviteIndex >= 0);
  assert.ok(joinIndex > inviteIndex);
  assert.ok(createIndex > joinIndex);
  assert.ok(serverSettingsIndex > createIndex);
  assert.match(headerHtml, /class="entry-field entry-name-field"/);
  assert.match(headerHtml, /name="displayName"/);
  assert.doesNotMatch(actionsHtml, /name="displayName"/);
});

test("renders entry room invite with colon-delimited room and token", () => {
  const html = renderWebRoomApp({
    view: "entry",
    connectionState: "disconnected",
    roomCode: "ABC123",
    joinToken: "valid-join-token-123",
  });

  assert.match(
    html,
    /name="roomInvite"[^>]*value="ABC123:valid-join-token-123"/,
  );
});

test("renders the supplied joined-room desktop layout regions", () => {
  const html = renderWebRoomApp(joinedRoomState);

  assert.deepEqual(JOINED_ROOM_REGION_ORDER, [
    "announcement",
    "player-chat",
    "room-info",
    "room-settings",
  ]);

  for (const region of JOINED_ROOM_REGION_ORDER) {
    assert.match(html, new RegExp(`data-region="${region}"`));
  }

  assert.match(html, /data-theme-mode="light"/);
  assert.match(html, /class="announcement-brand brand"/);
  assert.match(html, /class="brand-mark"/);
  assert.match(html, /<svg class="icon" viewBox="0 0 24 24"/);
  assert.match(html, />SyncRoom</);
  assert.match(html, />同频观影，好友同声</);
  assert.match(html, /class="announcement-message"/);
  assert.match(html, /data-ui-icon="announcement"/);
  assert.match(html, /class="announcement-text"/);
  assert.match(html, /data-action="toggle-theme-mode"/);
  assert.match(html, /aria-pressed="false"/);
  assert.match(html, /data-ui-icon="theme"/);
  assert.match(html, /data-panel="player"/);
  assert.match(html, /data-panel="chat"/);
  assert.match(html, /data-ui-icon="chat"/);
  assert.match(html, /data-ui-icon="room-info"/);
  assert.match(html, /data-ui-icon="settings"/);
  assert.match(html, /data-ui-icon="copy"/);
  assert.match(html, /data-ui-icon="leave"/);
  assert.match(html, /data-ui-icon="send"/);
  const settingsIndex = html.indexOf('data-panel="settings"');
  const authManagementIndex = html.indexOf(
    'data-action="authorization-management"',
  );
  const settingsHeadingStart = html.indexOf(
    '<div class="panel-heading">',
    settingsIndex,
  );
  const settingsHeadingHtml = html.slice(
    settingsHeadingStart,
    html.indexOf("</div>", settingsHeadingStart),
  );
  assert.doesNotMatch(settingsHeadingHtml, /data-settings-heading-action/);
  assert.match(settingsHeadingHtml, /data-action="authorization-management"/);
  assert.match(settingsHeadingHtml, /管理已授权平台/);
  assert.match(settingsHeadingHtml, />视频设置</);
  assert.doesNotMatch(settingsHeadingHtml, />房间设置</);
  const chatHeadingStart = html.indexOf(
    '<div class="panel-heading">',
    html.indexOf('data-panel="chat"'),
  );
  const chatHeadingHtml = html.slice(
    chatHeadingStart,
    html.indexOf("</div>", chatHeadingStart),
  );
  assert.doesNotMatch(chatHeadingHtml, />\s*1\s*<\/span>/);
  assert.doesNotMatch(html, /data-region="title-auth"/);
  assert.match(html, /data-player-video-title="true"/);
  assert.match(html, /slot="top-chrome"/);
  assert.match(html, /title="Bilibili video title"/);
  assert.ok(settingsIndex >= 0);
  assert.ok(authManagementIndex > settingsIndex);
  assert.doesNotMatch(html, /data-panel="authorization-entry"/);
  assert.match(html, /data-action="copy-room-invite"/);
  assert.match(html, /data-action="leave-room"/);
  assert.match(html, /class="button-icon"/);
  assert.match(html, /data-room-code="ABC123"/);
  assert.match(html, /data-join-token="valid-join-token-123"/);
  const roomHeadingHtml = html.slice(
    html.indexOf(
      '<div class="panel-heading">',
      html.indexOf('data-panel="members"'),
    ),
    html.indexOf("</div>", html.indexOf('class="room-code-actions"')),
  );
  assert.match(roomHeadingHtml, /data-action="copy-room-invite"/);
  assert.match(roomHeadingHtml, /data-action="leave-room"/);
  assert.match(html, /data-panel="members"/);
  assert.match(html, /data-panel="settings"/);
  assert.match(html, /data-panel="room-video-info"/);
  const roomInfoIndex = html.indexOf('data-region="room-info"');
  const roomVideoInfoIndex = html.indexOf(
    'data-panel="room-video-info"',
    roomInfoIndex,
  );
  const roomMetaIndex = html.indexOf('class="room-meta"', roomInfoIndex);
  const roomMetaHtml = html.slice(
    roomMetaIndex,
    html.indexOf("</dl>", roomMetaIndex),
  );
  assert.ok(roomVideoInfoIndex > roomInfoIndex);
  assert.ok(roomMetaIndex > roomVideoInfoIndex);
  assert.match(html, /视频标题/);
  assert.match(html, /Bilibili video title/);
  assert.match(html, /播放源/);
  assert.match(html, /播放状态/);
  assert.match(html, /class="member-list-disclosure"/);
  assert.doesNotMatch(html, /<details class="member-list-disclosure" open/);
  const memberDisclosureStart = html.indexOf('class="member-list-disclosure"');
  const memberDisclosureHtml = html.slice(
    memberDisclosureStart,
    html.indexOf("</details>", memberDisclosureStart),
  );
  assert.match(memberDisclosureHtml, /data-ui-icon="members"/);
  assert.match(html, /class="diagnostics-disclosure"/);
  assert.doesNotMatch(html, /<details class="diagnostics-disclosure" open/);
  const diagnosticsStart = html.indexOf('class="diagnostics-disclosure"');
  const diagnosticsHtml = html.slice(
    diagnosticsStart,
    html.indexOf("</details>", diagnosticsStart),
  );
  assert.match(diagnosticsHtml, /data-ui-icon="info"/);
  assert.match(html, /valid-join-token-123/);
  assert.doesNotMatch(roomMetaHtml, /valid-join-token-123/);
  assert.doesNotMatch(roomMetaHtml, /加入口令/);
});

test("renders room clock sync metrics in the room metadata card", () => {
  const html = renderWebRoomApp({
    ...joinedRoomState,
    clockOffsetMs: -18,
    rttMs: 42,
  } as WebRoomState);

  assert.match(html, /data-clock-offset-ms="-18"/);
  assert.match(html, /data-clock-rtt-ms="42"/);
  assert.match(html, /-18ms/);
  assert.match(html, /42ms/);
});

test("renders host playback sync strategy controls", () => {
  const html = renderWebRoomApp({
    ...joinedRoomState,
    playbackSync: {
      strategy: "wait",
      hold: {
        active: true,
        reasonMemberId: "member-2",
        startedAt: 1_000,
        deadlineAt: 11_000,
      },
      bufferingMemberIds: ["member-2"],
    },
  });

  assert.match(html, /data-panel="playback-sync"/);
  assert.match(html, /data-action="set-playback-sync-strategy"/);
  assert.match(html, /data-sync-strategy="smooth"/);
  assert.match(html, /data-sync-strategy="wait"/);
  assert.match(html, /data-playback-sync-hold="true"/);
});

test("renders non-host playback sync status without strategy controls", () => {
  const html = renderWebRoomApp({
    ...joinedRoomState,
    currentMemberId: "member-2",
    playbackSync: {
      strategy: "smooth",
      hold: {
        active: false,
      },
      bufferingMemberIds: [],
    },
  });

  assert.match(html, /data-panel="playback-sync"/);
  assert.doesNotMatch(html, /data-action="set-playback-sync-strategy"/);
});

test("renders the joined room in dark theme mode", () => {
  const html = renderWebRoomApp({
    ...joinedRoomState,
    themeMode: "dark",
  });

  assert.match(html, /data-theme-mode="dark"/);
  assert.match(html, /data-action="toggle-theme-mode"/);
  assert.match(html, /aria-pressed="true"/);
  assert.match(html, />白天模式<\/span>/);
});

test("omits the player title control before a video is selected", () => {
  const html = renderWebRoomApp({
    ...joinedRoomState,
    videoTitle: undefined,
  });

  assert.doesNotMatch(html, /data-region="title-auth"/);
  assert.doesNotMatch(html, /data-player-video-title="true"/);
  assert.doesNotMatch(html, /未选择视频/);
});

test("renders the player controls even before a video source is selected", () => {
  const html = renderWebRoomApp(joinedRoomState);

  assert.match(html, /<video\b/);
  assert.match(html, /<media-controller\b/);
  assert.match(html, /fullscreenelement="web-room-fullscreen-root"/);
  assert.doesNotMatch(html, /fullscreenelement="app"/);
  assert.match(html, /<media-control-bar\b/);
  assert.match(html, /data-playback-video="true"/);
  assert.match(html, /preload="auto"/);
  assert.match(html, /data-player-empty="true"/);
  assert.match(
    html,
    /<media-play-button notooltip disabled><\/media-play-button>/,
  );
  assert.match(html, /<media-time-range disabled><\/media-time-range>/);
  assert.match(
    html,
    /class="player-time-pair"[\s\S]*<media-time-display notoggle><\/media-time-display>[\s\S]*<media-duration-display><\/media-duration-display>/,
  );
  assert.match(html, /data-player-danmaku-controls="inline"/);
  assert.doesNotMatch(html, /<media-loading-indicator\b/);
  assert.match(html, /name="playerDanmaku"/);
  assert.match(html, /data-action="send-player-danmaku"/);
  assert.match(html, /aria-label="发送弹幕"/);
  assert.match(html, /class="player-danmaku-send-icon"/);
  assert.match(html, /<span class="visually-hidden">发送弹幕<\/span>/);
  assert.doesNotMatch(html, /class="player-danmaku-send"[^>]*>发送<\/button>/);
  assert.match(html, /class="player-volume-control"/);
  assert.match(html, /class="player-volume-popover"/);
  assert.doesNotMatch(html, /slot="tooltip-mute"/);
  assert.doesNotMatch(html, /slot="tooltip-unmute"/);
  assert.doesNotMatch(html, /<media-mute-button[^>]*title=/);
  assert.match(html, /class="player-volume-range-frame"/);
  assert.match(html, /<media-volume-range><\/media-volume-range>/);
  const controlBarHtml = html.slice(
    html.indexOf("<media-control-bar"),
    html.indexOf("</media-control-bar>"),
  );
  assert.doesNotMatch(controlBarHtml, /slot="tooltip-/);
  assert.match(controlBarHtml, /<media-mute-button notooltip\b/);
  assert.match(
    controlBarHtml,
    /<media-playback-rate-button notooltip disabled><\/media-playback-rate-button>/,
  );
  assert.match(
    controlBarHtml,
    /<media-pip-button notooltip><\/media-pip-button>/,
  );
  assert.match(
    controlBarHtml,
    /<media-fullscreen-button fullscreenelement="web-room-fullscreen-root" notooltip><\/media-fullscreen-button>/,
  );
  assert.doesNotMatch(controlBarHtml, /<media-play-button[^>]*title=/);
  assert.doesNotMatch(controlBarHtml, /<media-playback-rate-button[^>]*title=/);
  assert.doesNotMatch(controlBarHtml, /<media-pip-button[^>]*title=/);
  assert.doesNotMatch(controlBarHtml, /<media-fullscreen-button[^>]*title=/);
  assert.doesNotMatch(controlBarHtml, /class="player-danmaku-send"[^>]*title=/);
  assert.doesNotMatch(controlBarHtml, /data-player-video-title="true"/);
  assert.match(html, /data-action="toggle-player-danmaku"/);
  assert.match(html, /<media-controller\b[^>]*gesturesdisabled/);
  assert.match(html, /aria-controls="player-danmaku-panel"/);
  assert.match(html, /id="player-danmaku-panel"/);
  assert.match(html, /data-player-danmaku-controls="popover"/);
  const popoverOpenTag = html.slice(
    html.indexOf('class="player-danmaku-popover"'),
    html.indexOf(">", html.indexOf('class="player-danmaku-popover"')),
  );
  assert.match(popoverOpenTag, /role="group"/);
  assert.doesNotMatch(popoverOpenTag, /role="dialog"/);
  assert.doesNotMatch(html, /data-action="send-danmaku"/);
  assert.doesNotMatch(html, /player-placeholder/);
});

test("renders a real video host for Shaka playback sources", () => {
  const html = renderWebRoomApp({
    ...joinedRoomState,
    playbackSource: {
      url: "https://syncroom.example.test/proxy/manifest/manifest-1.mpd",
      sourceType: "mpd",
      engine: "shaka",
      candidateId: "dash-avc-720p",
    },
  } as WebRoomState);

  assert.match(html, /<video\b/);
  assert.match(html, /<media-controller\b/);
  assert.match(html, /<media-control-bar\b/);
  assert.match(html, /data-playback-video="true"/);
  assert.match(html, /data-source-type="mpd"/);
  assert.match(html, /data-playback-engine="shaka"/);
  assert.match(html, /data-source-candidate-id="dash-avc-720p"/);
  assert.match(html, /<media-loading-indicator\b/);
  assert.match(html, /slot="centered-chrome"/);
  assert.match(html, /class="player-loading-indicator"/);
  assert.match(html, /loadingdelay="200"/);
  assert.match(html, /<media-play-button notooltip><\/media-play-button>/);
  assert.match(
    html,
    /class="player-time-pair"[\s\S]*<media-time-display notoggle><\/media-time-display>[\s\S]*<media-duration-display><\/media-duration-display>/,
  );
  assert.doesNotMatch(html, /<media-play-button[^>]*disabled/);
  assert.doesNotMatch(html, /<media-time-range disabled>/);
  assert.doesNotMatch(html, /\scontrols(\s|>)/);
  assert.match(
    html,
    /data-source-url="https:\/\/syncroom\.example\.test\/proxy\/manifest\/manifest-1\.mpd"/,
  );
  assert.doesNotMatch(html, /<div class="player-placeholder">播放器<\/div>/);
});

test("renders live playback with a full non-seekable progress bar", () => {
  const html = renderWebRoomApp({
    ...joinedRoomState,
    playbackSource: {
      url: "https://syncroom.example.test/proxy/manifest/live.m3u8",
      sourceType: "m3u8",
      engine: "shaka",
      isLive: true,
    },
  } as WebRoomState);

  assert.match(html, /<media-controller\b[^>]*data-player-live="true"/);
  const controlBarHtml = html.slice(
    html.indexOf("<media-control-bar"),
    html.indexOf("</media-control-bar>"),
  );
  assert.match(controlBarHtml, /data-player-live-progress="true"/);
  assert.match(controlBarHtml, /aria-label="直播进度"/);
  assert.doesNotMatch(controlBarHtml, /<media-time-range/);
});

test("renders an escaped private danmaku overlay above the Shaka video", () => {
  const html = withMockedNow(DANMAKU_TEST_RENDERED_AT, () =>
    renderWebRoomApp({
      ...joinedRoomState,
      playbackSource: {
        url: "https://syncroom.example.test/proxy/manifest/manifest-1.mpd",
        sourceType: "mpd",
        engine: "shaka",
      },
      danmakuMessages: [
        {
          renderKey: "danmaku-render-key-1",
          memberId: "member-2",
          displayName: "Bob",
          content: "<img src=x onerror=alert(1)>",
          videoTime: 42.25,
          mode: "scroll",
          color: "#ffffff",
          timestamp: DANMAKU_TEST_RENDERED_AT - 1_250,
        },
      ],
    } as WebRoomState),
  );

  assert.match(html, /data-danmaku-layer="true"/);
  assert.match(html, /data-danmaku-layer="true"[^>]*noautohide/);
  assert.match(html, /data-danmaku-paused="false"/);
  assert.match(html, /data-danmaku-key="danmaku-render-key-1"/);
  assert.match(html, /data-danmaku-video-time="42\.25"/);
  assert.match(html, /class="danmaku-item is-scroll"/);
  assert.match(html, /--danmaku-lane-y:\s*0px;/);
  assert.match(html, /--danmaku-progress-delay:\s*-1250ms;/);
  assert.doesNotMatch(html, /--danmaku-lane:/);
  assert.match(html, /&lt;img src=x onerror=alert\(1\)&gt;/);
  assert.doesNotMatch(html, /<img src=x/);
});

test("omits expired danmaku messages so they are not replayed", () => {
  const html = withMockedNow(DANMAKU_TEST_RENDERED_AT, () =>
    renderWebRoomApp({
      ...joinedRoomState,
      danmakuMessages: [
        {
          memberId: "member-2",
          displayName: "Bob",
          content: "expired danmaku",
          videoTime: 42.25,
          mode: "scroll",
          color: "#ffffff",
          timestamp: DANMAKU_TEST_RENDERED_AT - 9_500,
        },
        {
          memberId: "member-host",
          displayName: "Alice",
          content: "fresh danmaku",
          videoTime: 43,
          mode: "scroll",
          color: "#ffffff",
          timestamp: DANMAKU_TEST_RENDERED_AT - 500,
        },
      ],
    } as WebRoomState),
  );

  assert.match(html, /fresh danmaku/);
  assert.match(html, /--danmaku-progress-delay:\s*-500ms;/);
  assert.doesNotMatch(html, /expired danmaku/);
});

test("keeps the danmaku layer moving when playback is paused", () => {
  const html = renderWebRoomApp({
    ...joinedRoomState,
    playback: {
      url: "https://www.bilibili.com/video/BV1TEST",
      currentTime: 42,
      playState: "paused",
      playbackRate: 1,
      updatedAt: 1_725_000_000_000,
      serverTime: 1_725_000_000_000,
      actorId: "member-host",
      seq: 1,
    },
  } as WebRoomState);

  assert.match(html, /data-danmaku-layer="true"/);
  assert.match(html, /data-danmaku-paused="false"/);
});

test("renders chat messages as directional bubbles with timestamps", () => {
  const html = renderWebRoomApp({
    ...joinedRoomState,
    chatMessages: [
      {
        memberId: "member-host",
        displayName: "Alice",
        content: "self message",
        timestamp: 1_725_000_000_000,
      },
      {
        memberId: "member-2",
        displayName: "Bob",
        content: "other message",
        timestamp: 1_725_000_060_000,
      },
    ],
  });

  assert.match(html, /class="chat-message is-self"/);
  assert.match(html, /data-chat-author="self"/);
  assert.match(html, /class="chat-message is-other"/);
  assert.match(html, /data-chat-author="other"/);
  assert.match(
    html,
    /<time datetime="1725000000000">2024\/08\/30 14:40<\/time>/,
  );
  assert.match(
    html,
    /<time datetime="1725000060000">2024\/08\/30 14:41<\/time>/,
  );
});

test("renders system chat messages centered in chronological chat flow", () => {
  const html = renderWebRoomApp({
    ...joinedRoomState,
    chatMessages: [
      {
        kind: "system",
        systemEventType: "member_joined",
        memberId: "member-2",
        displayName: "Bob",
        content: "Bob 加入了房间",
        timestamp: 1_725_000_000_000,
      },
      {
        memberId: "member-host",
        displayName: "Alice",
        content: "欢迎",
        timestamp: 1_725_000_060_000,
      },
    ],
  } as WebRoomState);
  const systemIndex = html.indexOf('class="chat-system-message"');
  const userIndex = html.indexOf('class="chat-message is-self"');

  assert.ok(systemIndex >= 0);
  assert.ok(userIndex > systemIndex);
  assert.match(html, /data-chat-author="system"/);
  assert.match(html, /data-chat-system-event="member_joined"/);
  assert.match(html, />Bob 加入了房间</);
  assert.match(html, /<time datetime="1725000000000">/);
  assert.doesNotMatch(html, /class="chat-message is-other"[^]*Bob 加入了房间/);
});

test("renders voice controls inside the chat room instead of settings", () => {
  const html = renderWebRoomApp(joinedRoomState);
  const chatPanelIndex = html.indexOf('data-panel="chat"');
  const voicePanelIndex = html.indexOf('data-panel="voice"');
  const chatInputIndex = html.indexOf('class="chat-input-row"');
  const sendChatIndex = html.indexOf('data-action="send-chat"', chatInputIndex);
  const voiceToggleIndex = html.indexOf(
    'data-action="voice-toggle"',
    chatInputIndex,
  );
  const settingsPanelIndex = html.indexOf('data-panel="settings"');
  const voicePanelHtml = html.slice(voicePanelIndex, chatInputIndex);
  const voiceMembersHtml = voicePanelHtml.slice(
    voicePanelHtml.indexOf('class="voice-members"'),
  );

  assert.ok(chatPanelIndex >= 0);
  assert.ok(voicePanelIndex > chatPanelIndex);
  assert.ok(chatInputIndex > voicePanelIndex);
  assert.ok(sendChatIndex > chatInputIndex);
  assert.ok(voiceToggleIndex > sendChatIndex);
  assert.ok(settingsPanelIndex > voicePanelIndex);
  assert.match(html, /data-panel="voice"/);
  assert.match(html, /data-voice-status="idle"/);
  assert.match(html, /data-ui-icon="members"/);
  assert.match(html, /class="voice-member-avatar"/);
  assert.match(html, /aria-label="Alice/);
  assert.match(html, /aria-label="Bob/);
  assert.doesNotMatch(voicePanelHtml, /data-action="voice-toggle"/);
  assert.doesNotMatch(voiceMembersHtml, /<small>/);
  assert.match(html, /class="secondary-button voice-toggle-button"/);
  assert.match(html, /data-action="voice-toggle"/);
  assert.match(html, /<svg\b[^>]*viewBox="0 0 24 24"/);
});

test("renders host member management actions for other members", () => {
  const html = renderWebRoomApp(joinedRoomState);

  assert.match(html, /data-action="set-member-permission"/);
  assert.match(html, /data-member-permission="voice"/);
  assert.match(html, /data-member-permission="playbackControl"/);
  assert.match(html, /data-member-permission="chat"/);
  assert.match(html, /data-member-permission="danmaku"/);
  assert.match(html, /data-action="transfer-host"/);
  assert.match(html, /data-action="kick-member"/);
  const managedMemberStart = html.indexOf('data-member-id="member-2"');
  const memberRowStart = html.lastIndexOf(
    '<li class="member-row">',
    managedMemberStart,
  );
  const memberRowHtml = html.slice(
    memberRowStart,
    html.indexOf("</li>", memberRowStart),
  );
  assert.match(memberRowHtml, /class="member-main"/);
  assert.ok(
    memberRowHtml.indexOf('class="member-name"') <
      memberRowHtml.indexOf('class="member-actions"'),
  );
});

test("renders denied member permissions as disabled controls", () => {
  const html = renderWebRoomApp({
    ...joinedRoomState,
    currentMemberId: "member-2",
    hostMemberId: "member-host",
    members: [
      { id: "member-host", name: "Alice" },
      {
        id: "member-2",
        name: "Bob",
        permissions: {
          voice: false,
          playbackControl: false,
          chat: false,
          danmaku: false,
        },
      },
    ],
  });

  assert.match(html, /<media-play-button notooltip disabled>/);
  assert.match(html, /<media-controller\b[^>]*gesturesdisabled/);
  assert.match(html, /<media-time-range disabled>/);
  assert.match(html, /<media-playback-rate-button notooltip disabled>/);
  assert.match(html, /name="chat" maxlength="500" disabled/);
  assert.match(html, /data-action="voice-toggle"[\s\S]*disabled/);
  assert.match(html, /data-action="send-player-danmaku"[\s\S]*disabled/);
  assert.doesNotMatch(html, /data-action="kick-member"/);
});

test("disables danmaku sending during the one-second send cooldown", () => {
  const html = withMockedNow(10_250, () =>
    renderWebRoomApp({
      ...joinedRoomState,
      danmakuCooldownUntil: 11_000,
    }),
  );

  assert.match(html, /data-danmaku-cooldown="true"/);
  assert.match(html, /data-danmaku-cooldown-seconds="1"/);
  const playerDanmakuInputs =
    html.match(/<input[\s\S]*?name="playerDanmaku"[\s\S]*?\/>/g) ?? [];
  assert.ok(playerDanmakuInputs.length > 0);
  assert.ok(playerDanmakuInputs.every((input) => !input.includes("disabled")));
  assert.match(html, /data-action="send-player-danmaku"[\s\S]*disabled/);
});

test("renders shell boundaries for provider auth and host picker", () => {
  const html = renderWebRoomApp(joinedRoomState);

  assert.doesNotMatch(html, /data-panel="provider-auth"/);
  assert.match(html, /data-action="authorization-management"/);
  assert.match(html, /data-ui-icon="auth"/);
  assert.doesNotMatch(html, /data-panel="authorization-entry"/);
  const settingsHeadingStart = html.indexOf(
    '<div class="panel-heading">',
    html.indexOf('data-panel="settings"'),
  );
  const settingsHeadingHtml = html.slice(
    settingsHeadingStart,
    html.indexOf("</div>", settingsHeadingStart),
  );
  assert.match(settingsHeadingHtml, /data-action="authorization-management"/);
  assert.match(settingsHeadingHtml, /管理已授权平台/);
  assert.match(html, /data-panel="host-picker"/);
  assert.match(html, /data-action="parse-bilibili-url"/);
  assert.match(html, /data-ui-icon="parse"/);
  assert.match(html, /data-ui-icon="play"/);
  assert.match(html, /data-policy-help="proxy"/);
  assert.match(html, /data-policy-help="shared"/);
  assert.match(html, /class="policy-help"/);
  assert.match(html, /class="policy-help-trigger"/);
  assert.match(html, /role="tooltip"/);
  assert.doesNotMatch(html, /<details class="policy-help"/);
  assert.doesNotMatch(html, /<summary aria-label="proxy 说明">/);
  assert.match(html, /name="bilibiliUrl"/);
  assert.match(html, /placeholder="粘贴视频链接"/);
  const pickerStart = html.indexOf('class="provider-picker-panel"');
  const pickerHtml = html.slice(
    pickerStart,
    html.indexOf("</section>", pickerStart),
  );
  assert.doesNotMatch(pickerHtml, /Bilibili/);
  assert.match(pickerHtml, /data-ui-icon="parse"/);
});

test("renders voice member state in the chat room", () => {
  const html = renderWebRoomApp({
    ...joinedRoomState,
    voice: {
      status: "connected",
      muted: false,
      speaking: true,
      error: null,
      roomCode: "ABC123",
      roomName: "syncroom-ABC123",
      participantIdentity: "member-host",
      expiresAt: 11_000,
      accessRequestedFor: "ABC123:valid-member-token-123",
      participants: {
        "member-host": {
          memberId: "member-host",
          connected: true,
          muted: false,
          speaking: true,
        },
        "member-2": {
          memberId: "member-2",
          connected: true,
          muted: true,
          speaking: false,
        },
      },
    },
  });

  assert.match(html, /data-voice-status="connected"/);
  assert.match(html, /data-voice-muted="false"/);
  assert.match(html, /data-voice-member-id="member-host"/);
  assert.match(html, /data-voice-member-status="speaking"/);
  assert.match(html, /data-voice-member-id="member-2"/);
  assert.match(html, /data-voice-member-status="muted"/);
});

test("renders authorization management as a platform list with platform auth entries", () => {
  const html = renderWebRoomApp({
    ...joinedRoomState,
    authStatus: "checking",
    authPanel: {
      open: true,
      method: "qr",
      phase: "loading",
      message: "Preparing QR login.",
    },
  });

  assert.match(html, /class="authorization-modal provider-auth-panel"/);
  assert.match(html, /role="dialog"/);
  assert.match(html, /aria-modal="true"/);
  assert.match(html, /data-action="close-authorization-management"/);
  assert.match(html, /class="authorization-modal-heading"/);
  const modalHeadingStart = html.indexOf('class="authorization-modal-heading"');
  const modalCloseIndex = html.indexOf(
    'data-action="close-authorization-management"',
    modalHeadingStart,
  );
  assert.ok(
    html.indexOf("settings-tile-heading", modalHeadingStart) < modalCloseIndex,
  );
  assert.match(
    html,
    /<button type="button" class="icon-button authorization-modal-close" data-action="close-authorization-management" aria-label="关闭授权管理">[\s\S]*data-ui-icon="close"[\s\S]*<span class="visually-hidden">关闭授权管理<\/span>[\s\S]*<\/button>/,
  );
  assert.doesNotMatch(html, />关闭<\/button>/);
  assert.ok(
    html.indexOf('data-modal="authorization-management"') >
      html.indexOf('<main class="web-room-shell web-room-workspace"'),
  );
  assert.match(html, /data-panel="provider-auth"/);
  assert.match(html, /data-platform-auth-list="true"/);
  assert.match(html, /data-platform-id="bilibili"/);
  assert.match(html, /data-platform-id="iqiyi"/);
  assert.match(html, /data-platform-id="huya"/);
  assert.match(html, /data-auth-host="true"/);
  assert.match(html, /data-auth-method="qr"/);
  assert.match(html, /data-auth-phase="loading"/);
  assert.match(html, /class="platform-logo platform-logo-bilibili"/);
  assert.match(html, /class="platform-logo platform-logo-iqiyi"/);
  assert.match(html, /class="platform-logo platform-logo-huya"/);
  assert.match(html, /aria-label="iQIYI Logo"/);
  assert.match(html, /aria-label="Huya Logo"/);
  assert.match(html, /class="platform-logo-svg"/);
  assert.match(html, /aria-label="Bilibili 官方 Logo"/);
  assert.match(html, /正在准备二维码登录。/);
  assert.match(html, /data-action="collapse-bilibili-auth"/);
  assert.match(html, /data-action="iqiyi-login-qr"/);
  assert.match(html, /data-action="bilibili-login-qr"/);
  assert.match(html, /data-action="huya-login-qr"/);
  assert.match(html, /data-ui-icon="refresh"/);
  assert.match(html, />收起二维码<\/span>/);
  assert.doesNotMatch(
    html,
    /class="secondary-button platform-auth-action" data-action="bilibili-login-qr"/,
  );
  assert.doesNotMatch(html, /data-action="bilibili-logout"/);
  assert.doesNotMatch(html, /退出授权/);
  assert.doesNotMatch(html, /data-action="bilibili-login-sms"/);
  assert.doesNotMatch(html, /name="bilibiliPhone"/);
  assert.doesNotMatch(html, /name="bilibiliSmsCode"/);
  assert.doesNotMatch(html, />SMS</);
});

test("renders authorization retry action instead of QR placeholder after verification fails", () => {
  const html = renderWebRoomApp({
    ...joinedRoomState,
    authStatus: "unauthorized",
    authPanel: {
      open: true,
      method: "qr",
      phase: "failed",
      message: "Bilibili authorization could not be verified.",
    },
  });

  assert.match(html, /B 站授权未通过验证。/);
  assert.doesNotMatch(html, /Bilibili authorization could not be verified/);
  assert.match(html, /data-action="bilibili-login-qr"/);
  assert.match(html, /platform-auth-action/);
  assert.doesNotMatch(html, /class="auth-method auth-method-qr"/);
  assert.doesNotMatch(html, /auth-qr-placeholder/);
});

test("keeps Bilibili QR method hidden until the authorization action starts", () => {
  const html = renderWebRoomApp({
    ...joinedRoomState,
    authStatus: "unauthorized",
    authPanel: {
      open: true,
      method: "qr",
      phase: "idle",
    },
  });

  assert.match(html, /data-platform-id="bilibili"/);
  assert.match(html, /class="platform-logo platform-logo-bilibili"/);
  assert.match(html, /class="platform-logo-svg"/);
  assert.match(html, /aria-label="Bilibili 官方 Logo"/);
  assert.match(html, /data-action="bilibili-login-qr"/);
  assert.match(html, />授权<\/span>/);
  assert.doesNotMatch(html, /class="auth-method auth-method-qr"/);
  assert.doesNotMatch(html, /auth-qr-placeholder/);
  assert.doesNotMatch(html, /data-action="bilibili-logout"/);
});

test("localizes pending QR authorization and offers a collapse action", () => {
  const html = renderWebRoomApp({
    ...joinedRoomState,
    authStatus: "checking",
    authPanel: {
      open: true,
      method: "qr",
      phase: "pending",
      qrCodeUrl: "data:image/png;base64,qr",
      message: "Waiting for scan.",
    },
  });

  assert.match(html, /等待扫码/);
  assert.doesNotMatch(html, /Waiting for scan/);
  assert.match(html, /data-action="collapse-bilibili-auth"/);
  assert.match(html, /data-action="bilibili-login-qr"/);
  assert.match(html, /data-ui-icon="refresh"/);
  assert.match(html, />收起二维码<\/span>/);
  assert.match(html, />刷新<\/span>/);
  assert.match(html, /class="auth-method auth-method-qr"/);
});

test("localizes iQIYI authorization status inside the platform list", () => {
  const html = renderWebRoomApp({
    ...joinedRoomState,
    authStatus: "checking",
    authPanel: {
      open: true,
      providerId: "iqiyi",
      method: "qr",
      phase: "pending",
      qrCodeUrl: "data:image/png;base64,iqiyi-qr",
      message: "Scan the iQIYI QR code to authorize playback.",
    },
  });

  assert.match(html, /data-platform-id="iqiyi"/);
  assert.match(html, /请使用爱奇艺 App 扫描二维码。/);
  assert.doesNotMatch(html, /Scan the iQIYI QR code/);
  assert.match(html, /class="auth-method auth-method-qr"/);
  assert.match(html, /alt="iQIYI QR"/);
  assert.match(html, /data-action="collapse-bilibili-auth"/);
  assert.match(html, /data-action="iqiyi-login-qr"/);
  assert.match(html, /data-ui-icon="refresh"/);
  assert.match(html, />刷新<\/span>/);
});

test("keeps inactive platform authorization actions visible while Huya QR is expanded", () => {
  const html = renderWebRoomApp({
    ...joinedRoomState,
    authStatus: "checking",
    authPanel: {
      open: true,
      providerId: "huya",
      method: "qr",
      phase: "loading",
      qrCodeUrl: "data:image/png;base64,huya",
    },
  });

  const bilibiliStart = html.indexOf('data-platform-id="bilibili"');
  const iqiyiStart = html.indexOf('data-platform-id="iqiyi"');
  const huyaStart = html.indexOf('data-platform-id="huya"');
  assert.ok(bilibiliStart >= 0);
  assert.ok(iqiyiStart > bilibiliStart);
  assert.ok(huyaStart > iqiyiStart);
  const bilibiliRow = html.slice(bilibiliStart, iqiyiStart);
  const iqiyiRow = html.slice(iqiyiStart, huyaStart);
  const huyaRow = html.slice(huyaStart);

  assert.match(
    bilibiliRow,
    /class="secondary-button platform-auth-action" data-action="bilibili-login-qr"/,
  );
  assert.match(
    iqiyiRow,
    /class="secondary-button platform-auth-action" data-action="iqiyi-login-qr"/,
  );
  assert.doesNotMatch(
    huyaRow,
    /class="secondary-button platform-auth-action" data-action="huya-login-qr"/,
  );
  assert.match(huyaRow, /class="auth-method auth-method-qr"/);
});

test("keeps authorized iQIYI profile out of the Bilibili authorization row", () => {
  const html = renderWebRoomApp({
    ...joinedRoomState,
    authStatus: "authorized",
    authPanel: {
      open: true,
      providerId: "iqiyi",
      method: "qr",
      phase: "authorized",
      profileName: "爱奇艺用户",
    },
  });

  const bilibiliStart = html.indexOf('data-platform-id="bilibili"');
  const iqiyiStart = html.indexOf('data-platform-id="iqiyi"');
  assert.ok(bilibiliStart >= 0);
  assert.ok(iqiyiStart > bilibiliStart);
  const bilibiliRow = html.slice(bilibiliStart, iqiyiStart);
  const iqiyiRow = html.slice(iqiyiStart);

  assert.doesNotMatch(bilibiliRow, /爱奇艺用户/);
  assert.match(bilibiliRow, /B 站账号授权/);
  assert.match(iqiyiRow, /爱奇艺用户/);
});

test("keeps authorized Huya profile scoped to the Huya authorization row", () => {
  const html = renderWebRoomApp({
    ...joinedRoomState,
    authStatus: "authorized",
    authPanel: {
      open: true,
      providerId: "huya",
      method: "qr",
      phase: "authorized",
      profileName: "Huya User",
    },
  });

  const bilibiliStart = html.indexOf('data-platform-id="bilibili"');
  const iqiyiStart = html.indexOf('data-platform-id="iqiyi"');
  const huyaStart = html.indexOf('data-platform-id="huya"');
  assert.ok(bilibiliStart >= 0);
  assert.ok(iqiyiStart > bilibiliStart);
  assert.ok(huyaStart > iqiyiStart);
  const bilibiliRow = html.slice(bilibiliStart, iqiyiStart);
  const iqiyiRow = html.slice(iqiyiStart, huyaStart);
  const huyaRow = html.slice(huyaStart);

  assert.doesNotMatch(bilibiliRow, /Huya User/);
  assert.doesNotMatch(iqiyiRow, /Huya User/);
  assert.match(huyaRow, /Huya User/);
});

test("omits text-chat danmaku controls from the chat input", () => {
  const html = renderWebRoomApp(joinedRoomState);

  assert.doesNotMatch(html, /class="danmaku-color-input"/);
  assert.doesNotMatch(html, /name="danmakuColor"/);
  assert.doesNotMatch(html, /data-action="send-danmaku"/);
  assert.match(html, /data-action="send-chat"/);
  assert.match(html, /data-action="voice-toggle"/);
});

test("renders Bilibili QR auth data url as an image source", () => {
  const html = renderWebRoomApp({
    ...joinedRoomState,
    authStatus: "checking",
    authPanel: {
      open: true,
      method: "qr",
      phase: "pending",
      qrCodeUrl: "data:image/png;base64,qr",
      message: "Scan the Bilibili QR code to authorize playback.",
    },
  });

  assert.match(html, /请使用 B 站 App 扫描二维码。/);
  assert.doesNotMatch(html, /Scan the Bilibili QR code/);
  assert.match(
    html,
    /<img class="auth-qr" src="data:image\/png;base64,qr" alt="Bilibili QR" \/>/,
  );
  assert.doesNotMatch(html, /auth-qr-placeholder/);
});

test("renders verified Bilibili auth profile details", () => {
  const html = renderWebRoomApp({
    ...joinedRoomState,
    authStatus: "authorized",
    authPanel: {
      open: true,
      method: "qr",
      phase: "authorized",
      profileName: "Alice Bili",
      vipLabel: "annual",
    },
  });

  assert.match(html, /Alice Bili - annual/);
});

test("renders provider proxy and shared unchecked by default", () => {
  const html = renderWebRoomApp({
    ...joinedRoomState,
    providerPicker: undefined,
  });

  assert.match(html, /name="providerProxy" type="checkbox"/);
  assert.match(html, /name="providerShared" type="checkbox"/);
  assert.doesNotMatch(html, /name="providerProxy" checked type="checkbox"/);
  assert.doesNotMatch(html, /name="providerShared" checked type="checkbox"/);
});

test("renders host picker controls for Bilibili parse results and playback policy", () => {
  const html = renderWebRoomApp({
    ...joinedRoomState,
    providerPicker: {
      open: true,
      status: "ready",
      url: "https://www.bilibili.com/video/BV1TEST",
      proxy: true,
      shared: true,
      selectedItemId: "cid-1",
      selectedQualityCandidateId: "dash-avc-720p",
      message: "Parsed title should stay out of the header",
      items: [
        {
          itemId: "cid-1",
          title: "Part 1",
          kind: "part",
          qualityLabel: "1080P",
          sourceType: "mp4",
          providerDescriptor: {
            providerId: "bilibili",
            sourceId: "BV1TEST",
            sourceUrl: "https://www.bilibili.com/video/BV1TEST",
            title: "Bilibili video",
            item: {
              itemId: "cid-1",
              title: "Part 1",
              kind: "part",
              bvid: "BV1TEST",
              cid: "1",
            },
            policy: {
              proxy: true,
              shared: true,
            },
            candidates: [
              {
                id: "dash-avc-1080p",
                sourceType: "mpd",
                url: "https://syncroom.example.test/proxy/manifest/1080.mpd",
                qualityLabel: "1080P",
                codecs: "avc1.640028",
                default: true,
              },
              {
                id: "dash-avc-720p",
                sourceType: "mpd",
                url: "https://syncroom.example.test/proxy/manifest/720.mpd",
                qualityLabel: "720P",
                codecs: "avc1.64001f",
              },
            ],
            defaultCandidateId: "dash-avc-1080p",
          },
        },
        {
          itemId: "ep-2",
          title: "Episode 2",
          kind: "episode",
          qualityLabel: "720P",
          sourceType: "m3u8",
        },
      ],
    },
  });

  assert.match(html, /data-panel="host-picker"/);
  assert.match(html, /data-picker-status="ready"/);
  assert.match(html, /name="bilibiliUrl"/);
  assert.match(html, /data-action="parse-bilibili-url"/);
  assert.match(html, /name="providerProxy" checked/);
  assert.match(html, /name="providerShared" checked/);
  const pickerStart = html.indexOf('data-panel="host-picker"');
  const headingStart = html.indexOf(
    'class="settings-tile-heading"',
    pickerStart,
  );
  const headingHtml = html.slice(
    headingStart,
    html.indexOf("</div>", headingStart),
  );
  assert.doesNotMatch(
    headingHtml,
    /Parsed title should stay out of the header/,
  );
  assert.match(html, /data-action="select-provider-item"/);
  assert.match(html, /data-item-id="cid-1"/);
  assert.match(html, /data-item-selected="true"/);
  const selectedItemStart = html.indexOf('data-item-id="cid-1"');
  const selectedItemHtml = html.slice(
    html.lastIndexOf("<button", selectedItemStart),
    html.indexOf("</button>", selectedItemStart),
  );
  assert.match(selectedItemHtml, /Bilibili video/);
  assert.match(selectedItemHtml, /part \/ 720P \/ AVC \/ mpd/);
  assert.doesNotMatch(selectedItemHtml, /part \/ 1080P \/ mp4/);
  assert.doesNotMatch(selectedItemHtml, />Part 1</);
  assert.match(html, /data-action="select-provider-quality"/);
  assert.match(html, /data-candidate-id="dash-avc-720p"/);
  assert.match(html, /data-quality-selected="true"/);
  assert.match(html, /1080P/);
  assert.match(html, /720P \/ AVC \/ mpd/);
  assert.match(html, /data-action="share-provider-item"/);
  const providerUrlRowStart = html.indexOf('class="provider-url-row"');
  const providerUrlRowHtml = html.slice(
    providerUrlRowStart,
    html.indexOf("</div>", providerUrlRowStart),
  );
  assert.match(providerUrlRowHtml, /data-action="parse-bilibili-url"/);
  assert.match(providerUrlRowHtml, /data-action="share-provider-item"/);
  assert.ok(
    providerUrlRowHtml.indexOf('data-action="parse-bilibili-url"') <
      providerUrlRowHtml.indexOf('data-action="share-provider-item"'),
  );
});

test("omits the default provider picker helper copy", () => {
  const html = renderWebRoomApp(joinedRoomState);
  const pickerStart = html.indexOf('data-panel="host-picker"');
  const pickerHtml = html.slice(
    pickerStart,
    html.indexOf("</section>", pickerStart),
  );

  assert.match(pickerHtml, /点播解析/);
  assert.doesNotMatch(pickerHtml, /通用链接/);
});

test("escapes chat text and keeps messages in the page lifecycle model", () => {
  const html = renderWebRoomApp(joinedRoomState);

  assert.match(html, /&lt;img src=x onerror=alert\(1\)&gt;/);
  assert.doesNotMatch(html, /<img src=x/);
});

test("disables chat send while server cooldown is active", () => {
  const html = renderWebRoomApp({
    ...joinedRoomState,
    chatCooldownUntil: Date.now() + 4_000,
  });

  assert.match(html, /data-chat-cooldown="true"/);
  assert.match(html, /data-action="send-chat" disabled/);
  assert.match(html, /data-chat-cooldown-seconds="4"/);
  assert.match(html, />4s<\/span>/);
});

test("renders direct playback failure with host proxy fallback action", () => {
  const html = renderWebRoomApp({
    ...joinedRoomState,
    playbackError: {
      code: "direct_playback_failed",
      stage: "manifest",
      message: "Direct link failed because the browser blocked the manifest.",
      canUseProxyFallback: true,
    },
  });
  const playerRegion = html.slice(
    html.indexOf('data-region="player"'),
    html.indexOf('data-panel="chat"'),
  );
  const settingsRegion = html.slice(
    html.indexOf('data-region="room-settings"'),
  );

  assert.match(html, /role="alert"/);
  assert.match(html, /data-playback-error-stage="manifest"/);
  assert.match(html, /Direct link failed/);
  assert.match(html, /data-action="retry-provider-proxy"/);
  assert.doesNotMatch(playerRegion, /role="alert"/);
  assert.doesNotMatch(playerRegion, /data-playback-error-stage/);
  assert.match(settingsRegion, /role="alert"/);
  assert.match(settingsRegion, /data-action="retry-provider-proxy"/);
});

test("exposes member-safe authorization state for non-host users", () => {
  const html = renderWebRoomApp({
    ...joinedRoomState,
    currentMemberId: "member-2",
    providerPlaybackStatus: {
      providerId: "bilibili",
      itemTitle: "Part 1",
      sourceType: "mpd",
      proxy: true,
      shared: false,
    },
  });

  assert.doesNotMatch(html, /data-region="title-auth"/);
  assert.doesNotMatch(html, /data-auth-host="false"/);
  assert.doesNotMatch(html, /data-panel="authorization-entry"/);
  assert.doesNotMatch(html, /data-provider-playback-status="safe"/);
  assert.doesNotMatch(html, /proxy:on|shared:off/);
  assert.doesNotMatch(html, /data-action="bilibili-login"/);
  assert.doesNotMatch(html, /data-action="authorization-management"/);
  assert.doesNotMatch(html, /data-action="bilibili-logout"/);
  assert.doesNotMatch(html, /data-action="share-provider-item"/);
  assert.doesNotMatch(html, /SESSDATA|Cookie|manifest-1\.mpd/i);
});

test("defines narrow viewport region order from the supplied layout", () => {
  assert.deepEqual(NARROW_ROOM_REGION_ORDER, [
    "announcement",
    "player",
    "chat",
    "room-info",
    "room-settings",
  ]);
});

test("uses web-room theme tokens derived from the extension popup", () => {
  assert.equal(webRoomThemeTokens.background, "#f2f5f8");
  assert.equal(webRoomThemeTokens.textPrimary, "#202838");
  assert.equal(webRoomThemeTokens.primary, "#d95f7c");
  assert.equal(webRoomThemeTokens.borderRadius.panel, 8);
});
