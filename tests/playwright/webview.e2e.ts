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
    agentRun: undefined,
    agentMode: 'AUTO',
    approvalRequest: undefined,
    backendStatus: 'connected',
    backendUrl: 'https://claw.local',
    busy: false,
    connected: true,
    contextReceipt: undefined,
    entitlements: undefined,
    generationQueue: {
      active: undefined,
      pending: [],
    },
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
    workspaceScope: {
      folders: [{ key: 'workspace-key', name: 'ClawAI' }],
      selectedFolderKey: 'workspace-key',
      selectedFolderName: 'ClawAI',
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
  await expect(page.locator('#runMode')).toHaveValue('agent');
  await expect(page.locator('#emptyState')).toBeVisible();
  await expectWindowsScreenshot(page, 'workbench-dark.png');
});

test('submits coding prompts to the agent execution path by default', async ({ page }) => {
  await page.locator('#prompt').fill('write for loop from 1 to 10 in file .js inside folder app');
  await page.locator('#composer').evaluate((form: HTMLFormElement) => {
    form.requestSubmit();
  });

  await expect
    .poll(() => page.evaluate(() => window.__clawMock.messages.at(-1)))
    .toEqual({
      type: 'agent',
      content: 'write for loop from 1 to 10 in file .js inside folder app',
      contextMode: 'smart',
      requestId: expect.any(String),
    });
});

test('keeps controls interactive and queues follow-up requests while an agent runs', async ({
  page,
}) => {
  await sendState(page, {
    busy: true,
    generationQueue: {
      active: { id: 'request-active', kind: 'agent', prompt: 'Implement the feature' },
      pending: [{ id: 'request-pending', kind: 'chat', prompt: 'Explain the tests' }],
    },
  });

  await expect(page.locator('#prompt')).toBeEnabled();
  await expect(page.locator('#modelSelect')).toBeEnabled();
  await expect(page.locator('#agentMode')).toBeEnabled();
  await expect(page.locator('#permissionMode')).toBeEnabled();
  await expect(page.locator('#sendButton')).toContainText('Queue');
  await expect(page.locator('#queuePanel')).toContainText('Implement the feature');
  await expect(page.locator('#queuePanel')).toContainText('Explain the tests');

  await page.locator('#modelSelect').selectOption(localModel.key);
  await page.locator('#prompt').fill('Run the focused tests next');
  await page.locator('#composer').evaluate((form: HTMLFormElement) => {
    form.requestSubmit();
  });

  await expect
    .poll(() => page.evaluate(() => window.__clawMock.messages.at(-1)))
    .toEqual({
      type: 'agent',
      content: 'Run the focused tests next',
      contextMode: 'smart',
      requestId: expect.any(String),
    });
  await expect(page.locator('.message-assistant').last()).toContainText('Queued');
});

test('handles Full Access and file approvals inside the workbench', async ({ page }) => {
  await page.locator('#permissionMode').selectOption('BYPASS_PERMISSIONS');
  await expect
    .poll(() => page.evaluate(() => window.__clawMock.messages.at(-1)))
    .toEqual({ type: 'selectPermissionMode', mode: 'BYPASS_PERMISSIONS' });

  await sendState(page, {
    approvalRequest: {
      id: '8d4f6eb8-5382-4d50-b005-12320b088673',
      kind: 'enableFullAccess',
      title: 'Enable Full Access',
      message: 'Apply safe workspace edits without repeated approval.',
      details: ['Workspace Trust stays enforced'],
    },
  });

  await expect(page.locator('#approvalPanel')).toBeVisible();
  await expect(page.locator('#approvalTitle')).toHaveText('Enable Full Access');
  await expect(page.locator('#approvalDetails')).toContainText('Workspace Trust stays enforced');
  await page.locator('#approvalApprove').click();
  await expect
    .poll(() => page.evaluate(() => window.__clawMock.messages.at(-1)))
    .toEqual({
      type: 'resolveApproval',
      requestId: '8d4f6eb8-5382-4d50-b005-12320b088673',
      approved: true,
    });
});

