export interface ChatMarkupInput {
  cspSource: string;
  language: string;
  nonce: string;
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
    `img-src ${input.cspSource} data:`,
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
  <a class="skip-link" href="#prompt">${translated('Skip to composer')}</a>
  <main class="shell">
    <header id="workspaceBar" class="workspace-bar">
      <div class="brand-mark" aria-hidden="true"><span></span><span></span><span></span></div>
      <div class="workspace-identity">
        <p class="utility-label">${translated('ClawAI Coding Agent')}</p>
        <div class="workspace-line">
          <strong id="workspaceName">${translated('No workspace')}</strong>
          <span id="trustBadge" class="badge">${translated('No folder')}</span>
        </div>
      </div>
      <div class="workspace-actions">
        <button id="openFolderButton" class="quiet-button" type="button" hidden>${translated('Open folder')}</button>
        <button id="newChatButton" class="icon-button" type="button" title="${translated('New conversation')}" aria-label="${translated('New conversation')}">＋</button>
        <button id="sessionButton" class="quiet-button" type="button">${translated('Connect')}</button>
      </div>
    </header>

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
    </section>

    <section class="workbench" aria-label="${translated('Conversation workbench')}">
      <section id="emptyState" class="empty-state">
        <div class="empty-glyph" aria-hidden="true"><span></span><span></span><span></span></div>
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
        <div class="control-rail">
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
      <p class="composer-footnote">${translated('Ctrl/⌘ + Enter to send · final edits always require review')}</p>
    </form>
    <p id="announcer" class="sr-only" aria-live="assertive"></p>
  </main>
  <div id="i18n" hidden
    data-auto="${translated('Auto')}"
    data-agent="${translated('Agent')}"
    data-assistant="${translated('CLAWAI')}"
    data-automatic-routing="${translated('Automatic routing')}"
    data-choose-models="${translated('Choose between 2 and 5 models.')}"
    data-connect="${translated('Connect')}"
    data-connected="${translated('Connected')}"
    data-connecting="${translated('Connecting')}"
    data-context-empty="${translated('No workspace context attached')}"
    data-context-file="${translated('Using the active file')}"
    data-context-selection="${translated('Using the active selection')}"
    data-context-workspace="${translated('Using the trusted workspace')}"
    data-copy="${translated('Copy response')}"
    data-copied="${translated('Copied')}"
    data-error="${translated('Error')}"
    data-local="${translated('local')}"
    data-logout="${translated('Log out')}"
    data-no-folder="${translated('No folder')}"
    data-no-workspace="${translated('No workspace')}"
    data-prompt-explain="${translated('Explain the architecture of this workspace and identify the best starting points.')}"
    data-prompt-plan="${translated('Create a step-by-step implementation plan for my next change. Do not edit files.')}"
    data-prompt-review="${translated('Review this workspace for correctness, security, and maintainability risks.')}"
    data-prompt-test="${translated('Find the most important missing tests and propose meaningful edge cases.')}"
    data-plan-mode="${translated('Plan mode')}"
    data-ready="${translated('Ready')}"
    data-retry="${translated('Retry')}"
    data-trusted="${translated('Trusted')}"
    data-untrusted="${translated('Restricted')}"
    data-you="${translated('YOU')}"></div>
  <script nonce="${escapeHtml(input.nonce)}" src="${escapeHtml(input.scriptUri)}"></script>
</body>
</html>`;
}
