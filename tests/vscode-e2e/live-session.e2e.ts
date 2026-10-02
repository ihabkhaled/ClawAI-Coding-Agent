import {
  appendFileSync,
  existsSync,
  mkdirSync,
  mkdtempSync,
  readdirSync,
  readFileSync,
  rmSync,
  statSync,
} from 'node:fs';
import { createServer, request as httpRequest } from 'node:http';
import { request as httpsRequest } from 'node:https';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { env } from 'node:process';

import { expect, test } from '@playwright/test';

import {
  installExtension,
  launchVscode,
  runCommandFromPalette,
  seedWorkspace,
} from './vscode-harness';

import type { VscodeSession } from './vscode-harness';
import type { Frame } from 'playwright';

/**
 * A live, human-style session in a real editor against a real backend.
 *
 * Not part of `npm run check`: it needs a running ClawAI stack, real credentials
 * and paid model calls. It signs in through a logging proxy so the browser step
 * can be completed by API (the extension waits for a loopback callback that a
 * person would trigger by approving in a browser), then drives the chat panel
 * the way a user does, once per model, and records what the panel shows and what
 * ended up on disk.
 *
 * CLAW_LIVE_PASSWORD (required), CLAW_LIVE_EMAIL, CLAW_LIVE_BACKEND_URL,
 * CLAW_LIVE_MODELS (comma list of model names as the picker shows them),
 * CLAW_LIVE_PROMPT (use {dir} for the per-model folder), CLAW_LIVE_APPROVAL,
 * CLAW_LIVE_EFFORT, CLAW_LIVE_WAIT_MS, CLAW_LIVE_OUT.
 */
const BACKEND = env.CLAW_LIVE_BACKEND_URL ?? 'https://claw.local';
const EMAIL = env.CLAW_LIVE_EMAIL ?? 'admin@claw.local';
const PASSWORD = env.CLAW_LIVE_PASSWORD ?? '';
const MODELS = (env.CLAW_LIVE_MODELS ?? '').split(',').filter((name) => name.trim() !== '');
const PROMPT =
  env.CLAW_LIVE_PROMPT ??
  'In the folder {dir}, create src/stack.ts with a generic Stack<T> class (push, pop, peek, size) and src/stack.test.ts with at least 6 vitest tests, then run the tests and tell me the final count.';
const APPROVAL = env.CLAW_LIVE_APPROVAL ?? 'AUTO_EDIT';
const EFFORT = env.CLAW_LIVE_EFFORT ?? 'HIGH';
const WAIT_MS = Number(env.CLAW_LIVE_WAIT_MS ?? 480_000);
const OUT = env.CLAW_LIVE_OUT ?? mkdtempSync(path.join(tmpdir(), 'claw-live-'));
const NEWLINE = String.fromCharCode(10);

const manifest = JSON.parse(readFileSync('package.json', 'utf8')) as { version: string };
const VSIX = path.join('builds', `clawai-coding-agent-${manifest.version}.vsix`);

interface InitCapture {
  readonly callbackUri: string;
  readonly state: string;
  requestId?: string | undefined;
}

let session: VscodeSession;
let extensionsDirectory: string;
let proxyPort = 0;
let initCapture: InitCapture | undefined;
const proxyLog = path.join(OUT, 'proxy.log');

function noteInit(url: string, sent: Buffer, answer: Buffer): void {
  if (!url.endsWith('/authorize/init') || sent.length === 0) return;
  try {
    const request = JSON.parse(sent.toString('utf8')) as InitCapture;
    const reply = JSON.parse(answer.toString('utf8')) as { requestId?: string };
    initCapture = {
      callbackUri: request.callbackUri,
      state: request.state,
      requestId: reply.requestId,
    };
  } catch {
    // Not JSON: leave the capture empty and let the test fail loudly.
  }
}

