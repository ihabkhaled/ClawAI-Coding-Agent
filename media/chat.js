/* global acquireVsCodeApi, document, window */

const vscode = acquireVsCodeApi();
const elements = {
  announcer: document.querySelector('#announcer'),
  backendDot: document.querySelector('#backendDot'),
  backendLabel: document.querySelector('#backendLabel'),
  cancelButton: document.querySelector('#cancelButton'),
  contextCount: document.querySelector('#contextCount'),
  contextMode: document.querySelector('#contextMode'),
  conversation: document.querySelector('#conversation'),
  form: document.querySelector('#composer'),
  modelChecks: document.querySelector('#modelChecks'),
  modelTray: document.querySelector('#modelTray'),
  planName: document.querySelector('#planName'),
  prompt: document.querySelector('#prompt'),
  routeModel: document.querySelector('#routeModel'),
  routeMode: document.querySelector('#routeMode'),
  routeRail: document.querySelector('#routeRail'),
  routeToggle: document.querySelector('#routeToggle'),
  runMode: document.querySelector('#runMode'),
  sendButton: document.querySelector('#sendButton'),
  sessionButton: document.querySelector('#sessionButton'),
  tokenCount: document.querySelector('#tokenCount'),
};

let currentState = {
  busy: false,
  connected: false,
  models: [],
  routingMode: 'AUTO',
  selectedModel: '',
};
let streamingMessage = null;

function textElement(tag, className, text) {
  const element = document.createElement(tag);
  element.className = className;
  element.textContent = text;
  return element;
}

function appendMessage(role, content, meta = '') {
  const article = document.createElement('article');
  article.className = `message message-${role}`;
  article.append(textElement('p', 'message-role', role === 'user' ? 'YOU' : 'CLAWAI'));
  const body = textElement('pre', 'message-body', content);
  article.append(body);
  if (meta.length > 0) {
    article.append(textElement('p', 'message-meta', meta));
  }
  elements.conversation.append(article);
  article.scrollIntoView({ block: 'end', behavior: 'smooth' });
  return body;
}

function renderModels(models) {
  const existing = new Set(
    [...elements.modelChecks.querySelectorAll('input:checked')].map((input) => input.value),
  );
  elements.modelChecks.replaceChildren();
  for (const model of models) {
    const label = document.createElement('label');
    label.className = 'model-option';
    const input = document.createElement('input');
    input.type = 'checkbox';
    input.value = model.key;
    input.checked = existing.has(model.key);
    const name = textElement('span', '', model.displayName);
    const provider = textElement(
      'small',
      '',
      `${model.provider}${model.isLocal ? ' · local' : ''}`,
    );
    label.append(input, name, provider);
    elements.modelChecks.append(label);
  }
}

function renderState(state) {
  currentState = state;
  elements.backendLabel.textContent = state.backendStatus;
  elements.backendDot.dataset.status = state.backendStatus;
  elements.routeMode.textContent = state.routingMode;
  const active = state.models.find((model) => model.key === state.selectedModel);
  elements.routeModel.textContent =
    state.routingMode === 'AUTO' ? 'AUTO' : (active?.displayName ?? state.selectedModel);
  elements.contextCount.textContent = String(state.contextReceipt?.included?.length ?? 0);
  const day = state.usage?.day;
  elements.tokenCount.textContent =
    day === undefined ? '—' : day.limit === null ? `${day.used}` : `${day.used}/${day.limit}`;
  elements.planName.textContent = state.entitlements?.plan?.name ?? '—';
  elements.sessionButton.textContent = state.connected ? 'Log out' : 'Connect';
  elements.sendButton.disabled = state.busy;
  elements.cancelButton.hidden = !state.busy;
  elements.prompt.disabled = state.busy;
  renderModels(state.models);
  if (state.lastError) {
    elements.announcer.textContent = state.lastError;
  }
}

function selectedModels() {
  return [...elements.modelChecks.querySelectorAll('input:checked')].map((input) => input.value);
}

elements.form.addEventListener('submit', (event) => {
  event.preventDefault();
  const content = elements.prompt.value.trim();
  if (content.length === 0) {
    return;
  }
  appendMessage('user', content);
  streamingMessage = appendMessage('assistant', '');
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
      elements.announcer.textContent = 'Choose between 2 and 5 models.';
      streamingMessage.textContent = 'Choose between 2 and 5 models.';
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
});

elements.sessionButton.addEventListener('click', () => {
  vscode.postMessage({ type: currentState.connected ? 'logout' : 'connect' });
});

elements.cancelButton.addEventListener('click', () => {
  vscode.postMessage({ type: 'cancel' });
});

elements.runMode.addEventListener('change', () => {
  elements.modelTray.classList.toggle('visible', elements.runMode.value !== 'chat');
});

elements.routeToggle.addEventListener('click', () => {
  const expanded = elements.routeToggle.getAttribute('aria-expanded') === 'true';
  elements.routeToggle.setAttribute('aria-expanded', String(!expanded));
  elements.routeRail.hidden = expanded;
});

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
    if (streamingMessage && typeof message.result.content === 'string') {
      streamingMessage.textContent = message.result.content;
    }
    streamingMessage = null;
  } else if (message?.type === 'error') {
    if (streamingMessage) {
      streamingMessage.textContent = message.message;
      streamingMessage = null;
    }
    elements.announcer.textContent = message.message;
  }
});

vscode.postMessage({ type: 'ready' });
