import { existsSync, readFileSync, writeFileSync } from 'node:fs';
import path from 'node:path';

import { afterEach, describe, expect, it } from 'vitest';

import { runHeadlessCli } from '../../src/headless/headless-cli';
import {
  capture,
  cleanupRuntimes,
  startRuntime,
  stateDir,
  workspace,
} from '../helpers/fake-runtime-server';

import type { FakeRuntime, FakeTool } from '../helpers/fake-runtime-server';

afterEach(cleanupRuntimes);

const echoServer = path.join(__dirname, '..', 'fixtures', 'mcp', 'echo-server.mjs');
const ECHO_CALL: FakeTool = {
  toolName: 'runtime.mcp',
  operation: 'call',
  arguments: { server: 'echo', tool: 'echo', arguments: { text: 'hi' } },
};

function environment(runtime: FakeRuntime, state = stateDir()) {
  return { CLAW_TOKEN: 'secret-token', CLAW_BACKEND_URL: runtime.url, CLAW_STATE_DIR: state };
}

function startBody(runtime: FakeRuntime): Record<string, unknown> {
  const start = runtime.requests.find((entry) => entry.path.endsWith('/runtime/runs'));
  return start?.body as Record<string, unknown>;
}

function submitted(runtime: FakeRuntime): unknown {
  return runtime.requests.find((entry) => entry.path.endsWith('/results'))?.body;
}

function mcpConfig(root: string, extra: Record<string, unknown> = {}): string {
  const file = path.join(root, 'mcp.json');
  writeFileSync(
    file,
    JSON.stringify({
      mcpServers: { echo: { command: process.execPath, args: [echoServer] } },
      ...extra,
    }),
  );
  return file;
}

describe('sessions: --resume and --continue', () => {
  it('--resume continues the named thread and creates none', async () => {
    const runtime = await startRuntime();
    const { io, out } = capture();

    const code = await runHeadlessCli(
      ['-p', 'again', '--resume', 'thread-9', '--output-format', 'json'],
      environment(runtime),
      io,
      { cwd: workspace() },
    );

    expect(code).toBe(0);
    expect(runtime.requests.some((entry) => entry.path.endsWith('/chat-threads'))).toBe(false);
    expect(startBody(runtime)).toMatchObject({ threadId: 'thread-9' });
    expect(runtime.requests.some((entry) => entry.path.endsWith('/stream/thread-9'))).toBe(true);
    expect(JSON.parse(out.join('')) as unknown).toMatchObject({ threadId: 'thread-9' });
  }, 20_000);

  it('--continue picks up the thread the previous run in this workspace used', async () => {
    const runtime = await startRuntime();
    const env = environment(runtime);
    const root = workspace();
    await runHeadlessCli(['-p', 'one'], env, capture().io, { cwd: root });
    const createdBefore = runtime.requests.filter((entry) => entry.path.endsWith('/chat-threads'));

    const code = await runHeadlessCli(['-p', 'two', '--continue'], env, capture().io, {
      cwd: root,
    });

    const starts = runtime.requests.filter((entry) => entry.path.endsWith('/runtime/runs'));
    expect(code).toBe(0);
    expect(createdBefore).toHaveLength(1);
    expect(runtime.requests.filter((entry) => entry.path.endsWith('/chat-threads'))).toHaveLength(
      1,
    );
    expect(starts.at(-1)?.body).toMatchObject({ threadId: 'thread-1', prompt: 'two' });
  }, 20_000);

  it('stores only a thread id, never the token or the prompt', async () => {
    const runtime = await startRuntime();
    const state = stateDir();

    await runHeadlessCli(
      ['-p', 'a very private prompt'],
      environment(runtime, state),
      capture().io,
      {
        cwd: workspace(),
      },
    );

    const stored = readFileSync(path.join(state, 'headless-threads.json'), 'utf8');
    expect(stored).toContain('thread-1');
    expect(stored).not.toContain('secret-token');
    expect(stored).not.toContain('private prompt');
  }, 20_000);

  it('--continue with nothing to continue is a usage error, before any request', async () => {
    const runtime = await startRuntime();
    const { io, err } = capture();

    const code = await runHeadlessCli(['-p', 'x', '--continue'], environment(runtime), io, {
      cwd: workspace(),
    });

    expect(code).toBe(2);
    expect(err.join('')).toContain('no previous thread');
    expect(runtime.requests).toEqual([]);
  });

  it('does not offer another workspace or backend the thread', async () => {
    const runtime = await startRuntime();
    const state = stateDir();
    await runHeadlessCli(['-p', 'one'], environment(runtime, state), capture().io, {
      cwd: workspace(),
    });

    const code = await runHeadlessCli(
      ['-p', 'two', '--continue'],
      environment(runtime, state),
      capture().io,
      {
        cwd: workspace(),
      },
    );

    expect(code).toBe(2);
  }, 20_000);
});

