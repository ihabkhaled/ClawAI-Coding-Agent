import { iconMarkup } from './chat-icons';

import type { ChatMarkupTranslator } from './chat-markup.types';

/**
 * The composer owns the three controls a run depends on most — model, run mode
 * and effort — inline beside Send. Everything else stays one click away in the
 * settings popover, which is anchored to the card so it can never be clipped by
 * a narrow panel.
 */
export function renderComposerMarkup(translated: ChatMarkupTranslator): string {
  return `<form id="composer" class="composer">
      <div class="composer-card">
        <div id="contextHint" class="context-hint">
          <span class="context-icon" aria-hidden="true">&#9101;</span>
          <span id="contextHintText">${translated('Smart context will choose the best available source')}</span>
        </div>
        <label class="sr-only" for="prompt">${translated('Ask ClawAI')}</label>
        <textarea id="prompt" class="prompt-field" rows="2" maxlength="20000" placeholder="${translated('Ask ClawAI to inspect, plan, or build…')}" required></textarea>
        <div id="attachmentTray" class="attachment-tray" hidden>
          <div id="attachmentList" class="attachment-list" role="list" aria-label="${translated('Attachments')}"></div>
          <p id="attachmentStatus" class="attachment-status" role="status" aria-live="polite"></p>
        </div>
        <div class="control-rail primary-control-rail">
          <input id="attachmentInput" class="sr-only" type="file" multiple>
          <button id="attachmentButton" class="icon-button attachment-button" type="button" title="${translated('Attach files')}" aria-label="${translated('Attach files')}">
            ${iconMarkup('attach')}
          </button>
          <label class="compact-control model-control" for="modelSelect"><span>${translated('Model')}</span>
            <select id="modelSelect" aria-label="${translated('Model')}" title="${translated('Automatic routing')}">
              <option value="AUTO">${translated('Automatic routing')}</option>
            </select>
          </label>
          <label class="compact-control run-control" for="runMode"><span>${translated('Run')}</span>
            <select id="runMode" aria-label="${translated('Run')}" title="${translated('Agent')}">
              <option value="agent">${translated('Agent')}</option>
              <option value="chat">${translated('Chat')}</option>
              <option value="compare">${translated('Compare')}</option>
              <option value="judge">${translated('Compare + Judge')}</option>
            </select>
          </label>
          <label class="compact-control effort-control" for="effortMode"><span>${translated('Effort')}</span>
            <select id="effortMode" aria-label="${translated('Effort')}" title="${translated('Ultra')}">
              <option value="LOW">${translated('Low')}</option>
              <option value="MEDIUM">${translated('Medium')}</option>
              <option value="HIGH">${translated('High')}</option>
              <option value="MAX">${translated('Max')}</option>
              <option value="XHIGH">${translated('xHigh')}</option>
              <option value="ULTRA">${translated('Ultra')}</option>
            </select>
          </label>
          <details id="moreSettings" class="more-settings">
            <summary id="moreSettingsSummary" title="${translated('More settings')}">${iconMarkup('settings')}<span class="more-settings-label">${translated('More settings')}</span></summary>
            <div class="secondary-controls">
              <label class="compact-control" for="agentMode"><span>${translated('Agent')}</span>
                <select id="agentMode" aria-label="${translated('Agent')}" title="${translated('Auto')}">
                  <option value="AUTO">${translated('Auto')}</option>
                  <option value="PLAN">${translated('Plan mode')}</option>
                </select>
              </label>
              <label class="compact-control" for="speedMode"><span>${translated('Speed')}</span>
                <select id="speedMode" aria-label="${translated('Speed')}" title="${translated('1X')}">
                  <option value="1X">${translated('1X')}</option>
                  <option value="1.5X">${translated('1.5X')}</option>
                  <option value="2X">${translated('2X')}</option>
                </select>
              </label>
              <label class="compact-control" for="permissionMode"><span>${translated('Approval')}</span>
                <select id="permissionMode" aria-label="${translated('Approval')}" title="${translated('Ask for Approval')}">
                  <option value="PLAN">${translated('Plan')}</option>
                  <option value="ASK">${translated('Ask for Approval')}</option>
                  <option value="AUTO_EDIT">${translated('Auto Edit')}</option>
                  <option value="AUTONOMOUS_SCOPED">${translated('Autonomous Scoped')}</option>
                  <option value="ENTERPRISE_LOCKED">${translated('Enterprise Locked')}</option>
                </select>
              </label>
              <label class="compact-control" for="contextMode"><span>${translated('Context')}</span>
                <select id="contextMode" aria-label="${translated('Context')}" title="${translated('Smart context')}">
                  <option value="smart">${translated('Smart context')}</option>
                  <option value="file">${translated('Active file')}</option>
                  <option value="selection">${translated('Selection')}</option>
                  <option value="workspace">${translated('Workspace')}</option>
                  <option value="none">${translated('None')}</option>
                </select>
              </label>
              <label class="compact-control" for="researchMode"><span>${translated('Web research')}</span>
                <select id="researchMode" aria-label="${translated('Web research')}" title="${translated('Off')}">
                  <option value="NONE">${translated('Off')}</option>
                  <option value="SEARCH">${translated('Search')}</option>
                  <option value="SEARCH_FETCH">${translated('Search + fetch')}</option>
                  <option value="SEARCH_EXTRACT">${translated('Search + extract')}</option>
                </select>
              </label>
              <label class="compact-control" for="themeMode"><span>${translated('Theme')}</span>
                <select id="themeMode" aria-label="${translated('Theme')}" title="${translated('Follow VS Code')}">
                  <option value="system">${translated('Follow VS Code')}</option>
                  <option value="light">${translated('Light')}</option>
                  <option value="dark">${translated('Dark')}</option>
                </select>
              </label>
              <div class="secondary-actions">
                <button id="externalOutputButton" class="quiet-button external-output-button" type="button">${translated('Output folders')}</button>
                <button id="connectionSettingsButton" class="quiet-button external-output-button" type="button">${translated('App connections')}</button>
              </div>
            </div>
          </details>
          <div class="actions">
            <button id="sendButton" class="send-button" type="submit" aria-label="${translated('Send message')}" title="${translated('Send · Ctrl/⌘ + Enter')}">
              <span id="sendButtonLabel" class="send-label">${translated('Send')}</span>
              ${iconMarkup('send')}
            </button>
          </div>
        </div>
      </div>
      <p class="composer-footnote">${translated('Ctrl/⌘ + Enter to send · approval follows the selected mode')}</p>
    </form>`;
}
