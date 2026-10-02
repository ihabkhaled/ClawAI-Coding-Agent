import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { createServer } from 'node:http';
import { tmpdir } from 'node:os';
import path from 'node:path';

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { loadPlaywright } from '../../src/sdk/browser-session';
import { createAgent } from '../../src/sdk/create-agent';
import { COMPLETED, scriptedRuns } from '../helpers/scripted-runs';

import type { HeadlessStreamEvent } from '../../src/headless/headless-session.types';
import type { AgentEvent } from '../../src/sdk/create-agent.types';
import type { Server } from 'node:http';
import type { AddressInfo } from 'node:net';

vi.setConfig({ testTimeout: 60_000, hookTimeout: 30_000 });

async function canLaunch(): Promise<boolean> {
  try {
    const playwright = await loadPlaywright();
    const browser = await playwright.chromium.launch({ headless: true });
    await browser.close();
    return true;
  } catch {
    return false;
  }
}

const browserAvailable = await canLaunch();

let counter = 0;
function call(
  toolName: string,
  operation: string,
  args: Record<string, unknown>,
): HeadlessStreamEvent {
  counter += 1;
  return {
    type: 'tool.requested',
    payload: {
      invocationId: `n-${String(counter)}`,
      toolName,
      operation,
      invocation: { arguments: args },
    },
  };
}

const created: string[] = [];
const servers: Server[] = [];
const saved = process.env.CLAW_STATE_DIR;

function directory(prefix: string): string {
  const made = mkdtempSync(path.join(tmpdir(), prefix));
  created.push(made);
  return made;
}

/**
 * A workspace in a folder of its own. A run that may write audits the entries
 * beside its workspace and removes new ones, so a workspace made straight in the
 * shared temp folder would delete the folders other tests create meanwhile.
 */
function workspaceDirectory(): string {
  const workspace = path.join(directory('claw-smoke-'), 'workspace');
  mkdirSync(workspace);
  return workspace;
}

async function listen(server: Server): Promise<number> {
  servers.push(server);
  await new Promise<void>((done) => server.listen(0, '127.0.0.1', done));
  return (server.address() as AddressInfo).port;
}

beforeEach(() => {
  process.env.CLAW_STATE_DIR = directory('claw-state-');
});

afterEach(async () => {
  if (saved === undefined) delete process.env.CLAW_STATE_DIR;
  else process.env.CLAW_STATE_DIR = saved;
  for (const server of servers.splice(0)) await new Promise((done) => server.close(done));
  for (const made of created.splice(0)) rmSync(made, { force: true, recursive: true });
});

/** One text blob of everything the run sent back to the model. */
function transcript(submitted: readonly unknown[]): string {
  return JSON.stringify(submitted);
}

function fixtureProject(): string {
  const workspace = workspaceDirectory();
  mkdirSync(path.join(workspace, 'src'));
  mkdirSync(path.join(workspace, 'test'));
  writeFileSync(
    path.join(workspace, 'package.json'),
    JSON.stringify({ name: 'fx', private: true, scripts: { test: 'node --test' } }),
  );
  writeFileSync(path.join(workspace, 'src', 'math.js'), 'exports.add = (a, b) => a - b;\n');
  writeFileSync(
    path.join(workspace, 'test', 'math.test.js'),
    "const t = require('node:test'); const a = require('node:assert'); const { add } = require('../src/math');\nt('add', () => { a.strictEqual(add(2, 3), 5); });\n",
  );
  writeFileSync(
    path.join(workspace, 'serve.js'),
    "setTimeout(() => console.log('READY on fx'), 300); setInterval(() => {}, 1000);\n",
  );
  return workspace;
}