describe('operator instructions', () => {
  it('reads --system-prompt-file and --append-system-prompt @file into the run, in that order', async () => {
    const runtime = await startRuntime();
    const root = workspace();
    writeFileSync(path.join(root, 'base.md'), 'Base rules.');
    writeFileSync(path.join(root, 'more.md'), 'Extra rules.');
    const { io, out, err } = capture();

    await runHeadlessCli(
      ['-p', 'the task', '--system-prompt-file', 'base.md', '--append-system-prompt', '@more.md'],
      environment(runtime),
      io,
      { cwd: root },
    );

    expect(startBody(runtime).prompt).toBe(
      '<operator-instructions>\nBase rules.\n\nExtra rules.\n</operator-instructions>\n\nthe task',
    );
    expect([...out, ...err].join('')).not.toContain('Base rules.');
  }, 20_000);

  it('takes literal text, and refuses an oversized or missing file before any request', async () => {
    const runtime = await startRuntime();
    const root = workspace();
    await runHeadlessCli(
      ['-p', 't', '--append-system-prompt', 'Be brief.'],
      environment(runtime),
      capture().io,
      {
        cwd: root,
      },
    );
    writeFileSync(path.join(root, 'big.md'), 'x'.repeat(20_001));
    const requestsBefore = runtime.requests.length;

    const oversized = await runHeadlessCli(
      ['-p', 't', '--append-system-prompt', '@big.md'],
      environment(runtime),
      capture().io,
      { cwd: root },
    );
    const missing = await runHeadlessCli(
      ['-p', 't', '--system-prompt-file', 'nope.md'],
      environment(runtime),
      capture().io,
      { cwd: root },
    );

    expect(startBody(runtime).prompt).toContain('Be brief.');
    expect([oversized, missing]).toEqual([2, 2]);
    expect(runtime.requests).toHaveLength(requestsBefore);
  }, 20_000);
});

describe('--mcp-config', () => {
  it('lets the model call a configured MCP server through the real client', async () => {
    const runtime = await startRuntime({ tool: ECHO_CALL });
    const root = workspace();

    const code = await runHeadlessCli(
      ['-p', 'echo', '--mcp-config', mcpConfig(root)],
      environment(runtime),
      capture().io,
      { cwd: root },
    );

    expect(code).toBe(0);
    expect(
      (startBody(runtime).toolDefinitions as { name: string }[]).map((tool) => tool.name),
    ).toContain('runtime.mcp');
    expect(submitted(runtime)).toMatchObject({
      result: {
        status: 'succeeded',
        structured: { server: 'echo', isError: false, untrusted: true },
      },
    });
    expect(JSON.stringify(submitted(runtime))).toContain('echo: hi');
  }, 30_000);

  it('applies the policy in the file: a denied server is refused, never started', async () => {
    const runtime = await startRuntime({ tool: ECHO_CALL });
    const root = workspace();
    const config = mcpConfig(root, { policy: { deny: [{ name: 'echo' }] } });

    await runHeadlessCli(
      ['-p', 'echo', '--mcp-config', config],
      environment(runtime),
      capture().io,
      { cwd: root },
    );

    expect(submitted(runtime)).toMatchObject({
      result: { status: 'failed', error: { code: 'TOOL_FAILED' } },
    });
    expect(JSON.stringify(submitted(runtime))).toContain('MCP_SERVER_DENIED');
  }, 30_000);

  it('--disallowed-tools mcp__echo__* denies the call with PERMISSION_DENIED', async () => {
    const runtime = await startRuntime({ tool: ECHO_CALL });
    const root = workspace();

    await runHeadlessCli(
      ['-p', 'echo', '--mcp-config', mcpConfig(root), '--disallowed-tools', 'mcp__echo__*'],
      environment(runtime),
      capture().io,
      { cwd: root },
    );

    expect(submitted(runtime)).toMatchObject({ result: { error: { code: 'PERMISSION_DENIED' } } });
  }, 30_000);

  it('is a usage error when the file is missing, malformed or declares nothing', async () => {
    const runtime = await startRuntime();
    const root = workspace();
    writeFileSync(path.join(root, 'bad.json'), '{ "mcpServers": { "x": { "secret": "hunter2"');
    writeFileSync(path.join(root, 'empty.json'), '{}');
    const { io, err } = capture();

    const codes = [
      await runHeadlessCli(['-p', 'x', '--mcp-config', 'missing.json'], environment(runtime), io, {
        cwd: root,
      }),
      await runHeadlessCli(['-p', 'x', '--mcp-config', 'bad.json'], environment(runtime), io, {
        cwd: root,
      }),
      await runHeadlessCli(['-p', 'x', '--mcp-config', 'empty.json'], environment(runtime), io, {
        cwd: root,
      }),
    ];

    expect(codes).toEqual([2, 2, 2]);
    expect(err.join('')).toContain('not valid JSON');
    expect(err.join('')).not.toContain('hunter2');
    expect(runtime.requests).toEqual([]);
  });
});

