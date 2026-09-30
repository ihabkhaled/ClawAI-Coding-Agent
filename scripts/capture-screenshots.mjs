// Captures the Marketplace screenshots in docs/images/ from the real webview
// (media/chat.js + media/chat.css) served by scripts/serve-webview-fixture.mjs.
// All data below is invented sample data; nothing here comes from a real account.
import { Buffer } from 'node:buffer';
import { spawn } from 'node:child_process';
import { mkdirSync } from 'node:fs';
import { join } from 'node:path';
import process, { cwd, execPath, stdout } from 'node:process';
import { setTimeout as delay } from 'node:timers/promises';

import { chromium } from '@playwright/test';

const root = cwd();
const outDir = join(root, 'docs', 'images');
const port = Number(process.env.CLAW_FIXTURE_PORT ?? 4178);
const origin = `http://127.0.0.1:${port}`;
const width = 1100;

const cloudModel = {
  contextTokens: 200000,
  displayName: 'Nova Pro',
  id: 'nova-pro',
  isLocal: false,
  key: 'NOVA:nova-pro',
  model: 'nova-pro',
  provider: 'NOVA',
  source: 'connector',
  supportsStreaming: true,
  supportsStructuredOutput: true,
  supportsTools: true,
  supportsVision: true,
};
const localModel = {
  ...cloudModel,
  contextTokens: 32768,
  displayName: 'Coder Local 7B',
  id: 'coder-local',
  isLocal: true,
  key: 'OLLAMA:coder-local:7b',
  model: 'coder-local:7b',
  provider: 'OLLAMA',
  source: 'ollama',
  supportsVision: false,
};
const fastModel = {
  ...cloudModel,
  contextTokens: 128000,
  displayName: 'Spark Fast',
  id: 'spark-fast',
  key: 'SPARK:spark-fast',
  model: 'spark-fast',
  provider: 'SPARK',
};

const state = (patch = {}) => ({
  agentMode: 'AUTO',
  agentRun: undefined,
  agentRuns: {},
  approvalRequest: undefined,
  artifacts: [],
  backendCustomUrl: '',
  backendEnvironment: 'LOCAL',
  backendStatus: 'connected',
  backendUrl: 'https://example.test',
  busy: false,
  connected: true,
  contextReceipt: {
    excluded: [],
    included: ['src/cart.ts', 'src/cart.test.ts', 'src/prices.ts'],
    totalBytes: 9216,
    truncated: false,
  },
  effortMode: 'ULTRA',
  entitlements: undefined,
  findings: [],
  frontendCustomUrl: '',
  frontendEnvironment: 'LOCAL',
  frontendUrl: 'https://example.test',
  generationQueue: { active: [], capacity: 2, pending: [] },
  history: [
    {
      id: 'thread-1',
      messageCount: 4,
      title: 'Fix the cart total',
      updatedAt: '2026-09-29T10:00:00.000Z',
    },
  ],
  lastError: undefined,
  modelWarnings: [],
  models: [cloudModel, fastModel, localModel],
  permissionMode: 'ASK',
  questionRequest: undefined,
  routingMode: 'MANUAL_MODEL',
  selectedModel: cloudModel.key,
  speedMode: '1X',
  tasks: [],
  usage: undefined,
  user: { email: 'sam@example.test', id: 'user-1' },
  viewDensity: 'full',
  workspaceReadiness: {
    hasActiveFile: true,
    hasSelection: false,
    hasWorkspace: true,
    trusted: true,
    workspaceName: 'shop-demo',
  },
  workspaceScope: {
    folders: [{ key: 'shop', name: 'shop-demo' }],
    selectedFolderKey: 'shop',
    selectedFolderName: 'shop-demo',
  },
  ...patch,
});

const conversation = [
  {
    id: 'm1',
    role: 'USER',
    content:
      'The cart total is off by a cent when I apply a discount. Can you fix it and add a test?',
    inputTokens: 24,
    modelDisplayName: cloudModel.displayName,
    outputTokens: 0,
  },
  {
    id: 'm2',
    role: 'ASSISTANT',
    content:
      'Found it. `applyDiscount` rounds each line item separately, so the cents drift.\n\n' +
      'I will round once, after the discount is applied to the whole cart, and add a regression test.',
    inputTokens: 1840,
    model: cloudModel.model,
    outputTokens: 96,
    provider: cloudModel.provider,
  },
];