describe('several of the new tools in one run, against real files and processes', () => {
  it('plans, fixes a bug, proves it with code.gates, and watches a server with process.watch', async () => {
    const workspace = fixtureProject();
    const runtime = scriptedRuns([
      [
        call('task.plan', 'set', {
          steps: [
            { id: 'fix', title: 'fix add' },
            {
              id: 'green',
              title: 'tests pass',
              check: { executable: 'node', args: ['--test'] },
            },
          ],
        }),
        call('workspace.file', 'update', {
          path: 'src/math.js',
          oldText: 'a - b',
          newText: 'a + b',
        }),
        call('code.gates', 'detect', {}),
        call('code.gates', 'run', { gate: 'test' }),
        call('process.watch', 'start', {
          name: 'srv',
          executable: 'node',
          arguments: ['serve.js'],
        }),
        call('process.watch', 'wait', { name: 'srv', untilMatch: 'READY', timeoutMs: 10_000 }),
        call('process.watch', 'stop', { name: 'srv' }),
        call('task.plan', 'update', { id: 'fix', status: 'done' }),
        call('task.plan', 'update', { id: 'green', status: 'done' }),
        COMPLETED,
      ],
    ]);
    const events: AgentEvent[] = [];
    const agent = createAgent({
      auth: { token: 't' },
      workspaceRoot: workspace,
      transport: runtime.transport,
      permissions: { allow: ['read', 'write', 'command', 'git'] },
      taskPlan: true,
    });

    const result = await agent.run('fix add and prove it', {
      autoContinue: 0,
      onEvent: (event) => events.push(event),
    });
    expect(result.outcome).toBe('completed');
    expect(readFileSync(path.join(workspace, 'src', 'math.js'), 'utf8')).toContain('a + b');
    const text = transcript(runtime.submitted);
    expect(text).toContain('"status":"pass"');
    expect(text).toContain('READY on fx');
    expect(events.filter((event) => event.type === 'tool.denied')).toEqual([]);
    expect(events.filter((event) => event.type === 'run.plan').at(-1)).toMatchObject({
      total: 2,
      done: 2,
    });
    const names = runtime.starts[0]?.toolDefinitions.map(
      (entry) => (entry as { name: string }).name,
    );
    expect(names).toEqual(
      expect.arrayContaining(['task.plan', 'code.gates', 'process.watch', 'workspace.command']),
    );
  });

  it('calls a local API with http.request and loads knowledge, and the shell stays absent', async () => {
    const workspace = workspaceDirectory();
    writeFileSync(
      path.join(workspace, 'CLAUDE.md'),
      '# Rules\n\nAlways add a test for a new route.\n',
    );
    mkdirSync(path.join(workspace, 'rules'));
    writeFileSync(
      path.join(workspace, 'rules', '01-testing.md'),
      '# Testing\n\nEvery route has a test.\n',
    );
    const port = await listen(
      createServer((request, response) => {
        response.writeHead(200, { 'Content-Type': 'application/json' });
        response.end(JSON.stringify({ ok: true, path: request.url }));
      }),
    );
    const base = `http://127.0.0.1:${String(port)}`;
    const runtime = scriptedRuns([
      [
        call('knowledge.context', 'task', { description: 'add a route and test it' }),
        call('http.request', 'request', { method: 'GET', url: `${base}/api/health` }),
        call('http.request', 'request', {
          method: 'POST',
          url: `${base}/api/thing`,
          json: { a: 1 },
        }),
        call('workspace.shell', 'run', { script: 'echo hi' }),
        COMPLETED,
      ],
    ]);
    const events: AgentEvent[] = [];
    const approvals: string[] = [];
    const agent = createAgent({
      auth: { token: 't' },
      workspaceRoot: workspace,
      transport: runtime.transport,
      permissionMode: 'ask',
      permissions: {
        allow: ['read', 'git', 'http', 'http-write', 'shell'],
        httpAllowHosts: [`127.0.0.1:${String(port)}`],
        approve: (request) => {
          approvals.push(`${request.toolName}.${request.operation}:${request.category}`);
          return false;
        },
      },
      loadKnowledge: true,
    });

    await agent.run('test the API', { autoContinue: 0, onEvent: (event) => events.push(event) });

    const text = transcript(runtime.submitted);
    expect(text).toContain('"ok":true');
    expect(text).toContain('rules/01-testing.md');
    // The POST was put to the approver and refused; the shell has no second switch, so it never exists.
    expect(approvals).toEqual(['http.request.request:http-write']);
    const denied = events.filter((event) => event.type === 'tool.denied');
    expect(denied.map((event) => event.toolName)).toEqual(['http.request', 'workspace.shell']);
  });

  it.skipIf(!browserAvailable)(
    'opens a local page with browser.page after http.request has checked its API',
    async () => {
      const workspace = workspaceDirectory();
      const port = await listen(
        createServer((request, response) => {
          if (request.url === '/api') {
            response.writeHead(200, { 'Content-Type': 'application/json' });
            response.end('{"ready":true}');
            return;
          }
          response.writeHead(200, { 'Content-Type': 'text/html' });
          response.end(
            '<!doctype html><title>Smoke</title><h1>Hello smoke</h1><button>Go</button>',
          );
        }),
      );
      const base = `http://127.0.0.1:${String(port)}`;
      const runtime = scriptedRuns([
        [
          call('http.request', 'request', { method: 'GET', url: `${base}/api` }),
          call('browser.page', 'open', { url: `${base}/` }),
          call('browser.page', 'snapshot', {}),
          call('browser.page', 'close', {}),
          COMPLETED,
        ],
      ]);
      const agent = createAgent({
        auth: { token: 't' },
        workspaceRoot: workspace,
        transport: runtime.transport,
        permissions: {
          allow: ['read', 'http', 'browser'],
          httpAllowHosts: [`127.0.0.1:${String(port)}`],
        },
        browser: { allowHosts: ['127.0.0.1'] },
      });

      const result = await agent.run('check the page', { autoContinue: 0 });

      expect(result.outcome).toBe('completed');
      const text = transcript(runtime.submitted);
      expect(text).toContain('"status":200');
      expect(text).toContain('Hello smoke');
    },
  );
});
