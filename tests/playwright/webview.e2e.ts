import { platform } from 'node:process';

import { expect, test } from '@playwright/test';

import type { Page } from '@playwright/test';

interface MockBridge {
  messages: unknown[];
  send(message: unknown): void;
}

declare global {
  interface Window {
    __clawMock: MockBridge;
  }
}

const localModel = {
  contextTokens: 8192,
  displayName: 'Qwen 2.5 Coder 7B',
  id: 'ollama-qwen',
  isLocal: true,
  key: 'OLLAMA:qwen2.5-coder:7b',
  model: 'qwen2.5-coder:7b',
  provider: 'OLLAMA',
  source: 'ollama',
  supportsStreaming: true,
  supportsStructuredOutput: true,
  supportsTools: true,
  supportsVision: false,
};
const browserIssues = new WeakMap<Page, string[]>();

function baseState() {
  return {
    agentMode: 'AUTO',
    backendStatus: 'connected',
    backendUrl: 'https://claw.local',
    busy: false,
    connected: true,
    contextReceipt: undefined,
    entitlements: undefined,
    lastError: undefined,
    models: [localModel],
    modelWarnings: [],
    permissionMode: 'MANUAL',
    routingMode: 'AUTO',
    selectedModel: '',
    usage: undefined,
    user: { email: 'developer@claw.local', id: 'user-1' },
    workspaceReadiness: {
      hasActiveFile: false,
      hasSelection: false,
      hasWorkspace: true,
      trusted: true,
      workspaceName: 'ClawAI',
    },
  };
}

async function sendState(page: Page, patch: Record<string, unknown> = {}): Promise<void> {
  await page.evaluate(
    (state) => {
      window.__clawMock.send({ type: 'state', state });
    },
    Object.assign(baseState(), patch),
  );
}

async function expectWindowsScreenshot(page: Page, name: string): Promise<void> {
  if (platform === 'win32') {
    await expect(page).toHaveScreenshot(name);
  }
}

test.beforeEach(async ({ page }) => {
  const issues: string[] = [];
  browserIssues.set(page, issues);
  page.on('pageerror', (error) => {
    issues.push(error.message);
  });
  page.on('console', (message) => {
    if (message.type() === 'error') {
      issues.push(message.text());
    }
  });
  await page.goto('/');
  await sendState(page);
});

test.afterEach(async ({ page }) => {
  expect(browserIssues.get(page)).toEqual([]);
});

test('renders the workspace-ready editor workbench without an active file', async ({ page }) => {
  await expect(page.locator('#workspaceName')).toHaveText('ClawAI');
  await expect(page.locator('#contextHintText')).toHaveText('Using the trusted workspace');
  await expect(page.locator('#modelSelect')).toContainText('Qwen 2.5 Coder 7B');
  await expect(page.locator('#emptyState')).toBeVisible();
  await expectWindowsScreenshot(page, 'workbench-dark.png');
});

test('keeps manual model and mode selections stable through state round trips', async ({
  page,
}) => {
  await page.locator('#modelSelect').selectOption(localModel.key);
  await expect
    .poll(() => page.evaluate(() => window.__clawMock.messages.at(-1)))
    .toEqual({ type: 'selectModel', modelKey: localModel.key });

  await sendState(page, { routingMode: 'AUTO', selectedModel: localModel.key });
  await expect(page.locator('#modelSelect')).toHaveValue(localModel.key);
  await sendState(page, { routingMode: 'MANUAL_MODEL', selectedModel: localModel.key });
  await expect(page.locator('#modelSelect')).toHaveValue(localModel.key);

  await page.locator('#agentMode').selectOption('PLAN');
  await page.locator('#permissionMode').selectOption('EDIT_AUTOMATICALLY');
  await expect(page.locator('#activeModeBadge')).toHaveText('Plan mode');
  await expect(page.locator('#permissionMode')).toHaveValue('EDIT_AUTOMATICALLY');
});

test('supports narrow responsive use, suggestions, streaming, success, and errors', async ({
  page,
}) => {
  await page.setViewportSize({ width: 320, height: 780 });
  await page.locator('[data-prompt-kind="plan"]').click();
  await expect(page.locator('#prompt')).not.toHaveValue('');
  await expect(page.locator('#agentMode')).toHaveValue('PLAN');

  await page.locator('#prompt').fill('Say hi');
  await page.locator('#prompt').press('Control+Enter');
  await page.evaluate(() => {
    window.__clawMock.send({
      type: 'streamEvent',
      event: { type: 'CONTENT_DELTA', delta: 'Hello' },
    });
    window.__clawMock.send({
      type: 'result',
      result: { content: 'Hello from ClawAI', model: 'qwen2.5-coder:7b', provider: 'OLLAMA' },
    });
  });
  await expect(page.locator('.message-assistant .message-body')).toHaveText('Hello from ClawAI');
  await expect(page.locator('.message-meta')).toHaveText('OLLAMA · qwen2.5-coder:7b');

  await page.locator('#prompt').fill('Fail safely');
  await page.locator('#composer').evaluate((form: HTMLFormElement) => {
    form.requestSubmit();
  });
  await page.evaluate(() => {
    window.__clawMock.send({ type: 'error', message: 'Backend unavailable' });
  });
  await expect(page.locator('.message-error')).toContainText('Backend unavailable');
  await expectWindowsScreenshot(page, 'workbench-narrow.png');
});

test('adapts to light and high-contrast theme tokens', async ({ page }) => {
  await page.evaluate(() => {
    document.body.dataset.theme = 'light';
  });
  await expect(page.locator('#emptyState')).toBeVisible();
  await expectWindowsScreenshot(page, 'workbench-light.png');

  await page.evaluate(() => {
    document.body.dataset.theme = 'hc';
  });
  await expect(page.locator('.composer-card')).toHaveCSS('border-color', 'rgb(255, 255, 255)');
});