test('shows the owned folder and live coding-agent execution state', async ({ page }) => {
  await sendState(page, {
    agentRun: {
      phase: 'reviewing',
      summary: 'Create the JavaScript loop',
      files: [{ operation: 'create', path: 'app/for-loop.js' }],
    },
    workspaceReadiness: {
      hasActiveFile: false,
      hasSelection: false,
      hasWorkspace: true,
      trusted: true,
      workspaceName: 'web',
    },
    workspaceScope: {
      folders: [
        { key: 'api-key', name: 'api' },
        { key: 'web-key', name: 'web' },
      ],
      selectedFolderKey: 'web-key',
      selectedFolderName: 'web',
    },
  });

  await expect(page.locator('#workspaceSelect')).toBeVisible();
  await expect(page.locator('#workspaceSelect')).toHaveValue('web-key');
  await expect(page.locator('#agentRunPanel')).toBeVisible();
  await expect(page.locator('#agentRunPanel')).toContainText('Reviewing file changes');
  await expect(page.locator('#agentRunPanel')).toContainText('app/for-loop.js');
  await expect(page.locator('[data-agent-step="reading"]')).toHaveAttribute(
    'data-status',
    'complete',
  );
  await expect(page.locator('[data-agent-step="reviewing"]')).toHaveAttribute(
    'data-status',
    'active',
  );
  await expectWindowsScreenshot(page, 'workbench-agent-run.png');

  await page.locator('#workspaceSelect').selectOption('api-key');
  await expect
    .poll(() => page.evaluate(() => window.__clawMock.messages.at(-1)))
    .toEqual({ type: 'selectWorkspaceFolder', folderKey: 'api-key' });
});

test('shows safe development commands while the coding agent executes them', async ({ page }) => {
  await sendState(page, {
    agentRun: {
      phase: 'executing',
      summary: 'Verify the generated loop',
      files: [{ operation: 'create', path: 'app/for-loop.js' }],
      commands: [
        {
          command: 'node app/for-loop.js',
          purpose: 'Run the generated program',
        },
      ],
    },
  });

  await expect(page.locator('#agentRunPanel')).toContainText('Running development commands');
  await expect(page.locator('#agentRunCommands')).toContainText('node app/for-loop.js');
  await expect(page.locator('#agentRunCommands')).toContainText('Run the generated program');
  await expect(page.locator('[data-agent-step="executing"]')).toHaveAttribute(
    'data-status',
    'active',
  );
});

test('renders a structured file-change receipt after an agent run', async ({ page }) => {
  await page.locator('#prompt').fill('Create a loop');
  await page.locator('#composer').evaluate((form: HTMLFormElement) => {
    form.requestSubmit();
  });
  const request = await page.evaluate(() => window.__clawMock.messages.at(-1));
  const requestId = (request as { requestId: string }).requestId;
  await page.evaluate((activeRequestId) => {
    window.__clawMock.send({
      type: 'result',
      requestId: activeRequestId,
      result: {
        content: 'Applied: Create the JavaScript loop',
        editPlan: {
          summary: 'Create the JavaScript loop',
          files: [{ path: 'app/for-loop.js', operation: 'create', content: 'for (;;) {}' }],
        },
      },
    });
  }, requestId);

  await expect(page.locator('.change-receipt')).toContainText('app/for-loop.js');
  await expect(page.locator('.change-operation')).toHaveText('Create');
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
  const helloRequest = await page.evaluate(() => window.__clawMock.messages.at(-1));
  const helloRequestId = (helloRequest as { requestId: string }).requestId;
  await page.evaluate((activeRequestId) => {
    window.__clawMock.send({
      type: 'streamEvent',
      requestId: activeRequestId,
      event: { type: 'CONTENT_DELTA', delta: 'Hello' },
    });
    window.__clawMock.send({
      type: 'result',
      requestId: activeRequestId,
      result: { content: 'Hello from ClawAI', model: 'qwen2.5-coder:7b', provider: 'OLLAMA' },
    });
  }, helloRequestId);
  await expect(page.locator('.message-assistant .message-body')).toHaveText('Hello from ClawAI');
  await expect(page.locator('.message-meta')).toHaveText('OLLAMA · qwen2.5-coder:7b');

  await page.locator('#prompt').fill('Fail safely');
  await page.locator('#composer').evaluate((form: HTMLFormElement) => {
    form.requestSubmit();
  });
  const failedRequest = await page.evaluate(() => window.__clawMock.messages.at(-1));
  const failedRequestId = (failedRequest as { requestId: string }).requestId;
  await page.evaluate((activeRequestId) => {
    window.__clawMock.send({
      type: 'error',
      requestId: activeRequestId,
      message: 'Backend unavailable',
    });
  }, failedRequestId);
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
