import { expect, test } from '@playwright/test';

import { expectWindowsScreenshot, localModel, sendState, type MockBridge } from './fixtures';

import type { Page } from '@playwright/test';

declare global {
  interface Window {
    __clawMock: MockBridge;
  }
}

const browserIssues = new WeakMap<Page, string[]>();

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
  await page.locator('#refreshModelsButton').click();
  await expect
    .poll(() => page.evaluate(() => window.__clawMock.messages.at(-1)))
    .toEqual({ type: 'refreshModels' });
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
      researchMode: 'NONE',
      modelKey: 'AUTO',
      requestId: expect.any(String),
    });
  await expect(page.locator('.message-user .message-model-chip')).toHaveText('Automatic routing');
  await expect(page.locator('.message-assistant .message-model-chip')).toHaveText(
    'Automatic routing',
  );
});

test('handles Autonomous Scoped and file approvals inside the workbench', async ({ page }) => {
  await page.locator('#moreSettingsSummary').click();
  await page.locator('#permissionMode').selectOption('AUTONOMOUS_SCOPED');
  await expect
    .poll(() => page.evaluate(() => window.__clawMock.messages.at(-1)))
    .toEqual({ type: 'selectPermissionMode', mode: 'AUTONOMOUS_SCOPED' });

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

  await sendState(page, {
    approvalRequest: {
      id: 'add71d2e-9f96-476b-aeb4-5d570ea670ce',
      kind: 'finalDiff',
      title: 'Apply file changes',
      message: 'Review the staged changes before applying.',
    },
  });
  await expect(page.locator('#approvalReview')).toBeVisible();
});

test('labels routine workspace consent as a persistent workspace decision', async ({ page }) => {
  await sendState(page, {
    approvalRequest: {
      id: '64cda3dd-71dd-4b37-a155-54d845ad78fc',
      kind: 'workspaceContext',
      title: 'Enable routine workspace access',
      message: 'Allow safe workspace reads without asking again.',
    },
  });

  await expect(page.locator('#approvalApprove')).toHaveText('Always allow in this workspace');
});

