/* global acquireVsCodeApi, document, Event, navigator, window */

const vscode = acquireVsCodeApi();
const byId = (id) => document.querySelector(`#${id}`);
const elements = {
  activeModeBadge: byId('activeModeBadge'),
  agentMode: byId('agentMode'),
  announcer: byId('announcer'),
  backendDot: byId('backendDot'),
  backendLabel: byId('backendLabel'),
  cancelButton: byId('cancelButton'),
  contextCount: byId('contextCount'),
  contextHintText: byId('contextHintText'),
  contextMode: byId('contextMode'),
  conversation: byId('conversation'),
  emptyState: byId('emptyState'),
  form: byId('composer'),
  modelChecks: byId('modelChecks'),
  modelSelect: byId('modelSelect'),
  modelTray: byId('modelTray'),
  modelWarnings: byId('modelWarnings'),
  newChatButton: byId('newChatButton'),
  openFolderButton: byId('openFolderButton'),
  permissionMode: byId('permissionMode'),
  planName: byId('planName'),
  prompt: byId('prompt'),
  routeModel: byId('routeModel'),
  routeMode: byId('routeMode'),
  routeRail: byId('routeRail'),
  routeToggle: byId('routeToggle'),
  runMode: byId('runMode'),
  sendButton: byId('sendButton'),
  sessionButton: byId('sessionButton'),
  tokenCount: byId('tokenCount'),
  trustBadge: byId('trustBadge'),
  workspaceName: byId('workspaceName'),
};
const labels = byId('i18n').dataset;

let currentState = {
  agentMode: 'AUTO',
  backendStatus: 'disconnected',
  busy: false,
  connected: false,
  modelWarnings: [],
  models: [],
  permissionMode: 'MANUAL',
  routingMode: 'AUTO',
  selectedModel: '',
};
let lastUserPrompt = '';
let pendingAgentMode = null;
let pendingModel = null;
let pendingPermissionMode = null;
let streamingMessage = null;

function textElement(tag, className, text) {
  const element = document.createElement(tag);
  element.className = className;
  element.textContent = text;
  return element;
}

function setConversationVisibility() {
  const empty = elements.conversation.childElementCount === 0;
  elements.emptyState.hidden = !empty;
  elements.conversation.hidden = empty;
}

function copyButton(body) {
  const button = textElement('button', 'message-action', labels.copy);
  button.type = 'button';
  button.addEventListener('click', async () => {
    await navigator.clipboard.writeText(body.textContent ?? '');
    button.textContent = labels.copied;
    window.setTimeout(() => {
      button.textContent = labels.copy;
    }, 1200);
  });
  return button;
}

function retryButton() {
  const button = textElement('button', 'message-action', labels.retry);
  button.type = 'button';
  button.addEventListener('click', () => {
    elements.prompt.value = lastUserPrompt;
    elements.prompt.focus();
    elements.form.requestSubmit();
  });
  return button;
}

function appendMessage(role, content, meta = '') {
  const article = document.createElement('article');
  article.className = `message timeline-item message-${role}`;
  article.append(textElement('span', 'timeline-marker', ''));
  const card = document.createElement('div');
  card.className = 'message-card';
  const header = document.createElement('header');
  header.className = 'message-header';
  header.append(
    textElement('span', 'message-role', role === 'user' ? labels.you : labels.assistant),
  );
  if (meta.length > 0) {
    header.append(textElement('span', 'message-meta', meta));
  }
  const body = textElement('pre', 'message-body', content);
  card.append(header, body);
  if (role === 'assistant') {
    const actions = document.createElement('div');
    actions.className = 'message-actions';
    actions.append(copyButton(body), retryButton());
    card.append(actions);
  }
  article.append(card);
  elements.conversation.append(article);
  setConversationVisibility();
  article.scrollIntoView({ block: 'end', behavior: 'smooth' });
  return body;
}

function renderWarnings(warnings) {
  elements.modelWarnings.replaceChildren();
  for (const warning of warnings) {
    const item = textElement('div', 'warning-card', warning);
    item.prepend(textElement('span', 'warning-shape', '!'));
    elements.modelWarnings.append(item);
  }
}

function activeModelValue() {
  if (pendingModel !== null) {
    return pendingModel;
  }
  return currentState.routingMode === 'AUTO' ? 'AUTO' : currentState.selectedModel;
}