const planConversation = [
  {
    id: 'p1',
    role: 'USER',
    content: 'Plan how to move the cart prices to whole cents. Do not change any files yet.',
    inputTokens: 22,
    modelDisplayName: cloudModel.displayName,
    outputTokens: 0,
  },
  {
    id: 'p2',
    role: 'ASSISTANT',
    content:
      'PLAN (nothing has been changed)\n\n' +
      '1. Add a `toCents()` helper in `src/prices.ts` and cover it with tests.\n' +
      '2. Store every price as whole cents inside `src/cart.ts`.\n' +
      '3. Format to dollars only when the total is shown.\n' +
      '4. Update the three failing tests in `src/cart.test.ts`.\n\n' +
      'FINDINGS\n\n' +
      '- `src/cart.ts:42` rounds per line item, which causes the one-cent drift.\n' +
      '- `src/prices.ts:17` mixes dollars and cents in one function.\n' +
      '- `src/cart.test.ts` has no test for a discount on an odd total.\n\n' +
      'Approve this plan and I will start with step 1.',
    inputTokens: 2210,
    model: cloudModel.model,
    outputTokens: 188,
    provider: cloudModel.provider,
  },
];

async function waitForServer() {
  for (let attempt = 0; attempt < 50; attempt += 1) {
    try {
      const response = await globalThis.fetch(origin);
      if (response.ok) {
        return;
      }
    } catch {
      // Not listening yet.
    }
    await delay(200);
  }
  throw new Error(`Fixture server did not start on ${origin}`);
}

async function open(page, theme, height, patch = {}) {
  await page.setViewportSize({ width, height });
  await page.goto(origin);
  await page.evaluate((mode) => {
    globalThis.document.body.dataset.theme = mode;
  }, theme);
  await page.evaluate((value) => {
    globalThis.__clawMock.send({ type: 'state', state: value });
  }, state(patch));
}

async function loadHistory(page, messages) {
  await page.evaluate((items) => {
    globalThis.__clawMock.send({
      type: 'session',
      session: {
        createdAt: 1,
        sessionId: 'session-1',
        subject: 'Fix the cart total',
        threadId: 'thread-1',
        updatedAt: 2,
      },
    });
    globalThis.__clawMock.send({ type: 'historyLoaded', messages: items });
  }, messages);
}

