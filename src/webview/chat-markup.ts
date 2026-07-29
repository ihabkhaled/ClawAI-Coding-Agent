export interface ChatMarkupInput {
  cspSource: string;
  language: string;
  nonce: string;
  logoUri: string;
  scriptUri: string;
  styleUri: string;
  translate(message: string): string;
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
  const locale = input.language.split('-')[0];
  const direction = locale === 'ar' || locale === 'fa' ? 'rtl' : 'ltr';
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
          <label class="sr-only" for="historySelect">${translated('Conversation history')}</label>
          <select id="historySelect" class="history-select" aria-label="${translated('Conversation history')}">
            <option value="">${translated('Recent conversations')}</option>
          </select>
        </div>
        <div class="workspace-line">
          <strong id="workspaceName">${translated('No workspace')}</strong>
          <select id="workspaceSelect" class="workspace-select" aria-label="${translated('Agent workspace folder')}" hidden></select>
          <span id="trustBadge" class="badge">${translated('No folder')}</span>
        </div>
      </div>
      <div id="workspaceActions" class="workspace-actions" hidden>
        <button id="openFolderButton" class="quiet-button" type="button" hidden>${translated('Open folder')}</button>
        <button id="refreshModelsButton" class="icon-button" type="button" title="${translated('Refresh models')}" aria-label="${translated('Refresh models')}">↻</button>
        <button id="newChatButton" class="icon-button" type="button" title="${translated('New conversation')}" aria-label="${translated('New conversation')}">＋</button>
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
          <label for="backendUrlInput">${translated('ClawAI app address')}</label>
          <div class="connection-input-row">
            <span class="connection-lock" aria-hidden="true">&#9671;</span>
            <input id="backendUrlInput" name="backendUrl" type="url" value="https://claw.local" maxlength="2000" autocomplete="url" spellcheck="false" required>
          </div>
          <small>${translated('Use https://claw.local or https://localhost. The API path is added automatically.')}</small>
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
    <section class="agent-status" aria-label="${translated('Agent status')}">
      <button id="routeToggle" class="route-summary" type="button" aria-expanded="false">
        <span id="backendDot" class="status-shape" aria-hidden="true"></span>
        <span class="route-copy">
          <strong id="routeModel">AUTO</strong>
          <small id="backendLabel">${translated('Disconnected')}</small>
        </span>
        <span id="activeModeBadge" class="badge accent-badge">${translated('Auto')}</span>
        <span class="chevron" aria-hidden="true">⌄</span>
      </button>
      <dl id="routeRail" class="route-rail" hidden>
        <div><dt>${translated('Route')}</dt><dd id="routeMode">AUTO</dd></div>
        <div><dt>${translated('Context')}</dt><dd id="contextCount">0</dd></div>
        <div><dt>${translated('Tokens')}</dt><dd id="tokenCount">—</dd></div>
        <div><dt>${translated('Plan')}</dt><dd id="planName">—</dd></div>
      </dl>
      <div id="modelWarnings" class="warning-stack" role="status"></div>
      <section id="agentRunPanel" class="agent-run-panel" aria-label="${translated('Coding agent activity')}" hidden>
        <header class="agent-run-header">
          <span class="agent-run-mark" aria-hidden="true"></span>
          <strong id="agentRunLabel" aria-live="polite">${translated('Reading workspace')}</strong>
          <details id="agentRunDetails" class="agent-run-details">
            <summary id="agentRunFileCount" class="badge">${translated('0 files')}</summary>
            <div class="agent-run-detail-body">
              <ul id="agentRunFiles" class="agent-run-files"></ul>
              <ul id="agentRunCommands" class="agent-run-files agent-run-commands" hidden></ul>
            </div>
          </details>
        </header>
      </section>
      <section id="queuePanel" class="queue-panel" aria-label="${translated('Request queue')}" hidden>
        <header class="queue-header">
          <strong>${translated('Request queue')}</strong>
          <span id="queueCount" class="badge">${translated('0 queued')}</span>
        </header>
        <ol id="queueList" class="queue-list"></ol>
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
            <span class="suggestion-icon" aria-hidden="true">◎</span>
            <span><strong>${translated('Explain')}</strong><small>${translated('Map how this workspace works')}</small></span>
          </button>
          <button class="suggestion-card" type="button" data-prompt-kind="plan">
            <span class="suggestion-icon" aria-hidden="true">◇</span>
            <span><strong>${translated('Plan')}</strong><small>${translated('Design a safe implementation')}</small></span>
          </button>
          <button class="suggestion-card" type="button" data-prompt-kind="review">
            <span class="suggestion-icon" aria-hidden="true">△</span>
            <span><strong>${translated('Review')}</strong><small>${translated('Find correctness and security risks')}</small></span>
          </button>
          <button class="suggestion-card" type="button" data-prompt-kind="test">
            <span class="suggestion-icon" aria-hidden="true">□</span>
            <span><strong>${translated('Test')}</strong><small>${translated('Strengthen coverage and edge cases')}</small></span>
          </button>
        </div>
      </section>
      <section id="conversation" class="conversation execution-spine" aria-live="polite" aria-label="${translated('Conversation')}"></section>
    </section>

    <section id="modelTray" class="model-tray" aria-label="${translated('Compare models')}">
      <div class="section-heading">
        <div><p class="utility-label">${translated('PARALLEL RUN')}</p><strong>${translated('Compare model responses')}</strong></div>
        <span class="badge">${translated('Choose 2–5')}</span>
      </div>
      <div id="modelChecks" class="model-checks"></div>
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
        <div class="control-rail">
          <input id="attachmentInput" class="sr-only" type="file" multiple>
          <button id="attachmentButton" class="icon-button attachment-button" type="button" title="${translated('Attach files')}" aria-label="${translated('Attach files')}">
            <span aria-hidden="true">📎</span>
          </button>
          <label class="compact-control"><span>${translated('Model')}</span>
            <select id="modelSelect" aria-label="${translated('Model')}">
              <option value="AUTO">${translated('Automatic routing')}</option>
            </select>
          </label>
          <label class="compact-control"><span>${translated('Agent')}</span>
            <select id="agentMode">
              <option value="AUTO">${translated('Auto')}</option>
              <option value="PLAN">${translated('Plan mode')}</option>
            </select>
          </label>
          <label class="compact-control"><span>${translated('Approval')}</span>
            <select id="permissionMode">
              <option value="MANUAL">${translated('Ask for Approval')}</option>
              <option value="EDIT_AUTOMATICALLY">${translated('Approve for me')}</option>
              <option value="BYPASS_PERMISSIONS">${translated('Full Access')}</option>
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
          <label class="compact-control"><span>${translated('Run')}</span>
            <select id="runMode">
              <option value="agent">${translated('Agent')}</option>
              <option value="chat">${translated('Chat')}</option>
              <option value="compare">${translated('Compare')}</option>
              <option value="judge">${translated('Compare + Judge')}</option>
            </select>
          </label>
          <div class="actions">
            <button id="cancelButton" class="quiet-button" type="button" hidden>${translated('Cancel')}</button>
            <button id="sendButton" class="send-button" type="submit" aria-label="${translated('Send')}"><span>${translated('Send')}</span><b aria-hidden="true">↑</b></button>
          </div>
        </div>
      </div>
      <p class="composer-footnote">${translated('Ctrl/⌘ + Enter to send · approval follows the selected mode')}</p>
    </form>
    </div>
    <p id="announcer" class="sr-only" aria-live="assertive"></p>
  </main>
  <div id="toastStack" class="toast-stack" role="status" aria-live="polite"></div>
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
    data-attachment-limit-summary="${translated('{0}/10 attachments · {1}/10 MiB')}"
    data-attachment-read-failed="${translated('This file could not be attached.')}"
    data-attachment-too-large="${translated('Each attachment must be 5 MiB or smaller.')}"
    data-attachment-total-too-large="${translated('Attachments must total 10 MiB or less.')}"
    data-attachment-too-many="${translated('You can attach up to 10 files.')}"
    data-attachment-type-unsupported="${translated('This file type is not supported.')}"
    data-attachments="${translated('Attachments')}"
    data-assistant="${translated('CLAWAI')}"
    data-automatic-routing="${translated('Automatic routing')}"
    data-choose-models="${translated('Choose between 2 and 5 models.')}"
    data-connect="${translated('Connect')}"
    data-connect-clawai="${translated('Connect to ClawAI')}"
    data-connected="${translated('Connected')}"
    data-connecting="${translated('Connecting')}"
    data-opening-authorization="${translated('Opening authorization...')}"
    data-completed="${translated('Completed')}"
    data-context-empty="${translated('No workspace context attached')}"
    data-context-file="${translated('Using the active file')}"
    data-context-selection="${translated('Using the active selection')}"
    data-context-workspace="${translated('Using the trusted workspace')}"
    data-copy="${translated('Copy response')}"
    data-copied="${translated('Copied')}"
    data-error="${translated('Error')}"
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
    data-warning-llamacpp="${translated('Local llama.cpp models could not be loaded. Refresh to retry.')}"
    data-warning-ollama="${translated('Local Ollama models could not be loaded. Refresh to retry.')}"
    data-workspace-file-activity="${translated('Workspace file change')}"
    data-reject="${translated('Reject')}"
    data-remove="${translated('Remove')}"
    data-retry="${translated('Retry')}"
    data-running="${translated('Running')}"
    data-send="${translated('Send')}"
    data-skip-connection="${translated('Skip to connection')}"
    data-skip-composer="${translated('Skip to composer')}"
    data-trusted="${translated('Trusted')}"
    data-undo="${translated('Undo')}"
    data-untrusted="${translated('Restricted')}"
    data-you="${translated('YOU')}"></div>
  <script nonce="${escapeHtml(input.nonce)}" src="${escapeHtml(input.scriptUri)}"></script>
</body>
</html>`;
}