function renderModels(models) {
  const existing = new Set(
    [...elements.modelChecks.querySelectorAll('input:checked')].map((input) => input.value),
  );
  elements.modelChecks.replaceChildren();
  const groups = new Map();
  for (const model of models) {
    const groupName = model.isLocal ? labels.local : model.provider;
    const group = groups.get(groupName) ?? [];
    group.push(model);
    groups.set(groupName, group);
  }
  elements.modelSelect.replaceChildren();
  const auto = document.createElement('option');
  auto.value = 'AUTO';
  auto.textContent = labels.automaticRouting;
  elements.modelSelect.append(auto);
  for (const [groupName, groupModels] of groups) {
    const group = document.createElement('optgroup');
    group.label = groupName;
    for (const model of groupModels) {
      const option = document.createElement('option');
      option.value = model.key;
      option.textContent = model.displayName;
      group.append(option);
    }
    elements.modelSelect.append(group);
  }
  for (const model of models) {
    const label = document.createElement('label');
    label.className = 'model-option';
    const input = document.createElement('input');
    input.type = 'checkbox';
    input.value = model.key;
    input.checked = existing.has(model.key);
    const details = document.createElement('span');
    details.append(
      textElement('strong', '', model.displayName),
      textElement('small', '', `${model.provider}${model.isLocal ? ` · ${labels.local}` : ''}`),
    );
    label.append(input, details);
    elements.modelChecks.append(label);
  }
  elements.modelSelect.value = activeModelValue();
}

function resolvedContext(readiness) {
  if (elements.contextMode.value !== 'smart') {
    return elements.contextMode.value;
  }
  if (readiness?.hasSelection) {
    return 'selection';
  }
  if (readiness?.hasActiveFile) {
    return 'file';
  }
  if (readiness?.hasWorkspace && readiness.trusted) {
    return 'workspace';
  }
  return 'none';
}

function renderContextHint() {
  const mode = resolvedContext(currentState.workspaceReadiness);
  const hints = {
    file: labels.contextFile,
    none: labels.contextEmpty,
    selection: labels.contextSelection,
    workspace: labels.contextWorkspace,
  };
  elements.contextHintText.textContent = hints[mode] ?? labels.contextEmpty;
}

function renderWorkspace(readiness) {
  const hasWorkspace = readiness?.hasWorkspace === true;
  elements.workspaceName.textContent = readiness?.workspaceName ?? labels.noWorkspace;
  elements.trustBadge.textContent = hasWorkspace
    ? readiness.trusted
      ? labels.trusted
      : labels.untrusted
    : labels.noFolder;
  elements.trustBadge.dataset.status = hasWorkspace
    ? readiness.trusted
      ? 'trusted'
      : 'untrusted'
    : 'empty';
  elements.openFolderButton.hidden = hasWorkspace;
}

function backendStatusLabel(status) {
  const statusLabels = {
    connected: labels.connected,
    disconnected: labels.connect,
    error: labels.error,
    loading: labels.connecting,
  };
  return statusLabels[status] ?? status;
}

function reconcilePending(state) {
  if (pendingModel === 'AUTO' && state.routingMode === 'AUTO' && state.selectedModel.length === 0) {
    pendingModel = null;
  } else if (
    pendingModel !== null &&
    state.routingMode === 'MANUAL_MODEL' &&
    state.selectedModel === pendingModel
  ) {
    pendingModel = null;
  }
  if (pendingAgentMode === state.agentMode) {
    pendingAgentMode = null;
  }
  if (pendingPermissionMode === state.permissionMode) {
    pendingPermissionMode = null;
  }
}

function renderState(state) {
  currentState = state;
  reconcilePending(state);
  elements.backendLabel.textContent = backendStatusLabel(state.backendStatus);
  elements.backendDot.dataset.status = state.backendStatus;
  elements.routeMode.textContent = state.routingMode;
  const active = state.models.find((model) => model.key === state.selectedModel);
  elements.routeModel.textContent =
    state.routingMode === 'AUTO' ? 'AUTO' : (active?.displayName ?? state.selectedModel);
  elements.activeModeBadge.textContent =
    (pendingAgentMode ?? state.agentMode) === 'PLAN' ? labels.planMode : labels.auto;
  elements.contextCount.textContent = String(state.contextReceipt?.included?.length ?? 0);
  const day = state.usage?.day;
  elements.tokenCount.textContent =
    day === undefined ? '—' : day.limit === null ? `${day.used}` : `${day.used}/${day.limit}`;
  elements.planName.textContent = state.entitlements?.plan?.name ?? '—';
  elements.sessionButton.textContent = state.connected ? labels.logout : labels.connect;
  elements.sendButton.disabled = state.busy || !state.connected;
  elements.cancelButton.hidden = !state.busy;
  elements.prompt.disabled = state.busy;
  elements.modelSelect.disabled = state.busy || !state.connected;
  elements.agentMode.disabled = state.busy;
  elements.permissionMode.disabled = state.busy;
  elements.agentMode.value = pendingAgentMode ?? state.agentMode;
  elements.permissionMode.value = pendingPermissionMode ?? state.permissionMode;
  renderModels(state.models);
  renderWarnings(state.modelWarnings ?? []);
  renderWorkspace(state.workspaceReadiness);
  renderContextHint();
  if (state.lastError) {
    elements.announcer.textContent = state.lastError;
  }
}

