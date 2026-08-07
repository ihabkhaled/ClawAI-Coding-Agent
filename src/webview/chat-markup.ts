import {
  BACKEND_CLOUD_URL,
  BACKEND_LOCAL_URL,
  FRONTEND_CLOUD_URL,
  FRONTEND_LOCAL_URL,
} from '../core/configuration';

export interface ChatMarkupInput {
  cspSource: string;
  language: string;
  nonce: string;
  logoUri: string;
  scriptUri: string;
  styleUri: string;
  translate(message: string): string;
}

type ClawIconName = 'attach' | 'explain' | 'plan' | 'review' | 'test';

const iconPaths: Record<ClawIconName, string> = {
  attach:
    '<path d="M6 8.5 11.5 3a2.5 2.5 0 0 1 3.5 3.5L8.5 13a4 4 0 0 1-5.5-5.5L9 1.5"/><path d="m5.5 9 6-6"/>',
  explain: '<circle cx="8" cy="8" r="6"/><path d="M8 11V7.5M8 5h.01"/>',
  plan: '<path d="M2 4h12M2 8h8M2 12h5"/><path d="m10 12 1.5 1.5L15 10"/>',
  review: '<path d="m2 8 3 3 7-7"/><path d="M14 8a6 6 0 1 1-3-5.2"/>',
  test: '<path d="M6 2v4l-4 7a2 2 0 0 0 2 3h8a2 2 0 0 0 2-3l-4-7V2"/><path d="M5 10h6M5 2h6"/>',
};

export function iconMarkup(name: ClawIconName): string {
  return `<svg class="claw-icon" viewBox="0 0 16 16" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">${iconPaths[name]}</svg>`;
}

function escapeHtml(value: string): string {
  return value
    .replaceAll('&', '&amp;')
    .replaceAll('<', '&lt;')
    .replaceAll('>', '&gt;')
    .replaceAll('"', '&quot;');
}