function startProxy(): Promise<void> {
  mkdirSync(OUT, { recursive: true });
  const target = new URL(BACKEND);
  const send = target.protocol === 'https:' ? httpsRequest : httpRequest;
  const server = createServer((incoming, outgoing) => {
    const chunks: Buffer[] = [];
    incoming.on('data', (chunk: Buffer) => chunks.push(chunk));
    incoming.on('end', () => {
      const body = Buffer.concat(chunks);
      const upstream = send(
        {
          host: target.hostname,
          port: target.port === '' ? undefined : Number(target.port),
          method: incoming.method,
          path: incoming.url,
          headers: { ...incoming.headers, host: target.host },
        },
        (reply) => {
          // Streamed straight through: an event stream buffered until it closes
          // looks to the extension like a server that sends nothing.
          outgoing.writeHead(reply.statusCode ?? 502, reply.headers);
          const captured: Buffer[] = [];
          const wantsBody = (incoming.url ?? '').endsWith('/authorize/init');
          reply.on('data', (chunk: Buffer) => {
            if (wantsBody) captured.push(chunk);
            outgoing.write(chunk);
          });
          reply.on('end', () => {
            outgoing.end();
            const line = `${incoming.method ?? ''} ${incoming.url ?? ''} -> ${String(reply.statusCode)}`;
            appendFileSync(proxyLog, line + NEWLINE);
            if (wantsBody) noteInit(incoming.url ?? '', body, Buffer.concat(captured));
            if ((incoming.url ?? '').includes('/results') && body.length > 0) {
              appendFileSync(
                path.join(OUT, 'tool-results.log'),
                body.toString('utf8').slice(0, 1500) + NEWLINE,
              );
            }
          });
        },
      );
      upstream.on('error', (error) => {
        outgoing.writeHead(502);
        outgoing.end(String(error));
      });
      upstream.end(body);
    });
  });
  return new Promise((resolve) => {
    server.listen(0, '127.0.0.1', () => {
      const address = server.address();
      proxyPort = typeof address === 'object' && address !== null ? address.port : 0;
      resolve();
    });
  });
}

async function apiJson(
  pathName: string,
  body: unknown,
  token?: string,
): Promise<Record<string, unknown>> {
  const response = await fetch(`${BACKEND}/api/v1${pathName}`, {
    method: 'POST',
    headers: {
      'content-type': 'application/json',
      ...(token === undefined ? {} : { authorization: `Bearer ${token}` }),
    },
    body: JSON.stringify(body),
  });
  const parsed = (await response.json()) as Record<string, unknown>;
  if (!response.ok) {
    throw new Error(`${pathName} -> ${String(response.status)} ${JSON.stringify(parsed)}`);
  }
  return parsed;
}

async function frameWithText(text: string): Promise<Frame> {
  const deadline = Date.now() + 60_000;
  while (Date.now() < deadline) {
    for (const frame of session.window.frames()) {
      if (!frame.url().includes('vscode-webview')) continue;
      for (const child of frame.childFrames()) {
        const body = await child
          .locator('body')
          .innerText()
          .catch(() => '');
        if (body.includes(text)) return child;
      }
    }
    await new Promise((resolve) => setTimeout(resolve, 1_000));
  }
  throw new Error(`No webview frame showed: ${text}`);
}

async function shot(name: string): Promise<void> {
  await session.window.screenshot({ path: path.join(OUT, `${name}.png`) }).catch(() => undefined);
}

function listing(dir: string): string[] {
  return readdirSync(dir, { withFileTypes: true }).flatMap((entry) => {
    if (entry.name === 'node_modules' || entry.name === '.git') return [];
    if (!entry.isDirectory()) return [entry.name];
    return listing(path.join(dir, entry.name)).map((child) => `${entry.name}/${child}`);
  });
}

/** The extension host's own log lines for ClawAI, from the throwaway profile. */
function extensionLogs(): string {
  const roots = readdirSync(tmpdir())
    .filter((name) => name.startsWith('claw-e2e-user-'))
    .map((name) => path.join(tmpdir(), name))
    .sort((left, right) => statSync(left).mtimeMs - statSync(right).mtimeMs)
    .map((dir) => path.join(dir, 'logs'))
    .filter((dir) => existsSync(dir));
  const lines: string[] = [];
  const walk = (dir: string): void => {
    for (const entry of readdirSync(dir, { withFileTypes: true })) {
      const full = path.join(dir, entry.name);
      if (entry.isDirectory()) walk(full);
      else if (/output_logging|exthost/iu.test(full) && entry.name.endsWith('.log')) {
        const text = readFileSync(full, 'utf8');
        lines.push(
          `=== ${full}`,
          ...text
            .split(NEWLINE)
            .filter((line) => /claw|error|warn/iu.test(line))
            .slice(-80),
        );
      }
    }
  };
  for (const root of roots.slice(-1)) walk(root);
  return lines.join(NEWLINE);
}