test('shows the owned folder and live coding-agent execution state', async ({ page }) => {
  const requestId = '00000000-0000-4000-8000-000000000011';
  await sendState(page, {
    agentRuns: {
      [requestId]: {
        phase: 'reviewing',
        summary: 'Create the JavaScript loop',
        files: [{ operation: 'create', path: 'app/for-loop.js' }],
      },
    },
    generationQueue: {
      active: [
        {
          concurrencyKey: 'chat-a',
          id: requestId,
          kind: 'agent',
          modelLabel: 'Qwen 2.5 Coder 7B',
          prompt: 'Create the JavaScript loop',
          startedAt: Date.now(),
        },
      ],
      capacity: 2,
      pending: [],
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
  await expect(page.locator('#runDeck')).toBeVisible();
  await expect(page.locator('.run-lane')).toContainText('Reviewing file changes');
  await expect(page.locator('.run-details')).not.toHaveAttribute('open', '');
  await expect(page.locator('.run-detail-list')).not.toBeVisible();
  await page.locator('.run-details summary').click();
  await expect(page.locator('.run-lane')).toContainText('app/for-loop.js');
  await expectWindowsScreenshot(page, 'workbench-agent-run.png');

  await page.locator('#workspaceSelect').selectOption('api-key');
  await expect
    .poll(() => page.evaluate(() => window.__clawMock.messages.at(-1)))
    .toEqual({ type: 'selectWorkspaceFolder', folderKey: 'api-key' });
});

test('shows safe development commands while the coding agent executes them', async ({ page }) => {
  const requestId = '00000000-0000-4000-8000-000000000012';
  await sendState(page, {
    agentRuns: {
      [requestId]: {
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
    },
    generationQueue: {
      active: [
        {
          concurrencyKey: 'chat-a',
          id: requestId,
          kind: 'agent',
          modelLabel: 'Qwen 2.5 Coder 7B',
          prompt: 'Verify the generated loop',
          startedAt: Date.now(),
        },
      ],
      capacity: 2,
      pending: [],
    },
  });

  await expect(page.locator('.run-lane')).toContainText('Running development commands');
  await expect(page.locator('.run-details summary')).toContainText('1 files · 1 commands');
  await page.locator('.run-details summary').click();
  await expect(page.locator('.run-detail-list')).toContainText('node app/for-loop.js');
  await expect(page.locator('.run-detail-list')).toContainText('Run the generated program');
});

test('coalesces transport progress and resets a malformed agent draft before repair', async ({
  page,
}) => {
  await page.locator('#prompt').fill('Create app/for-loop.js');
  await page.locator('#composer').evaluate((form: HTMLFormElement) => {
    form.requestSubmit();
  });
  const request = await page.evaluate(() => window.__clawMock.messages.at(-1));
  const requestId = (request as { requestId: string }).requestId;

  await page.evaluate((activeRequestId) => {
    window.__clawMock.send({
      type: 'streamEvent',
      requestId: activeRequestId,
      event: {
        type: 'RESPONSE_ACCEPTED',
        label: 'Request accepted',
        description: 'Preparing the run.',
      },
    });
    window.__clawMock.send({
      type: 'streamEvent',
      requestId: activeRequestId,
      event: {
        type: 'RESPONSE_ACCEPTED',
        label: 'Request accepted',
        description: 'Preparing the run.',
      },
    });
    window.__clawMock.send({
      type: 'streamEvent',
      requestId: activeRequestId,
      event: { type: 'CONTENT_DELTA', delta: '{"operation":"create | update | delete"}' },
    });
    window.__clawMock.send({
      type: 'streamEvent',
      requestId: activeRequestId,
      event: { type: 'AGENT_DRAFT_RESET' },
    });
    window.__clawMock.send({
      type: 'streamEvent',
      requestId: activeRequestId,
      event: { type: 'CONTENT_DELTA', delta: '{"operation":"create"}' },
    });
  }, requestId);

  const body = page.locator(`.message-assistant[data-request-id="${requestId}"] .message-body`);
  await expect(body).toHaveText('{"operation":"create"}');
  await expect(body).not.toContainText('create | update | delete');
  await expect(body).not.toContainText('Request acceptedRequest accepted');
});

test('keeps ordered streaming activity and reconciles visible token telemetry', async ({
  page,
}) => {
  await page.locator('#prompt').fill('Create app/for-loop.js');
  await page.locator('#composer').evaluate((form: HTMLFormElement) => {
    form.requestSubmit();
  });
  const request = await page.evaluate(() => window.__clawMock.messages.at(-1));
  const requestId = (request as { requestId: string }).requestId;

  await page.evaluate((activeRequestId) => {
    window.__clawMock.send({
      type: 'streamEvent',
      requestId: activeRequestId,
      event: {
        type: 'LIFECYCLE',
        label: 'Reading workspace',
        description: 'Inspecting project files',
      },
    });
    window.__clawMock.send({
      type: 'streamEvent',
      requestId: activeRequestId,
      event: {
        type: 'TOOL_COMPLETED',
        label: 'Workspace read complete',
        description: '12 files inspected',
      },
    });
    window.__clawMock.send({
      type: 'streamEvent',
      requestId: activeRequestId,
      event: {
        type: 'USAGE',
        usage: { promptTokens: 120, completionTokens: 30, totalTokens: 150 },
      },
    });
    window.__clawMock.send({
      type: 'result',
      requestId: activeRequestId,
      result: {
        content: 'Created the loop file.',
        tokens: { input: 120, output: 30, source: 'reported', total: 150 },
      },
    });
  }, requestId);

  const assistant = page.locator(`.message-assistant[data-request-id="${requestId}"]`);
  await expect(assistant.locator('.activity-item')).toHaveCount(3);
  await expect(assistant).toContainText('Reading workspace');
  await expect(assistant).toContainText('Workspace read complete');
  await expect(assistant).toContainText('150 tokens');
  await expect(page.locator('#tokenCount')).toContainText('150');
  await expect(page.locator('#tokenCount')).toContainText('reported');
});

test('switches backend conversation history inside the current chat tab', async ({ page }) => {
  await sendState(page, {
    history: [
      {
        id: 'thread-1',
        messageCount: 2,
        title: 'Create loop file',
        updatedAt: '2026-07-29T10:00:00.000Z',
      },
    ],
  });

  await page.locator('#historySelect').selectOption('thread-1');
  await expect
    .poll(() => page.evaluate(() => window.__clawMock.messages.at(-1)))
    .toEqual({ type: 'selectHistory', threadId: 'thread-1' });

  await page.evaluate(() => {
    window.__clawMock.send({
      type: 'session',
      session: {
        createdAt: 1,
        sessionId: 'session-1',
        subject: 'Create loop file',
        threadId: 'thread-1',
        updatedAt: 2,
      },
    });
    window.__clawMock.send({
      type: 'historyLoaded',
      messages: [
        {
          id: 'message-1',
          role: 'USER',
          content: 'Create the loop file',
          inputTokens: 8,
          modelDisplayName: 'Qwen 2.5 Coder 7B',
          outputTokens: 0,
        },
        {
          id: 'message-2',
          role: 'ASSISTANT',
          content: 'Created app/for-loop.js',
          inputTokens: 8,
          model: 'qwen2.5-coder:7b',
          outputTokens: 12,
          provider: 'OLLAMA',
        },
      ],
    });
  });

  await expect(page.locator('#conversationTitle')).toHaveText('Create loop file');
  await expect(page.locator('.message-user')).toContainText('Create the loop file');
  await expect(page.locator('.message-assistant')).toContainText('Created app/for-loop.js');
  await expect(page.locator('.message-user .message-model-chip')).toHaveText('Qwen 2.5 Coder 7B');
  await expect(page.locator('.message-assistant .message-model-chip')).toHaveText(
    'OLLAMA · qwen2.5-coder:7b',
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
        previewId: '3f6e4b63-3259-4bfe-9306-7916d2a8fd68',
        editPlan: {
          summary: 'Create the JavaScript loop',
          files: [{ path: 'app/for-loop.js', operation: 'create', content: 'for (;;) {}' }],
        },
      },
    });
  }, requestId);

  await expect(page.locator('.change-receipt')).toContainText('app/for-loop.js');
  await expect(page.locator('.change-operation')).toHaveText('Create');
  await expect(page.locator('.change-token')).toContainText('estimated');
  await page.locator('.receipt-review').click();
  await expect
    .poll(() => page.evaluate(() => window.__clawMock.messages.at(-1)))
    .toEqual({
      type: 'reviewChanges',
      previewId: '3f6e4b63-3259-4bfe-9306-7916d2a8fd68',
    });
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

  await page.locator('#moreSettingsSummary').click();
  await page.locator('#agentMode').selectOption('PLAN');
  await page.locator('#permissionMode').selectOption('AUTO_EDIT');
  await expect(page.locator('#activeModeBadge')).toHaveText('Plan mode');
  await expect(page.locator('#permissionMode')).toHaveValue('AUTO_EDIT');
});