export function renderChatMarkup(input: ChatMarkupInput): string {
  const translated = (message: string): string => escapeHtml(input.translate(message));
  const locale = input.language.split('-')[0] ?? 'en';
  const direction = locale === 'ar' || locale === 'fa' ? 'rtl' : 'ltr';
  const languageNames: Readonly<Record<string, string>> = {
    en: 'English',
    ar: 'العربية',
    de: 'Deutsch',
    es: 'Español',
    fa: 'فارسی',
    fr: 'Français',
    hi: 'हिन्दी',
    it: 'Italiano',
    ja: '日本語',
    pt: 'Português',
    ru: 'Русский',
    th: 'ไทย',
    zh: '简体中文',
  };
  const languageName = languageNames[locale] ?? locale.toUpperCase();
  const csp = [
    "default-src 'none'",
    `img-src ${input.cspSource} data: blob:`,
    'connect-src blob:',
    `font-src ${input.cspSource}`,
    `style-src ${input.cspSource}`,
    `script-src 'nonce-${input.nonce}'`,
  ].join('; ');

  return `<!doctype html>
<html lang="${escapeHtml(input.language)}" dir="${direction}">
<head>
  <meta charset="UTF-8">
  <meta http-equiv="Content-Security-Policy" content="${escapeHtml(csp)}">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <link href="${escapeHtml(input.styleUri)}" rel="stylesheet">
  <title>${translated('ClawAI Coding Agent')}</title>
</head>
<body>
  <a id="skipLink" class="skip-link" href="#backendUrlInput">${translated('Skip to connection')}</a>
  <main class="shell">
    <header id="workspaceBar" class="workspace-bar">
      <img class="brand-logo" src="${escapeHtml(input.logoUri)}" alt="">
      <strong id="disconnectedBrand" class="disconnected-brand">${translated('ClawAI Coding Agent')}</strong>
      <div id="workspaceIdentity" class="workspace-identity" hidden>
        <div class="conversation-heading">
          <strong id="conversationTitle">${translated('New ClawAI chat')}</strong>
        </div>
        <div class="workspace-line">
          <strong id="workspaceName">${translated('No workspace')}</strong>
          <select id="workspaceSelect" class="workspace-select" aria-label="${translated('Agent workspace folder')}" hidden></select>
          <span id="trustBadge" class="badge">${translated('No folder')}</span>
        </div>
      </div>
      <div id="workspaceActions" class="workspace-actions" hidden>
        <label class="sr-only" for="historySelect">${translated('Conversation history')}</label>
        <select id="historySelect" class="history-select" aria-label="${translated('Conversation history')}">
          <option value="">${translated('Recent conversations')}</option>
        </select>
        <button id="openFolderButton" class="quiet-button" type="button" hidden>${translated('Open folder')}</button>
        <button id="refreshModelsButton" class="icon-button" type="button" title="${translated('Refresh models')}" aria-label="${translated('Refresh models')}">↻</button>
        <button id="newChatButton" class="icon-button" type="button" title="${translated('New conversation')}" aria-label="${translated('New conversation')}">＋</button>
        <button id="languageButton" class="quiet-button language-button" type="button" title="${translated('Change display language')}" aria-label="${translated('Change display language')}"><span aria-hidden="true">文</span><span>${escapeHtml(languageName)}</span><span aria-hidden="true">⌄</span></button>
        <button id="sessionButton" class="quiet-button" type="button">${translated('Connect')}</button>
      </div>
    </header>

    <section id="connectionGate" class="connection-gate" aria-labelledby="connectionTitle">
      <div class="connection-card">
        <div class="connection-hero">
          <span class="connection-logo-wrap"><img class="connection-logo" src="${escapeHtml(input.logoUri)}" alt=""></span>
          <p class="utility-label">${translated('GET STARTED')}</p>
          <h1 id="connectionTitle">${translated('Connect to ClawAI')}</h1>
          <p>${translated('Choose your ClawAI app address, then authorize securely in your browser.')}</p>
        </div>
        <form id="connectionForm" class="connection-form">
          <fieldset class="endpoint-fieldset">
            <legend>${translated('Backend')}</legend>
            <small>${translated('API, authentication, models, and agent runs')}</small>
            <div class="environment-options">
              <label><input id="backendEnvironmentLocal" type="radio" name="backendEnvironment" value="LOCAL" checked><span><strong>${translated('Local')}</strong><small>${BACKEND_LOCAL_URL}</small></span></label>
              <label><input id="backendEnvironmentCloud" type="radio" name="backendEnvironment" value="CLOUD"><span><strong>${translated('Cloud')}</strong><small>${BACKEND_CLOUD_URL}</small></span></label>
              <label><input id="backendEnvironmentCustom" type="radio" name="backendEnvironment" value="CUSTOM"><span><strong>${translated('Custom')}</strong><small>${translated('Use another server')}</small></span></label>
            </div>
            <label class="custom-endpoint" for="backendUrlInput" hidden>${translated('Custom backend URL')}
              <input id="backendUrlInput" name="backendCustomUrl" type="url" placeholder="${BACKEND_LOCAL_URL}" maxlength="2000" autocomplete="url" spellcheck="false">
            </label>
          </fieldset>
          <fieldset class="endpoint-fieldset">
            <legend>${translated('Frontend')}</legend>
            <small>${translated('Browser authorization and app links')}</small>
            <div class="environment-options">
              <label><input id="frontendEnvironmentLocal" type="radio" name="frontendEnvironment" value="LOCAL" checked><span><strong>${translated('Local')}</strong><small>${FRONTEND_LOCAL_URL}</small></span></label>
              <label><input id="frontendEnvironmentCloud" type="radio" name="frontendEnvironment" value="CLOUD"><span><strong>${translated('Cloud')}</strong><small>${FRONTEND_CLOUD_URL}</small></span></label>
              <label><input id="frontendEnvironmentCustom" type="radio" name="frontendEnvironment" value="CUSTOM"><span><strong>${translated('Custom')}</strong><small>${translated('Use another web app')}</small></span></label>
            </div>
            <label class="custom-endpoint" for="frontendUrlInput" hidden>${translated('Custom frontend URL')}
              <input id="frontendUrlInput" name="frontendCustomUrl" type="url" placeholder="${FRONTEND_LOCAL_URL}" maxlength="2000" autocomplete="url" spellcheck="false">
            </label>
          </fieldset>
          <button id="connectButton" class="connect-button" type="submit">
            <span id="connectButtonLabel">${translated('Connect to ClawAI')}</span>
            <b aria-hidden="true">&rarr;</b>
          </button>
        </form>
        <div id="connectionProgress" class="connection-progress" hidden>
          <span class="connection-spinner" aria-hidden="true"></span>
          <span role="status">${translated('Opening secure browser authorization...')}</span>
          <button id="connectionCancelButton" class="quiet-button connection-cancel-button" type="button">${translated('Cancel')}</button>
        </div>
        <p id="connectionError" class="connection-error" role="alert" hidden></p>
        <div class="connection-security">
          <span aria-hidden="true">&#8961;</span>
          <p><strong>${translated('Browser-based sign in')}</strong><small>${translated('Passwords never enter VS Code. Your session is stored securely and reused across windows.')}</small></p>
        </div>
      </div>
    </section>

    <div id="authenticatedUi" class="authenticated-ui" hidden>
    <section class="agent-status signal-status" aria-label="${translated('Agent status')}">
      <div class="status-row">
        <button id="routeToggle" class="route-summary" type="button" aria-expanded="false" aria-controls="routeRail">
          <span id="backendDot" class="status-shape" aria-hidden="true"></span>
          <span class="route-copy">
            <small class="route-eyebrow">${translated('Current model')}</small>
            <strong id="routeModel">AUTO</strong>
            <small id="backendLabel">${translated('Disconnected')}</small>
          </span>
          <span class="chevron" aria-hidden="true">⌄</span>
        </button>
        <span id="conversationTokenMeter" class="token-chip conversation-token-meter" role="status" aria-live="polite" aria-label="${translated('Conversation token usage')}">
          <span class="token-symbol" aria-hidden="true">◈</span>
          <span id="tokenCount">—</span>
        </span>
        <span id="activeModeBadge" class="badge accent-badge">${translated('Auto')}</span>
      </div>
      <dl id="routeRail" class="route-rail" hidden>
        <div><dt>${translated('Routing')}</dt><dd id="routeMode">${translated('Automatic')}</dd></div>
        <div><dt>${translated('Context used')}</dt><dd id="contextCount">${translated('Not collected yet')}</dd></div>
        <div><dt>${translated('Agent behavior')}</dt><dd id="agentBehavior">${translated('Coding automatically')}</dd></div>
      </dl>
      <div id="modelWarnings" class="warning-stack" role="status"></div>
      <section id="runDeck" class="run-deck" aria-label="${translated('Runs')}" hidden>
        <header class="run-deck-header">
          <strong>${translated('Runs')}</strong>
          <span id="runDeckCount" class="run-count">${translated('0 running')}</span>
        </header>
        <ol id="activeRunList" class="active-run-list"></ol>
        <details id="waitingRuns" class="waiting-runs" hidden>
          <summary><span>${translated('Waiting')}</span><span id="waitingRunCount" class="badge">${translated('0 waiting')}</span></summary>
          <ol id="waitingRunList" class="waiting-run-list"></ol>
        </details>
      </section>
    </section>

    <section class="workbench" aria-label="${translated('Conversation workbench')}">
      <section id="emptyState" class="empty-state">
        <img class="empty-logo" src="${escapeHtml(input.logoUri)}" alt="">
        <p class="utility-label">${translated('WORKSPACE-READY AGENT')}</p>
        <h1>${translated('What should we build?')}</h1>
        <p>${translated('Ask a question, inspect the workspace, or start with a focused task.')}</p>
        <div class="suggestion-grid" aria-label="${translated('Suggested prompts')}">
          <button class="suggestion-card" type="button" data-prompt-kind="explain">
            <span class="suggestion-icon">${iconMarkup('explain')}</span>
            <span><strong>${translated('Explain')}</strong><small>${translated('Map how this workspace works')}</small></span>
          </button>
          <button class="suggestion-card" type="button" data-prompt-kind="plan">
            <span class="suggestion-icon">${iconMarkup('plan')}</span>
            <span><strong>${translated('Plan')}</strong><small>${translated('Design a safe implementation')}</small></span>
          </button>
          <button class="suggestion-card" type="button" data-prompt-kind="review">
            <span class="suggestion-icon">${iconMarkup('review')}</span>
            <span><strong>${translated('Review')}</strong><small>${translated('Find correctness and security risks')}</small></span>
          </button>
          <button class="suggestion-card" type="button" data-prompt-kind="test">
            <span class="suggestion-icon">${iconMarkup('test')}</span>
            <span><strong>${translated('Test')}</strong><small>${translated('Strengthen coverage and edge cases')}</small></span>
          </button>
        </div>
      </section>
      <section id="runtimeTimeline" class="runtime-timeline" aria-label="${translated('Coding agent activity')}" aria-live="polite" hidden></section>
      <section id="conversation" class="conversation execution-spine" aria-label="${translated('Conversation')}"></section>
    </section>

    <section id="modelTray" class="model-tray" aria-label="${translated('Compare models')}">
      <div class="section-heading">
        <div><p class="utility-label">${translated('PARALLEL RUN')}</p><strong>${translated('Compare model responses')}</strong></div>
        <span id="selectedModelCount" class="badge" aria-live="polite">${translated('0 of 5 selected')}</span>
      </div>
      <div id="selectedModelStrip" class="selected-model-strip" role="list" aria-label="${translated('Selected comparison models')}"></div>
      <p id="modelSelectionError" class="model-selection-error" role="alert" tabindex="-1" hidden></p>
      <div id="modelChecks" class="model-checks" role="group" aria-describedby="modelSelectionHelp modelSelectionError"></div>
      <p id="modelSelectionHelp" class="model-selection-help">${translated('Choose between 2 and 5 models.')}</p>
    </section>

    <form id="composer" class="composer">
      <div class="composer-card">
        <div id="contextHint" class="context-hint">
          <span class="context-icon" aria-hidden="true">⌁</span>
          <span id="contextHintText">${translated('Smart context will choose the best available source')}</span>
        </div>
        <label class="sr-only" for="prompt">${translated('Ask ClawAI')}</label>
        <textarea id="prompt" rows="3" maxlength="20000" placeholder="${translated('Ask ClawAI to inspect, plan, or build…')}" required></textarea>
        <div id="attachmentTray" class="attachment-tray" hidden>
          <div id="attachmentList" class="attachment-list" role="list" aria-label="${translated('Attachments')}"></div>
          <p id="attachmentStatus" class="attachment-status" role="status" aria-live="polite"></p>
        </div>
        <div class="control-rail primary-control-rail">
          <input id="attachmentInput" class="sr-only" type="file" multiple>
          <button id="attachmentButton" class="icon-button attachment-button" type="button" title="${translated('Attach files')}" aria-label="${translated('Attach files')}">
            ${iconMarkup('attach')}
          </button>
          <label class="compact-control model-control"><span>${translated('Model')}</span>
            <select id="modelSelect" aria-label="${translated('Model')}">
              <option value="AUTO">${translated('Automatic routing')}</option>
            </select>
          </label>
          <label class="compact-control run-control"><span>${translated('Run')}</span>
            <select id="runMode">
              <option value="agent">${translated('Agent')}</option>
              <option value="chat">${translated('Chat')}</option>
              <option value="compare">${translated('Compare')}</option>
              <option value="judge">${translated('Compare + Judge')}</option>
            </select>
          </label>
          <details id="moreSettings" class="more-settings">
            <summary id="moreSettingsSummary">${translated('More settings')}</summary>
            <div class="secondary-controls">
              <label class="compact-control"><span>${translated('Agent')}</span>
                <select id="agentMode">
                  <option value="AUTO">${translated('Auto')}</option>
                  <option value="PLAN">${translated('Plan mode')}</option>
                </select>
              </label>
              <label class="compact-control"><span>${translated('Approval')}</span>
                <select id="permissionMode">
                  <option value="PLAN">${translated('Plan')}</option>
                  <option value="ASK">${translated('Ask for Approval')}</option>
                  <option value="AUTO_EDIT">${translated('Auto Edit')}</option>
                  <option value="AUTONOMOUS_SCOPED">${translated('Autonomous Scoped')}</option>
                  <option value="ENTERPRISE_LOCKED">${translated('Enterprise Locked')}</option>
                </select>
              </label>
              <label class="compact-control"><span>${translated('Context')}</span>
                <select id="contextMode">
                  <option value="smart">${translated('Smart context')}</option>
                  <option value="file">${translated('Active file')}</option>
                  <option value="selection">${translated('Selection')}</option>
                  <option value="workspace">${translated('Workspace')}</option>
                  <option value="none">${translated('None')}</option>
                </select>
              </label>
              <label class="compact-control"><span>${translated('Web research')}</span>
                <select id="researchMode">
                  <option value="NONE">${translated('Off')}</option>
                  <option value="SEARCH">${translated('Search')}</option>
                  <option value="SEARCH_FETCH">${translated('Search + fetch')}</option>
                  <option value="SEARCH_EXTRACT">${translated('Search + extract')}</option>
                </select>
              </label>
              <button id="externalOutputButton" class="quiet-button external-output-button" type="button">${translated('Output folders')}</button>
              <button id="connectionSettingsButton" class="quiet-button external-output-button" type="button">${translated('App connections')}</button>
            </div>
          </details>
          <div class="actions">
            <button id="sendButton" class="send-button" type="submit" aria-label="${translated('Send')}"><span>${translated('Send')}</span><b aria-hidden="true">↑</b></button>
          </div>
        </div>
      </div>
      <p class="composer-footnote">${translated('Ctrl/⌘ + Enter to send · approval follows the selected mode')}</p>
    </form>
    </div>
    <p id="streamStatus" class="sr-only" role="status" aria-live="polite"></p>
    <p id="announcer" class="sr-only" aria-live="assertive"></p>
  </main>
  <div id="toastStack" class="toast-stack" role="status" aria-live="polite"></div>
  <section id="connectionSettingsPanel" class="approval-panel" role="dialog" aria-modal="true" aria-labelledby="connectionSettingsTitle" hidden>
    <form id="connectionSettingsForm" class="approval-card connection-settings-card">
      <header><strong id="connectionSettingsTitle">${translated('App connections')}</strong></header>
      <p>${translated('Choose where the extension sends API requests and opens browser pages.')}</p>
      <fieldset class="endpoint-fieldset"><legend>${translated('Backend')}</legend><div class="environment-options">
        <label><input id="settingsBackendLocal" type="radio" name="settingsBackendEnvironment" value="LOCAL"><span><strong>${translated('Local')}</strong><small>${BACKEND_LOCAL_URL}</small></span></label>
        <label><input id="settingsBackendCloud" type="radio" name="settingsBackendEnvironment" value="CLOUD"><span><strong>${translated('Cloud')}</strong><small>${BACKEND_CLOUD_URL}</small></span></label>
        <label><input id="settingsBackendCustom" type="radio" name="settingsBackendEnvironment" value="CUSTOM"><span><strong>${translated('Custom')}</strong></span></label>
      </div><label id="settingsBackendCustomWrap" class="custom-endpoint" for="settingsBackendUrl" hidden>${translated('Custom backend URL')}<input id="settingsBackendUrl" type="url" placeholder="${BACKEND_LOCAL_URL}" maxlength="2000"></label></fieldset>
      <fieldset class="endpoint-fieldset"><legend>${translated('Frontend')}</legend><div class="environment-options">
        <label><input id="settingsFrontendLocal" type="radio" name="settingsFrontendEnvironment" value="LOCAL"><span><strong>${translated('Local')}</strong><small>${FRONTEND_LOCAL_URL}</small></span></label>
        <label><input id="settingsFrontendCloud" type="radio" name="settingsFrontendEnvironment" value="CLOUD"><span><strong>${translated('Cloud')}</strong><small>${FRONTEND_CLOUD_URL}</small></span></label>
        <label><input id="settingsFrontendCustom" type="radio" name="settingsFrontendEnvironment" value="CUSTOM"><span><strong>${translated('Custom')}</strong></span></label>
      </div><label id="settingsFrontendCustomWrap" class="custom-endpoint" for="settingsFrontendUrl" hidden>${translated('Custom frontend URL')}<input id="settingsFrontendUrl" type="url" placeholder="${FRONTEND_LOCAL_URL}" maxlength="2000"></label></fieldset>
      <div class="approval-actions"><button id="connectionSettingsCancel" class="quiet-button" type="button">${translated('Cancel')}</button><button class="send-button" type="submit">${translated('Save connections')}</button></div>
    </form>
  </section>
  <section id="approvalPanel" class="approval-panel" role="dialog" aria-modal="true" aria-labelledby="approvalTitle" hidden>
    <div class="approval-card">
      <header>
        <span id="approvalKind" class="badge accent-badge">${translated('Approval required')}</span>
        <strong id="approvalTitle">${translated('Approval required')}</strong>
      </header>
      <p id="approvalMessage"></p>
      <ul id="approvalDetails" class="approval-details"></ul>
      <div class="approval-actions">
        <button id="approvalReject" class="quiet-button" type="button">${translated('Reject')}</button>
        <button id="approvalReview" class="quiet-button" type="button" hidden>${translated('Review changes')}</button>
        <button id="approvalApprove" class="send-button" type="button">${translated('Approve')}</button>
      </div>
    </div>
  </section>
  <div id="i18n" hidden
    data-auto="${translated('Auto')}"
    data-agent-behavior-coding="${translated('Coding automatically')}"
    data-agent-behavior-planning="${translated('Planning only')}"
    data-agent="${translated('Agent')}"
    data-agent-applied="${translated('Applied file changes')}"
    data-agent-executing="${translated('Running development commands')}"
    data-agent-failed="${translated('Coding run failed')}"
    data-agent-generating="${translated('Generating edit plan')}"
    data-agent-planned="${translated('Plan ready')}"
    data-agent-reading="${translated('Reading workspace')}"
    data-agent-rejected="${translated('Changes rejected')}"
    data-agent-repairing="${translated('Repairing model response')}"
    data-agent-reviewing="${translated('Reviewing file changes')}"
    data-agent-validating="${translated('Validating edit plan')}"
    data-agent-verified="${translated('Verified workspace changes')}"
    data-activity="${translated('Coding agent activity')}"
    data-always-allow="${translated('Always allow in this workspace')}"
    data-approval-required="${translated('Approval required')}"
    data-approve="${translated('Approve')}"
    data-attachment-added="${translated('Attachment added')}"
    data-attachment="${translated('attachment')}"
    data-attaching-files="${translated('Attaching files…')}"
    data-attachment-empty="${translated('Empty files cannot be attached.')}"
    data-attachment-limit-summary="${translated('{0}/10 attachments · {1}/50 MiB')}"
    data-attachment-read-failed="${translated('This file could not be attached.')}"
    data-attachment-too-large="${translated('Each attachment must be 25 MiB or smaller.')}"
    data-attachment-total-too-large="${translated('Attachments must total 50 MiB or less.')}"
    data-attachment-too-many="${translated('You can attach up to 10 files.')}"
    data-attachment-type-unsupported="${translated('This file type is not supported.')}"
    data-attachments="${translated('Attachments')}"
    data-assistant="${translated('CLAWAI')}"
    data-automatic-routing="${translated('Automatic routing')}"
    data-route-automatic="${translated('Automatic')}"
    data-route-selected="${translated('Selected by you')}"
    data-cancel-run="${translated('Cancel run: {0}')}"
    data-choose-models="${translated('Choose between 2 and 5 models.')}"
    data-connect="${translated('Connect')}"
    data-connect-clawai="${translated('Connect to ClawAI')}"
    data-connected="${translated('Connected')}"
    data-connecting="${translated('Connecting')}"
    data-compare-results="${translated('Compare results')}"
    data-opening-authorization="${translated('Opening authorization...')}"
    data-completed="${translated('Completed')}"
    data-cancelled="${translated('Cancelled')}"
    data-context-empty="${translated('No workspace context attached')}"
    data-context-file="${translated('Using the active file')}"
    data-context-selection="${translated('Using the active selection')}"
    data-context-workspace="${translated('Using the trusted workspace')}"
    data-context-not-collected="${translated('Not collected yet')}"
    data-context-summary="${translated('{0} files · {1}')}"
    data-copy="${translated('Copy response')}"
    data-copy-model="${translated('Copy model response')}"
    data-copied="${translated('Copied')}"
    data-error="${translated('Error')}"
    data-failed="${translated('Failed')}"
    data-file-changes="${translated('File changes')}"
    data-files="${translated('files')}"
    data-commands="${translated('commands')}"
    data-command-activity="${translated('Workspace command')}"
    data-connection-ready="${translated('Connected to ClawAI.')}"
    data-operation-create="${translated('Create')}"
    data-operation-delete="${translated('Delete')}"
    data-operation-update="${translated('Update')}"
    data-local="${translated('local')}"
    data-logout="${translated('Log out')}"
    data-new-chat="${translated('New ClawAI chat')}"
    data-no-folder="${translated('No folder')}"
    data-no-workspace="${translated('No workspace')}"
    data-prompt-explain="${translated('Explain the architecture of this workspace and identify the best starting points.')}"
    data-prompt-plan="${translated('Create a step-by-step implementation plan for my next change. Do not edit files.')}"
    data-prompt-review="${translated('Review this workspace for correctness, security, and maintainability risks.')}"
    data-prompt-test="${translated('Find the most important missing tests and propose meaningful edge cases.')}"
    data-judge-model="${translated('Judge: {0}')}"
    data-models-selected="${translated('{0} of 5 selected')}"
    data-plan-mode="${translated('Plan mode')}"
    data-queue="${translated('Queue')}"
    data-queued="${translated('Queued')}"
    data-ready="${translated('Ready')}"
    data-recent-conversations="${translated('Recent conversations')}"
    data-reasoning="${translated('Reasoning')}"
    data-reasoning-progress="${translated('Working through the request')}"
    data-request-accepted="${translated('Request accepted')}"
    data-preparing-run="${translated('ClawAI is preparing the run.')}"
    data-waiting-turn="${translated('Waiting for the active run to finish.')}"
    data-reported="${translated('reported')}"
    data-review-changes="${translated('Review changes')}"
    data-estimated="${translated('estimated')}"
    data-tokens="${translated('tokens')}"
    data-token-detail="${translated('Input {0} · Output {1}')}"
    data-timed-out="${translated('Timed out')}"
    data-warning-llamacpp="${translated('Local llama.cpp models could not be loaded. Refresh to retry.')}"
    data-warning-ollama="${translated('Local Ollama models could not be loaded. Refresh to retry.')}"
    data-workspace-file-activity="${translated('Workspace file change')}"
    data-reject="${translated('Reject')}"
    data-remove="${translated('Remove')}"
    data-remove-waiting="${translated('Remove waiting request: {0}')}"
    data-retry="${translated('Retry')}"
    data-running="${translated('Running')}"
    data-running-count="${translated('{0} running')}"
    data-runtime-turns="${translated('{0} turns · {1} retries')}"
    data-truncated="${translated('truncated')}"
    data-redacted="${translated('redacted')}"
    data-send="${translated('Send')}"
    data-skip-connection="${translated('Skip to connection')}"
    data-skip-composer="${translated('Skip to composer')}"
    data-trusted="${translated('Trusted')}"
    data-undo="${translated('Undo')}"
    data-untrusted="${translated('Restricted')}"
    data-waiting-capacity="${translated('Waiting for an available run slot')}"
    data-waiting-conversation="${translated('Waiting for this conversation')}"
    data-waiting-count="${translated('{0} waiting')}"
    data-you="${translated('YOU')}"></div>
  <script nonce="${escapeHtml(input.nonce)}" src="${escapeHtml(input.scriptUri)}"></script>
</body>
</html>`;
}