async function signIn(): Promise<void> {
  await session.window.waitForTimeout(3_000);
  await runCommandFromPalette(session.window, 'ClawAI: Connect');
  await session.window.waitForTimeout(4_000);
  const connectFrame = await frameWithText('Custom backend URL').catch(async () => {
    await runCommandFromPalette(session.window, 'ClawAI: Connect');
    return frameWithText('Custom backend URL');
  });
  await shot('01-connect-page');
  await connectFrame.locator('button', { hasText: 'Connect to ClawAI' }).last().click();
  const deadline = Date.now() + 60_000;
  while (initCapture?.requestId === undefined && Date.now() < deadline) {
    await new Promise((resolve) => setTimeout(resolve, 500));
  }
  expect(initCapture?.requestId, 'the extension never started an authorization').toBeDefined();
  const login = await apiJson('/auth/login', { email: EMAIL, password: PASSWORD });
  const tokens = (login.tokens ?? (login.data as Record<string, unknown>).tokens) as {
    accessToken: string;
  };
  const approval = await apiJson(
    '/auth/vscode/authorize/approve',
    { requestId: initCapture?.requestId },
    tokens.accessToken,
  );
  const redirect = String(approval.redirectUri);
  expect(redirect.startsWith('http://127.0.0.1')).toBe(true);
  await fetch(redirect).catch(() => undefined);
}

/** Picks a model by its visible name; a name the picker lacks is reported, not skipped silently. */
async function pickModel(chat: Frame, name: string): Promise<boolean> {
  const picker = chat.locator('#modelSelect');
  let options = await picker.locator('option').allInnerTexts();
  // The catalog loads after the panel renders: wait for real models, not just presets.
  const loaded = Date.now() + 90_000;
  while (options.length < 12 && Date.now() < loaded) {
    await new Promise((resolve) => setTimeout(resolve, 2_000));
    options = await picker.locator('option').allInnerTexts();
  }
  const squash = (value: string): string => value.toLowerCase().replaceAll(/[^a-z0-9]/gu, '');
  const wanted = options.find((option) => squash(option).includes(squash(name)));
  if (wanted === undefined) {
    appendFileSync(path.join(OUT, 'picker-options.txt'), options.join(NEWLINE));
    return false;
  }
  await picker.selectOption({ label: wanted }, { timeout: 15_000 });
  return true;
}

async function configure(chat: Frame): Promise<void> {
  await chat.locator('#runMode').selectOption('agent', { timeout: 15_000 });
  await chat.locator('#moreSettingsSummary').evaluate((summary: HTMLElement) => {
    summary.click();
  });
  await chat.locator('#permissionMode').selectOption(APPROVAL, { timeout: 15_000 });
  const approve = chat.locator('button', { hasText: /^Approve$/u }).first();
  if (await approve.isVisible({ timeout: 4_000 }).catch(() => false)) {
    await approve.click({ timeout: 5_000 }).catch(() => undefined);
  }
  await chat.locator('#effortMode').selectOption(EFFORT, { timeout: 15_000 });
}

/** Clicks a pending Approve in whichever chat view shows it, like a person would. */
async function approveAnywhere(): Promise<boolean> {
  for (const frame of session.window.frames()) {
    if (!frame.url().includes('vscode-webview')) continue;
    for (const child of frame.childFrames()) {
      const button = child.locator('#approvalApprove');
      if (await button.isVisible({ timeout: 300 }).catch(() => false)) {
        await button.click({ timeout: 5_000 }).catch(() => undefined);
        return true;
      }
    }
  }
  return false;
}

/**
 * Waits for the run to end, as the editor's own status bar reports it.
 *
 * A model can think quietly for a minute, so "the panel stopped changing" ends a
 * run that is still going, and starting the next conversation cancels it. The
 * status item reads "Running" while a run is live and "Waiting for you" while it
 * needs an approval; neither text means it is over.
 */
