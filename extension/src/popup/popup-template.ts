import { DEFAULT_SERVER_URL } from "../background/runtime-state";
import { escapeHtml } from "./helpers";
import { t } from "../shared/i18n";

export function renderPopupTemplate(): string {
  return `
    <div class="popup-shell">
      <header class="popup-header premium-header">
        <div class="brand">
          <span class="brand-mark" aria-hidden="true">
            <svg class="icon" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
              <path d="M3 21V9l9-7 9 7v12"></path>
              <path d="M9 21v-8h6v8"></path>
              <path d="M15 13h.01"></path>
            </svg>
          </span>
          <div class="brand-copy">
            <h1 class="popup-title brand-title">${escapeHtml(t("popupTitle"))}</h1>
            <p class="popup-tagline">${escapeHtml(t("popupTagline"))}</p>
          </div>
        </div>
        <span class="connection-status status-pill" id="server-status">-</span>
      </header>

      <section class="premium-panel room-command" id="room-panel-joined">
        <div class="premium-panel-inner">
          <div class="premium-room-top">
            <div>
              <div class="premium-room-label">${escapeHtml(t("metricCurrentRoomCode"))}</div>
              <div class="premium-room-code" id="room-status">-</div>
            </div>
            <span class="capacity-pill" id="members-status">-</span>
          </div>
          <div class="premium-actions room-actions">
            <button class="secondary compact-button copy-button" id="copy-room" type="button">
              <span class="button-icon-wrap" aria-hidden="true">
                <svg class="button-icon button-icon-copy" viewBox="0 0 16 16">
                  <rect x="5" y="3" width="8" height="10" rx="2" fill="none" stroke="currentColor" stroke-width="1.6"></rect>
                  <path d="M3.5 10.5V5.5C3.5 4.4 4.4 3.5 5.5 3.5" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round"></path>
                </svg>
                <svg class="button-icon button-icon-check" viewBox="0 0 16 16">
                  <path d="M3.2 8.3L6.6 11.4L12.8 4.9" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"></path>
                </svg>
              </span>
              <span class="button-label">${escapeHtml(t("actionCopyInvite"))}</span>
            </button>
            <button class="secondary compact-button danger-button" id="leave-room" type="button">
              <svg class="button-icon" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" aria-hidden="true">
                <path d="M9 21H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h4"></path>
                <path d="M16 17l5-5-5-5"></path>
                <path d="M21 12H9"></path>
              </svg>
              ${escapeHtml(t("actionLeaveRoom"))}
            </button>
          </div>
        </div>
      </section>

      <section class="premium-panel idle-room-panel" id="room-panel-idle">
        <div class="premium-panel-inner">
          <div class="premium-heading">
            <span class="premium-heading-left">
              <span class="room-heading-icon" aria-hidden="true">
                <svg class="icon" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
                  <path d="M3 21V9l9-7 9 7v12"></path>
                  <path d="M9 21v-8h6v8"></path>
                  <path d="M15 13h.01"></path>
                </svg>
              </span>
              ${escapeHtml(t("sectionRoom"))}
            </span>
            <span class="premium-meta">${escapeHtml(t("stateNotJoined"))}</span>
          </div>
          <div class="idle-room-copy">${escapeHtml(t("roomEntryHelp"))}</div>
          <div class="room-entry-row idle-entry-row">
            <button class="compact-button primary-button" id="create-room" type="button">${escapeHtml(t("actionCreateRoom"))}</button>
            <input class="idle-room-input" id="room-code" placeholder="${escapeHtml(t("roomCodePlaceholder"))}" aria-label="${escapeHtml(t("roomCodePlaceholder"))}">
            <button class="secondary compact-button" id="join-room" type="button">${escapeHtml(t("actionJoin"))}</button>
          </div>
          <div class="easter-egg" id="easter-egg" hidden>
            <span class="easter-mark" aria-hidden="true">
              <span class="easter-dot"></span>
              <span class="easter-dot"></span>
              <span class="easter-dot"></span>
            </span>
            <span class="easter-copy">
              <strong>${escapeHtml(t("easterEggTitle"))}</strong>
              <span>${escapeHtml(t("easterEggBody"))}</span>
            </span>
          </div>
        </div>
      </section>

      <div class="status-banner premium-banner" id="status-message" hidden></div>

      <section class="premium-panel video-panel" id="shared-video-panel">
        <div class="premium-panel-inner">
          <div class="premium-heading">
            <span class="premium-heading-left">
              <svg class="icon" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" aria-hidden="true">
                <path d="M15 10l4.5-2.5v9L15 14"></path>
                <rect x="3" y="6" width="12" height="12" rx="2"></rect>
              </svg>
              ${escapeHtml(t("sectionSharedVideo"))}
            </span>
            <span class="premium-meta" id="shared-video-meta">${escapeHtml(t("stateNotSynced"))}</span>
          </div>
          <button class="video-card video-card-button" id="shared-video-card" type="button">
            <div class="video-title" id="shared-video-title">
              <span class="video-title-text">${escapeHtml(t("stateNoSharedVideo"))}</span>
            </div>
          </button>
          <div class="video-subline">
            <div class="video-owner" id="shared-video-owner" hidden>
              <span class="video-owner-text" id="shared-video-owner-text">${escapeHtml(t("ownerSharedBy", { owner: "-" }))}</span>
            </div>
            <button class="secondary compact-button share-button" id="share-current-video" type="button">
              <svg class="button-icon" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" aria-hidden="true">
                <path d="M12 5v14"></path>
                <path d="M18 11l-6-6-6 6"></path>
              </svg>
              ${escapeHtml(t("actionShareCurrentVideo"))}
            </button>
          </div>
        </div>
      </section>

      <section class="premium-panel members-panel-card">
        <div class="premium-panel-inner">
          <div class="premium-heading">
            <span class="premium-heading-left">
              <svg class="icon" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" aria-hidden="true">
                <path d="M16 21v-2a4 4 0 0 0-4-4H6a4 4 0 0 0-4 4v2"></path>
                <circle cx="9" cy="7" r="4"></circle>
                <path d="M22 21v-2a4 4 0 0 0-3-3.87"></path>
                <path d="M16 3.13a4 4 0 0 1 0 7.75"></path>
              </svg>
              ${escapeHtml(t("sectionRoomMembers"))}
            </span>
            <span class="livekit-pill" id="voice-status">-</span>
          </div>
          <div class="member-table" id="member-list"></div>
          <div class="voice-error" id="voice-error" hidden></div>
        </div>
      </section>

      <section class="premium-panel advanced-panel-card">
        <details class="advanced-details" id="advanced-details">
          <summary class="advanced-summary advanced-row">
            <span class="advanced-label">
              <svg class="icon" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" aria-hidden="true">
                <path d="M4 7h10"></path>
                <path d="M18 7h2"></path>
                <circle cx="16" cy="7" r="2"></circle>
                <path d="M4 17h2"></path>
                <path d="M10 17h10"></path>
                <circle cx="8" cy="17" r="2"></circle>
              </svg>
              ${escapeHtml(t("sectionAdvancedInfo"))}
            </span>
            <span class="advanced-state-icon" id="advanced-state" aria-label="${escapeHtml(t("actionExpand"))}" title="${escapeHtml(t("actionExpand"))}">
              <svg class="advanced-state-chevron" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" aria-hidden="true">
                <path d="M6 9l6 6 6-6"></path>
              </svg>
            </span>
          </summary>

          <div class="advanced-content advanced-content-preview">
            <div class="setting-group advanced-field">
              <label class="field-label advanced-field-label" for="server-url">${escapeHtml(t("metricServerUrl"))}</label>
              <div class="settings-row advanced-setting-row">
                <input class="advanced-input" id="server-url" placeholder="${escapeHtml(DEFAULT_SERVER_URL)}">
                <button class="secondary compact-button advanced-mini-button" id="save-server-url" type="button">${escapeHtml(t("actionSave"))}</button>
              </div>
            </div>

            <div class="info-grid advanced-metrics">
              <div class="info-item advanced-metric">
                <span class="field-label advanced-metric-label">${escapeHtml(t("metricCurrentIdentity"))}</span>
                <span class="info-value advanced-metric-value" id="member-status">-</span>
              </div>
              <div class="info-item advanced-metric">
                <span class="field-label advanced-metric-label">${escapeHtml(t("metricReconnectCountdown"))}</span>
                <span class="info-value advanced-metric-value retry-status">
                  <span id="retry-status-value">-</span>
                  <span class="retry-status-count" id="retry-status-count"></span>
                </span>
              </div>
              <div class="info-item advanced-metric">
                <span class="field-label advanced-metric-label">${escapeHtml(t("metricClockOffset"))}</span>
                <span class="info-value advanced-metric-value" id="clock-offset-status">-</span>
              </div>
              <div class="info-item advanced-metric">
                <span class="field-label advanced-metric-label">${escapeHtml(t("metricClockRtt"))}</span>
                <span class="info-value advanced-metric-value" id="rtt-status">-</span>
              </div>
            </div>

            <div class="logs-header advanced-log-head">
              <div class="section-heading section-heading-small advanced-field-label">${escapeHtml(t("sectionDebugLogs"))}</div>
              <button class="secondary compact-button copy-button advanced-mini-button" id="copy-logs" type="button">
                  <span class="button-icon-wrap" aria-hidden="true">
                    <svg class="button-icon button-icon-copy" viewBox="0 0 16 16">
                      <rect x="5" y="3" width="8" height="10" rx="2" fill="none" stroke="currentColor" stroke-width="1.6"></rect>
                      <path d="M3.5 10.5V5.5C3.5 4.4 4.4 3.5 5.5 3.5" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round"></path>
                    </svg>
                    <svg class="button-icon button-icon-check" viewBox="0 0 16 16">
                      <path d="M3.2 8.3L6.6 11.4L12.8 4.9" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"></path>
                    </svg>
                  </span>
                  <span class="button-label">${escapeHtml(t("actionCopyLogs"))}</span>
              </button>
            </div>
            <div class="log-box advanced-log-box" id="debug-logs">
              <div class="log-empty advanced-log-line">${escapeHtml(t("stateNoLogs"))}</div>
            </div>
          </div>
        </details>
      </section>

      <div class="confirm-overlay" id="confirm-dialog" hidden>
        <div class="confirm-card" role="dialog" aria-modal="true" aria-labelledby="confirm-title" aria-describedby="confirm-description">
          <div class="confirm-mark" aria-hidden="true">
            <svg class="icon" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
              <path d="M12 5v14"></path>
              <path d="M18 11l-6-6-6 6"></path>
            </svg>
          </div>
          <div class="confirm-copy">
            <div class="confirm-title" id="confirm-title">-</div>
            <div class="confirm-description" id="confirm-description">-</div>
          </div>
          <div class="confirm-actions">
            <button class="secondary compact-button confirm-button-secondary" id="confirm-cancel" type="button">${escapeHtml(t("confirmDialogCancel"))}</button>
            <button class="compact-button confirm-button-primary" id="confirm-confirm" type="button">${escapeHtml(t("confirmReplaceVideo"))}</button>
          </div>
        </div>
      </div>
    </div>
  `;
}