describe('--permission-mode', () => {
  const written = (root: string): boolean => existsSync(path.join(root, 'hello.txt'));

  it('plan refuses the write even when --allow-tools grants it', async () => {
    const runtime = await startRuntime();
    const root = workspace();

    await runHeadlessCli(
      ['-p', 'w', '--allow-tools', 'read,write', '--permission-mode', 'plan'],
      environment(runtime),
      capture().io,
      { cwd: root },
    );

    expect(written(root)).toBe(false);
    expect(submitted(runtime)).toMatchObject({ result: { error: { code: 'PERMISSION_DENIED' } } });
  }, 20_000);

  it('ask denies a write when nobody can answer, and runs it when the person says yes', async () => {
    const denied = await startRuntime();
    const deniedRoot = workspace();
    await runHeadlessCli(
      ['-p', 'w', '--permission-mode', 'ask'],
      environment(denied),
      capture().io,
      { cwd: deniedRoot },
    );
    const approved = await startRuntime();
    const approvedRoot = workspace();
    const questions: string[] = [];

    await runHeadlessCli(
      ['-p', 'w', '--permission-mode', 'ask'],
      environment(approved),
      capture(async (question) => {
        questions.push(question);
        return Promise.resolve(true);
      }).io,
      { cwd: approvedRoot },
    );

    expect(written(deniedRoot)).toBe(false);
    expect(written(approvedRoot)).toBe(true);
    expect(questions).toHaveLength(1);
    expect(questions[0]).toContain('workspace.file.create');
  }, 30_000);

  it('accept-edits writes without asking anyone', async () => {
    const runtime = await startRuntime();
    const root = workspace();
    const questions: string[] = [];

    const code = await runHeadlessCli(
      ['-p', 'w', '--permission-mode', 'accept-edits'],
      environment(runtime),
      capture(async (question) => {
        questions.push(question);
        return Promise.resolve(false);
      }).io,
      { cwd: root },
    );

    expect(code).toBe(0);
    expect(written(root)).toBe(true);
    expect(questions).toEqual([]);
  }, 20_000);
});

describe('--allowed-tools and --disallowed-tools', () => {
  it('deny wins over allow', async () => {
    const runtime = await startRuntime();
    const root = workspace();

    await runHeadlessCli(
      [
        '-p',
        'w',
        '--allow-tools',
        'read,write',
        '--allowed-tools',
        'workspace.file.*',
        '--disallowed-tools',
        'workspace.file.create',
      ],
      environment(runtime),
      capture().io,
      { cwd: root },
    );

    expect(existsSync(path.join(root, 'hello.txt'))).toBe(false);
    expect(submitted(runtime)).toMatchObject({ result: { error: { code: 'PERMISSION_DENIED' } } });
    expect(startBody(runtime).toolDefinitions).toMatchObject([
      { name: 'workspace.file', operations: ['read', 'list'] },
    ]);
  }, 20_000);

  it('an allowed pattern still permits the call it names', async () => {
    const runtime = await startRuntime();
    const root = workspace();

    await runHeadlessCli(
      ['-p', 'w', '--allow-tools', 'write', '--allowed-tools', 'workspace.file.create'],
      environment(runtime),
      capture().io,
      { cwd: root },
    );

    expect(readFileSync(path.join(root, 'hello.txt'), 'utf8')).toBe('from the agent');
  }, 20_000);
});