test('offers all six effort modes and keeps a selection through a state round trip', async ({
  page,
}) => {
  await page.locator('#moreSettingsSummary').click();
  await expect(page.locator('#effortMode option')).toHaveCount(6);
  await expect(page.locator('#effortMode')).toHaveValue('ULTRA');

  await page.locator('#effortMode').selectOption('LOW');
  await expect
    .poll(() => page.evaluate(() => window.__clawMock.messages.at(-1)))
    .toEqual({ type: 'selectEffortMode', mode: 'LOW' });

  // The pending selection has to survive a state frame that still reports the
  // old mode, or the control snaps back under the user mid-change.
  await sendState(page, { effortMode: 'ULTRA' });
  await expect(page.locator('#effortMode')).toHaveValue('LOW');

  await sendState(page, { effortMode: 'LOW' });
  await expect(page.locator('#effortMode')).toHaveValue('LOW');

  await page.locator('#effortMode').selectOption('XHIGH');
  await expect
    .poll(() => page.evaluate(() => window.__clawMock.messages.at(-1)))
    .toEqual({ type: 'selectEffortMode', mode: 'XHIGH' });
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
  await expect(page.locator('.message-assistant .message-meta')).toContainText(
    /OLLAMA · qwen2\.5-coder:7b · \d+ tokens · estimated/u,
  );
  await expect(page.locator('.message-assistant .message-model-chip').first()).toHaveText(
    'OLLAMA · qwen2.5-coder:7b',
  );

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
  await expect(page.locator('.message-error .message-model-chip')).toHaveText('Automatic routing');
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