async function waitForRunEnd(chat: Frame): Promise<string> {
  const finish = Date.now() + WAIT_MS;
  let approvals = 0;
  let idle = 0;
  while (Date.now() < finish && idle < 3) {
    await new Promise((resolve) => setTimeout(resolve, 4_000));
    if (await approveAnywhere()) {
      approvals += 1;
      idle = 0;
      continue;
    }
    const status = await session.window
      .locator('.statusbar')
      .innerText()
      .catch(() => '');
    idle = /Running|Waiting for you/u.test(status) ? 0 : idle + 1;
  }
  appendFileSync(path.join(OUT, 'approvals.txt'), `${String(approvals)}${NEWLINE}`);
  return chat
    .locator('body')
    .innerText()
    .catch(() => '');
}

/**
 * Waits until the sign-in route answers cleanly several times in a row.
 *
 * A dev stack that restarts a service whenever its source changes answers 502
 * for a few seconds each time, and a run started in that window fails for a
 * reason that has nothing to do with the extension.
 */
async function waitForStableStack(): Promise<void> {
  let calm = 0;
  const deadline = Date.now() + 300_000;
  while (calm < 4 && Date.now() < deadline) {
    const status = await fetch(`${BACKEND}/api/v1/auth/vscode/authorize/init`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: '{}',
    })
      .then((response) => response.status)
      .catch(() => 0);
    calm = status === 400 ? calm + 1 : 0;
    await new Promise((resolve) => setTimeout(resolve, 4_000));
  }
  expect(calm, 'the stack never settled: a service keeps restarting').toBeGreaterThanOrEqual(4);
}

test.beforeAll(async () => {
  expect(PASSWORD, 'set CLAW_LIVE_PASSWORD').not.toBe('');
  await waitForStableStack();
  await startProxy();
  extensionsDirectory = mkdtempSync(path.join(tmpdir(), 'claw-live-ext-'));
  await installExtension(VSIX, extensionsDirectory);
  const workspace = seedWorkspace();
  session = await launchVscode({
    extensionsDirectory,
    workspace,
    settings: {
      'clawAI.backendEnvironment': 'CUSTOM',
      'clawAI.backendCustomUrl': `http://127.0.0.1:${String(proxyPort)}`,
    },
  });
  await session.window.locator('.activitybar [aria-label*="ClawAI" i]').first().click();
});

test.afterAll(async () => {
  await session.close();
  try {
    rmSync(extensionsDirectory, { force: true, recursive: true });
  } catch {
    // Disposable either way.
  }
});

test('signs in and runs the same task with each model, recording what happened', async () => {
  await shot('00-start');
  await signIn();
  let chat = await frameWithText('What should we build?');
  await expect(chat.locator('#prompt')).toBeVisible({ timeout: 60_000 });
  await shot('02-connected');
  const names = MODELS.length === 0 ? ['Automatic routing'] : MODELS;
  const summary: string[] = [];
  for (const [index, name] of names.entries()) {
    const slug = `m${String(index + 1)}`;
    if (index > 0) {
      await chat.locator('#newChatButton').evaluate((button: HTMLElement) => {
        button.click();
      });
      chat = await frameWithText('What should we build?');
    }
    if (!(await pickModel(chat, name))) {
      summary.push(`${name}: NOT IN PICKER`);
      continue;
    }
    await configure(chat);
    await shot(`${slug}-configured`);
    await chat.locator('#prompt').fill(PROMPT.replaceAll('{dir}', slug), { timeout: 15_000 });
    await chat.locator('#prompt').press('Control+Enter', { timeout: 15_000 });
    const text = await waitForRunEnd(chat);
    await shot(`${slug}-after-run`);
    appendFileSync(path.join(OUT, `${slug}-panel.txt`), text);
    appendFileSync(path.join(OUT, `${slug}-extension.log`), extensionLogs());
    const files = listing(session.workspace).filter((file) => file.startsWith(`${slug}/`));
    summary.push(`${name}: ${String(files.length)} files: ${files.join(', ')}`);
  }
  appendFileSync(path.join(OUT, 'summary.txt'), summary.join(NEWLINE));
  appendFileSync(path.join(OUT, 'diagnostics.txt'), session.diagnostics());
  expect(existsSync(path.join(OUT, 'summary.txt'))).toBe(true);
});