function selectedModels() {
  return [...elements.modelChecks.querySelectorAll('input:checked')].map((input) => input.value);
}

function submitPrompt() {
  const content = elements.prompt.value.trim();
  if (content.length === 0) {
    return;
  }
  lastUserPrompt = content;
  appendMessage('user', content);
  streamingMessage = appendMessage('assistant', '', labels.connecting);
  const mode = elements.runMode.value;
  if (mode === 'chat') {
    vscode.postMessage({
      type: 'send',
      content,
      contextMode: elements.contextMode.value,
    });
  } else {
    const modelKeys = selectedModels();
    if (modelKeys.length < 2 || modelKeys.length > 5) {
      elements.announcer.textContent = labels.chooseModels;
      streamingMessage.textContent = labels.chooseModels;
      return;
    }
    vscode.postMessage({
      type: 'compare',
      content,
      contextMode: elements.contextMode.value,
      modelKeys,
      judgeEnabled: mode === 'judge',
    });
  }
  elements.prompt.value = '';
}

elements.form.addEventListener('submit', (event) => {
  event.preventDefault();
  submitPrompt();
});

elements.sessionButton.addEventListener('click', () => {
  vscode.postMessage({ type: currentState.connected ? 'logout' : 'connect' });
});

elements.openFolderButton.addEventListener('click', () => {
  vscode.postMessage({ type: 'openFolder' });
});

elements.newChatButton.addEventListener('click', () => {
  elements.conversation.replaceChildren();
  lastUserPrompt = '';
  streamingMessage = null;
  setConversationVisibility();
  elements.prompt.focus();
});

elements.cancelButton.addEventListener('click', () => {
  vscode.postMessage({ type: 'cancel' });
});

elements.runMode.addEventListener('change', () => {
  elements.modelTray.classList.toggle('visible', elements.runMode.value !== 'chat');
});

elements.modelSelect.addEventListener('change', () => {
  pendingModel = elements.modelSelect.value;
  vscode.postMessage({ type: 'selectModel', modelKey: pendingModel });
});

elements.agentMode.addEventListener('change', () => {
  pendingAgentMode = elements.agentMode.value;
  elements.activeModeBadge.textContent =
    pendingAgentMode === 'PLAN' ? labels.planMode : labels.auto;
  vscode.postMessage({ type: 'selectAgentMode', mode: pendingAgentMode });
});

elements.permissionMode.addEventListener('change', () => {
  pendingPermissionMode = elements.permissionMode.value;
  vscode.postMessage({ type: 'selectPermissionMode', mode: pendingPermissionMode });
});

elements.contextMode.addEventListener('change', renderContextHint);

elements.routeToggle.addEventListener('click', () => {
  const expanded = elements.routeToggle.getAttribute('aria-expanded') === 'true';
  elements.routeToggle.setAttribute('aria-expanded', String(!expanded));
  elements.routeRail.hidden = expanded;
});

for (const suggestion of document.querySelectorAll('[data-prompt-kind]')) {
  suggestion.addEventListener('click', () => {
    const kind = suggestion.dataset.promptKind;
    const key = `prompt${kind.charAt(0).toUpperCase()}${kind.slice(1)}`;
    elements.prompt.value = labels[key] ?? '';
    if (kind === 'plan') {
      elements.agentMode.value = 'PLAN';
      elements.agentMode.dispatchEvent(new Event('change'));
    }
    elements.prompt.focus();
  });
}

document.addEventListener('keydown', (event) => {
  if ((event.ctrlKey || event.metaKey) && event.key === 'Enter') {
    elements.form.requestSubmit();
  }
});

window.addEventListener('message', (event) => {
  const message = event.data;
  if (message?.type === 'state') {
    renderState(message.state);
  } else if (message?.type === 'streamEvent') {
    const stream = message.event;
    if (streamingMessage && stream.type === 'CONTENT_DELTA' && typeof stream.delta === 'string') {
      streamingMessage.textContent += stream.delta;
    }
    if (
      streamingMessage &&
      stream.type === 'RESPONSE_STREAMING' &&
      typeof stream.content === 'string'
    ) {
      streamingMessage.textContent = stream.content;
    }
  } else if (message?.type === 'result') {
    if (streamingMessage && typeof message.result?.content === 'string') {
      streamingMessage.textContent = message.result.content;
      const card = streamingMessage.closest('.message-card');
      const meta = card?.querySelector('.message-meta');
      if (meta) {
        meta.textContent = [message.result.provider, message.result.model]
          .filter(Boolean)
          .join(' · ');
      }
    }
    streamingMessage = null;
  } else if (message?.type === 'error') {
    if (streamingMessage) {
      streamingMessage.textContent = message.message;
      streamingMessage.closest('.timeline-item')?.classList.add('message-error');
      streamingMessage = null;
    }
    elements.announcer.textContent = message.message;
  }
});

setConversationVisibility();
vscode.postMessage({ type: 'ready' });
