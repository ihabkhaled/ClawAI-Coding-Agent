/* global acquireVsCodeApi, document, Event, navigator, window */

const vscode = acquireVsCodeApi();
const byId = (id) => document.querySelector(`#${id}`);
const elements = {
  activeModeBadge: byId('activeModeBadge'),
  agentMode: byId('agentMode'),
  agentRunCommands: byId('agentRunCommands'),
  agentRunFileCount: byId('agentRunFileCount'),
  agentRunFiles: byId('agentRunFiles'),
  agentRunLabel: byId('agentRunLabel'),
  agentRunPanel: byId('agentRunPanel'),
  agentRunSteps: byId('agentRunSteps'),
  announcer: byId('announcer'),
  approvalApprove: byId('approvalApprove'),
  approvalDetails: byId('approvalDetails'),
  approvalKind: byId('approvalKind'),
  approvalMessage: byId('approvalMessage'),
  approvalPanel: byId('approvalPanel'),
  approvalReject: byId('approvalReject'),
  approvalTitle: byId('approvalTitle'),
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
  queueCount: byId('queueCount'),
  queueList: byId('queueList'),
  queuePanel: byId('queuePanel'),
  routeModel: byId('routeModel'),
  routeMode: byId('routeMode'),
  routeRail: byId('routeRail'),
  routeToggle: byId('routeToggle'),
  runMode: byId('runMode'),
  sendButton: byId('sendButton'),
  sessionButton: byId('sessionButton'),
  tokenCount: byId('tokenCount'),
  toastStack: byId('toastStack'),
  trustBadge: byId('trustBadge'),
  workspaceName: byId('workspaceName'),
  workspaceSelect: byId('workspaceSelect'),
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
const responseBodies = new Map();

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

function appendMessage(role, content, meta = '', requestId = '') {
  const article = document.createElement('article');
  article.className = `message timeline-item message-${role}`;
  if (requestId.length > 0) {
    article.dataset.requestId = requestId;
  }
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

function operationLabel(operation) {
  const labelsByOperation = {
    create: labels.operationCreate,
    delete: labels.operationDelete,
    update: labels.operationUpdate,
  };
  return labelsByOperation[operation] ?? operation;
}

function appendChangeReceipt(body, plan, undoAvailable = false) {
  const receipt = document.createElement('section');
  receipt.className = 'change-receipt';
  const header = document.createElement('header');
  header.append(
    textElement('strong', '', labels.fileChanges),
    textElement('span', 'badge', `${plan.files.length} ${labels.files}`),
  );
  const files = document.createElement('ul');
  for (const file of plan.files) {
    const item = document.createElement('li');
    item.className = 'change-file';
    item.append(
      textElement('span', 'change-operation', operationLabel(file.operation)),
      textElement('code', '', file.path),
    );
    files.append(item);
  }
  receipt.append(header, files);
  if (undoAvailable) {
    const undo = textElement('button', 'quiet-button receipt-undo', labels.undo);
    undo.type = 'button';
    undo.addEventListener('click', () => {
      vscode.postMessage({ type: 'undo' });
      undo.disabled = true;
    });
    receipt.append(undo);
  }
  body.after(receipt);
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

function renderWorkspace(readiness, scope) {
  const hasWorkspace = readiness?.hasWorkspace === true;
  const folders = scope?.folders ?? [];
  elements.workspaceSelect.replaceChildren();
  for (const folder of folders) {
    const option = document.createElement('option');
    option.value = folder.key;
    option.textContent = folder.name;
    elements.workspaceSelect.append(option);
  }
  if (scope?.selectedFolderKey) {
    elements.workspaceSelect.value = scope.selectedFolderKey;
  }
  const hasFolderChoice = folders.length > 1;
  elements.workspaceSelect.hidden = !hasFolderChoice;
  elements.workspaceName.hidden = hasFolderChoice;
  elements.workspaceName.textContent =
    scope?.selectedFolderName ?? readiness?.workspaceName ?? labels.noWorkspace;
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

function agentPhaseIndex(run) {
  const indexes = {
    applied: 3,
    executing: 4,
    generating: 1,
    planned: 1,
    reading: 0,
    rejected: run.files.length > 0 ? 2 : 1,
    reviewing: 2,
    verified: 4,
  };
  return indexes[run.phase] ?? (run.files.length > 0 ? 2 : 1);
}

function agentStepStatus(run, index, activeIndex) {
  if (run.phase === 'applied' || run.phase === 'planned' || run.phase === 'verified') {
    return index <= activeIndex ? 'complete' : 'pending';
  }
  if (run.phase === 'failed' || run.phase === 'rejected') {
    return index < activeIndex ? 'complete' : index === activeIndex ? 'error' : 'pending';
  }
  return index < activeIndex ? 'complete' : index === activeIndex ? 'active' : 'pending';
}

function renderAgentRun(run) {
  elements.agentRunPanel.hidden = run === undefined;
  if (run === undefined) {
    return;
  }
  const phaseLabels = {
    applied: labels.agentApplied,
    executing: labels.agentExecuting,
    failed: labels.agentFailed,
    generating: labels.agentGenerating,
    planned: labels.agentPlanned,
    reading: labels.agentReading,
    rejected: labels.agentRejected,
    reviewing: labels.agentReviewing,
    verified: labels.agentVerified,
  };
  const commands = run.commands ?? [];
  const steps = [
    ['reading', labels.agentReading],
    ['generating', labels.agentGenerating],
    ['reviewing', labels.agentReviewing],
    ['applied', labels.agentApplied],
    ...(commands.length === 0 ? [] : [['executing', labels.agentExecuting]]),
  ];
  const activeIndex = agentPhaseIndex(run);
  elements.agentRunPanel.dataset.phase = run.phase;
  elements.agentRunLabel.textContent = phaseLabels[run.phase] ?? run.phase;
  elements.agentRunFileCount.textContent =
    commands.length === 0
      ? `${run.files.length} ${labels.files}`
      : `${run.files.length} ${labels.files} · ${commands.length} ${labels.commands}`;
  elements.agentRunSteps.replaceChildren();
  for (const [index, step] of steps.entries()) {
    const item = textElement('span', 'agent-run-step', step[1]);
    item.dataset.agentStep = step[0];
    item.dataset.status = agentStepStatus(run, index, activeIndex);
    elements.agentRunSteps.append(item);
  }
  elements.agentRunFiles.replaceChildren();
  for (const file of run.files) {
    const item = document.createElement('li');
    item.append(
      textElement('span', 'change-operation', operationLabel(file.operation)),
      textElement('code', '', file.path),
    );
    elements.agentRunFiles.append(item);
  }
  elements.agentRunCommands.replaceChildren();
  elements.agentRunCommands.hidden = commands.length === 0;
  for (const command of commands) {
    const item = document.createElement('li');
    item.append(
      textElement('span', 'change-operation command-operation', '›'),
      textElement('code', '', command.command),
      textElement('small', '', command.purpose),
    );
    elements.agentRunCommands.append(item);
  }
}

function renderQueue(queue) {
  const active = queue?.active;
  const pending = queue?.pending ?? [];
  elements.queuePanel.hidden = active === undefined && pending.length === 0;
  elements.queueCount.textContent = `${pending.length} ${labels.queued.toLowerCase()}`;
  elements.queueList.replaceChildren();
  const requests = [
    ...(active === undefined ? [] : [{ ...active, status: labels.running }]),
    ...pending.map((request) => ({ ...request, status: labels.queued })),
  ];
  for (const request of requests) {
    const item = document.createElement('li');
    item.className = 'queue-item';
    item.dataset.status = request.id === active?.id ? 'active' : 'queued';
    const copy = document.createElement('span');
    copy.append(
      textElement('strong', '', request.status),
      textElement('small', '', request.prompt),
    );
    item.append(copy);
    if (request.id !== active?.id) {
      const remove = textElement('button', 'message-action', labels.remove);
      remove.type = 'button';
      remove.addEventListener('click', () => {
        vscode.postMessage({ type: 'removeQueued', requestId: request.id });
        responseBodies.get(request.id)?.closest('.timeline-item')?.remove();
        responseBodies.delete(request.id);
      });
      item.append(remove);
    }
    elements.queueList.append(item);
  }
}

function renderApproval(request) {
  elements.approvalPanel.hidden = request === undefined;
  if (request === undefined) {
    elements.approvalPanel.dataset.requestId = '';
    return;
  }
  elements.approvalPanel.dataset.requestId = request.id;
  elements.approvalKind.textContent = request.kind.replaceAll(/([A-Z])/gu, ' $1').trim();
  elements.approvalTitle.textContent = request.title;
  elements.approvalMessage.textContent = request.message;
  elements.approvalDetails.replaceChildren();
  for (const detail of request.details ?? []) {
    elements.approvalDetails.append(textElement('li', '', detail));
  }
  elements.approvalApprove.focus();
}

function showNotice(message) {
  const toast = textElement('div', 'toast', message);
  elements.toastStack.append(toast);
  window.setTimeout(() => toast.remove(), 4000);
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
  elements.sendButton.disabled = !state.connected;
  elements.sendButton.querySelector('span').textContent = state.busy ? labels.queue : labels.send;
  elements.cancelButton.hidden = state.generationQueue?.active === undefined;
  elements.prompt.disabled = false;
  elements.modelSelect.disabled = !state.connected;
  elements.agentMode.disabled = false;
  elements.permissionMode.disabled = false;
  elements.workspaceSelect.disabled = state.busy;
  elements.agentMode.value = pendingAgentMode ?? state.agentMode;
  elements.permissionMode.value = pendingPermissionMode ?? state.permissionMode;
  renderModels(state.models);
  renderWarnings(state.modelWarnings ?? []);
  renderWorkspace(state.workspaceReadiness, state.workspaceScope);
  renderAgentRun(state.agentRun);
  renderQueue(state.generationQueue);
  renderApproval(state.approvalRequest);
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
  const requestId = window.crypto.randomUUID();
  lastUserPrompt = content;
  appendMessage('user', content, '', requestId);
  const responseBody = appendMessage(
    'assistant',
    currentState.busy ? labels.queued : labels.connecting,
    currentState.busy ? labels.queued : labels.running,
    requestId,
  );
  responseBodies.set(requestId, responseBody);
  const mode = elements.runMode.value;
  if (mode === 'agent' || mode === 'chat') {
    vscode.postMessage({
      type: mode === 'agent' ? 'agent' : 'send',
      content,
      contextMode: elements.contextMode.value,
      requestId,
    });
  } else {
    const modelKeys = selectedModels();
    if (modelKeys.length < 2 || modelKeys.length > 5) {
      elements.announcer.textContent = labels.chooseModels;
      responseBody.textContent = labels.chooseModels;
      responseBody.closest('.timeline-item')?.classList.add('message-error');
      responseBodies.delete(requestId);
      return;
    }
    vscode.postMessage({
      type: 'compare',
      content,
      contextMode: elements.contextMode.value,
      modelKeys,
      judgeEnabled: mode === 'judge',
      requestId,
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

elements.workspaceSelect.addEventListener('change', () => {
  vscode.postMessage({
    type: 'selectWorkspaceFolder',
    folderKey: elements.workspaceSelect.value,
  });
});

elements.newChatButton.addEventListener('click', () => {
  elements.conversation.replaceChildren();
  lastUserPrompt = '';
  responseBodies.clear();
  setConversationVisibility();
  elements.prompt.focus();
});

elements.cancelButton.addEventListener('click', () => {
  vscode.postMessage({ type: 'cancel' });
});

function resolveApproval(approved) {
  const requestId = elements.approvalPanel.dataset.requestId;
  if (!requestId) {
    return;
  }
  if (!approved) {
    pendingPermissionMode = null;
  }
  vscode.postMessage({ type: 'resolveApproval', requestId, approved });
}

elements.approvalApprove.addEventListener('click', () => resolveApproval(true));
elements.approvalReject.addEventListener('click', () => resolveApproval(false));

elements.runMode.addEventListener('change', () => {
  elements.modelTray.classList.toggle(
    'visible',
    elements.runMode.value === 'compare' || elements.runMode.value === 'judge',
  );
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
    const responseBody = responseBodies.get(message.requestId);
    if (responseBody && stream.type === 'CONTENT_DELTA' && typeof stream.delta === 'string') {
      if (
        responseBody.textContent === labels.connecting ||
        responseBody.textContent === labels.queued
      ) {
        responseBody.textContent = '';
      }
      responseBody.textContent += stream.delta;
    }
    if (
      responseBody &&
      stream.type === 'RESPONSE_STREAMING' &&
      typeof stream.content === 'string'
    ) {
      responseBody.textContent = stream.content;
    } else if (
      responseBody &&
      typeof stream.label === 'string' &&
      responseBody.textContent !== '' &&
      (responseBody.textContent === labels.connecting || responseBody.textContent === labels.queued)
    ) {
      responseBody.textContent =
        typeof stream.description === 'string' && stream.description.length > 0
          ? `${stream.label}\n${stream.description}`
          : stream.label;
    }
  } else if (message?.type === 'result') {
    const responseBody = responseBodies.get(message.requestId);
    if (responseBody && typeof message.result?.content === 'string') {
      responseBody.textContent = message.result.content;
      if (message.result.editPlan?.files) {
        appendChangeReceipt(responseBody, message.result.editPlan, message.result.undoAvailable);
      }
      const card = responseBody.closest('.message-card');
      const meta = card?.querySelector('.message-meta');
      if (meta) {
        meta.textContent =
          [message.result.provider, message.result.model].filter(Boolean).join(' · ') ||
          labels.completed;
      }
    }
    responseBodies.delete(message.requestId);
  } else if (message?.type === 'error') {
    const responseBody = responseBodies.get(message.requestId);
    if (responseBody) {
      responseBody.textContent = message.message;
      const timeline = responseBody.closest('.timeline-item');
      timeline?.classList.add('message-error');
      const meta = timeline?.querySelector('.message-meta');
      if (meta) {
        meta.textContent = labels.error;
      }
      responseBodies.delete(message.requestId);
    }
    elements.announcer.textContent = message.message;
  } else if (message?.type === 'notice' && typeof message.message === 'string') {
    showNotice(message.message);
  }
});

setConversationVisibility();
vscode.postMessage({ type: 'ready' });