const shots = [
  {
    name: 'chat-agent-changes',
    height: 760,
    async run(page, theme) {
      await open(page, theme, 760);
      await page
        .locator('#prompt')
        .fill('The cart total is off by a cent when I apply a discount. Fix it and add a test.');
      await page.locator('#composer').evaluate((form) => {
        form.requestSubmit();
      });
      const request = await page.evaluate(() => globalThis.__clawMock.messages.at(-1));
      const requestId = request.requestId;
      await page.evaluate(
        ([id, text]) => {
          globalThis.__clawMock.send({
            type: 'streamEvent',
            requestId: id,
            event: { type: 'CONTENT_DELTA', delta: text },
          });
        },
        [requestId, conversation[1].content],
      );
      await page.evaluate((id) => {
        globalThis.__clawMock.send({
          type: 'result',
          requestId: id,
          result: {
            content: 'Applied: Round the cart total once and add a regression test',
            previewId: '3f6e4b63-3259-4bfe-9306-7916d2a8fd68',
            editPlan: {
              summary: 'Round the cart total once and add a regression test',
              files: [
                { path: 'src/cart.ts', operation: 'update', content: 'export const total = 0;' },
                {
                  path: 'src/cart.test.ts',
                  operation: 'update',
                  content: 'test("cents", () => {});',
                },
                { path: 'src/prices.ts', operation: 'create', content: 'export const cents = 1;' },
              ],
            },
          },
        });
      }, requestId);
      await page.locator('.change-receipt').waitFor();
    },
  },
  {
    name: 'approval-request',
    height: 700,
    async run(page, theme) {
      await open(page, theme, 700, {
        approvalRequest: {
          id: '8d4f6eb8-5382-4d50-b005-12320b088673',
          kind: 'finalDiff',
          title: 'Apply file changes',
          message:
            'ClawAI wants to change 3 files in shop-demo. Nothing is written until you approve.',
          details: ['Update src/cart.ts', 'Update src/cart.test.ts', 'Create src/prices.ts'],
        },
      });
      await loadHistory(page, conversation);
      await page.locator('#approvalPanel').waitFor({ state: 'visible' });
    },
  },
  {
    name: 'model-picker',
    height: 720,
    async run(page, theme) {
      await open(page, theme, 720);
      await loadHistory(page, conversation);
      await page.locator('#routeToggle').click();
      await page.locator('#modelSelect').focus();
    },
  },
  {
    name: 'attachments-voice',
    height: 620,
    async run(page, theme) {
      await open(page, theme, 620);
      await page.locator('#attachmentInput').setInputFiles([
        { name: 'checkout-error.png', mimeType: 'image/png', buffer: tinyPng() },
        { name: 'cart-notes.txt', mimeType: 'text/plain', buffer: Buffer.from('discount notes') },
        { name: 'prices.csv', mimeType: 'text/csv', buffer: Buffer.from('sku,cents\nA1,1999') },
      ]);
      await page
        .locator('#prompt')
        .fill('Use the screenshot and the notes to explain the odd total.');
      await page.locator('.attachment-chip').nth(2).waitFor();
      await page.getByRole('button', { name: 'Move later checkout-error.png' }).click();
      await page.locator('#voiceButton').focus();
    },
  },
  {
    name: 'plan-and-findings',
    height: 900,
    async run(page, theme) {
      await open(page, theme, 900, { agentMode: 'PLAN' });
      await loadHistory(page, planConversation);
    },
  },
  {
    name: 'parallel-runs',
    height: 640,
    async run(page, theme) {
      const first = '00000000-0000-4000-8000-000000000001';
      const second = '00000000-0000-4000-8000-000000000002';
      await open(page, theme, 640, {
        busy: true,
        agentRuns: {
          [first]: {
            files: [{ operation: 'update', path: 'src/cart.ts' }],
            phase: 'reviewing',
            summary: 'Round the cart total once',
          },
          [second]: { files: [], phase: 'reading', summary: 'Review the checkout tests' },
        },
        generationQueue: {
          active: [
            {
              concurrencyKey: 'chat-a',
              id: first,
              kind: 'agent',
              modelLabel: cloudModel.displayName,
              prompt: 'Round the cart total once',
              startedAt: Date.now(),
            },
            {
              concurrencyKey: 'chat-b',
              id: second,
              kind: 'chat',
              modelLabel: localModel.displayName,
              prompt: 'Review the checkout tests',
              startedAt: Date.now(),
            },
          ],
          capacity: 2,
          pending: [],
        },
      });
      await page.locator('.run-lane').nth(1).waitFor();
      await page.locator('.run-details summary').first().click();
    },
  },
];

function tinyPng() {
  return Buffer.from(
    'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNkYPhfDwAChwGA60e6kgAAAABJRU5ErkJggg==',
    'base64',
  );
}

mkdirSync(outDir, { recursive: true });
const server = spawn(execPath, [join('scripts', 'serve-webview-fixture.mjs')], {
  env: { ...process.env, CLAW_FIXTURE_PORT: String(port) },
  stdio: 'ignore',
});
let exitCode = 0;
try {
  await waitForServer();
  const browser = await chromium.launch();
  try {
    for (const theme of ['dark', 'light']) {
      for (const shot of shots) {
        const context = await browser.newContext({ deviceScaleFactor: 1 });
        const page = await context.newPage();
        await shot.run(page, theme);
        await page.waitForTimeout(250);
        const file = join(outDir, `${shot.name}-${theme}.png`);
        await page.screenshot({ path: file });
        stdout.write(`wrote ${file}\n`);
        await context.close();
      }
    }
  } finally {
    await browser.close();
  }
} catch (error) {
  exitCode = 1;
  process.stderr.write(`${error instanceof Error ? error.stack : String(error)}\n`);
} finally {
  server.kill();
}
process.exit(exitCode);
