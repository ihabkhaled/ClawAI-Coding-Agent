import { readFileSync } from 'node:fs';
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

afterEach(cleanupRuntimes);

describe('clawai headless runner against a fake Runtime V2 server', () => {
  it('completes a full tool round trip and exits 0', async () => {
    const runtime = await startRuntime();
    const root = workspace();
    const { io, out } = capture();

    const code = await runHeadlessCli(
      [
        '-p',
        'write hello',
        '--allow-tools',
        'read,write',
        '--output-format',
        'json',
        '--max-turns',
        '4',
      ],
      { CLAW_TOKEN: 'secret-token', CLAW_BACKEND_URL: runtime.url, CLAW_STATE_DIR: stateDir() },
      io,
      { cwd: root },
    );

    expect(code).toBe(0);
    expect(readFileSync(path.join(root, 'hello.txt'), 'utf8')).toBe('from the agent');
    const printed = JSON.parse(out.join('')) as Record<string, unknown>;
    expect(printed).toMatchObject({
      outcome: 'completed',
      exitCode: 0,
      toolCalls: 1,
      text: 'Writing done.',
      runId: 'run-1',
    });
    expect(out.join('')).not.toContain('secret-token');

    const start = runtime.requests.find((entry) => entry.path.endsWith('/runtime/runs'));
    expect(start?.auth).toBe('Bearer secret-token');
    expect(start?.body).toMatchObject({ budget: { maxModelTurns: 4 } });
    const submitted = runtime.requests.find((entry) => entry.path.endsWith('/results'));
    expect(submitted?.body).toMatchObject({
      generation: 'gen-1',
      result: {
        invocationId: 'invocation-1',
        status: 'succeeded',
        structured: { written: 'hello.txt' },
        receipt: { invocationId: 'invocation-1' },
      },
    });
  }, 20_000);

  it('streams one JSON event per line in stream-json mode', async () => {
    const runtime = await startRuntime();
    const { io, out } = capture();

    const code = await runHeadlessCli(
      ['-p', 'write hello', '--allow-tools', 'write', '--output-format', 'stream-json'],
      { CLAW_TOKEN: 't', CLAW_BACKEND_URL: runtime.url, CLAW_STATE_DIR: stateDir() },
      io,
      { cwd: workspace() },
    );

    const types = out.map((line) => (JSON.parse(line) as { type: string }).type);
    expect(code).toBe(0);
    expect(types[0]).toBe('run.started');
    expect(types).toContain('tool.call');
    expect(types).toContain('tool.result');
    expect(types.at(-1)).toBe('run.finished');
  }, 20_000);

  it('refuses an ungranted tool locally and hands the model PERMISSION_DENIED', async () => {
    const runtime = await startRuntime();
    const root = workspace();
    const { io, err } = capture();

    const code = await runHeadlessCli(
      ['-p', 'write hello'],
      { CLAW_TOKEN: 't', CLAW_BACKEND_URL: runtime.url, CLAW_STATE_DIR: stateDir() },
      io,
      { cwd: root },
    );

    // The fake completes regardless, so the run reports success, but the write
    // was refused locally and told to the model as PERMISSION_DENIED.
    expect(code).toBe(0);
    expect(err.join('')).toContain('[denied] workspace.file.create');
    const submitted = runtime.requests.find((entry) => entry.path.endsWith('/results'));
    expect(submitted?.body).toMatchObject({
      result: { status: 'failed', error: { code: 'PERMISSION_DENIED' } },
    });
    expect(() => readFileSync(path.join(root, 'hello.txt'))).toThrow();
  }, 20_000);

  it('exits 3 when the backend refuses the token, without printing it', async () => {
    const runtime = await startRuntime({ rejectToken: true });
    const { io, out, err } = capture();

    const code = await runHeadlessCli(
      ['-p', 'x'],
      { CLAW_TOKEN: 'secret-token', CLAW_BACKEND_URL: runtime.url, CLAW_STATE_DIR: stateDir() },
      io,
      { cwd: workspace() },
    );

    expect(code).toBe(3);
    expect([...out, ...err].join('')).not.toContain('secret-token');
  }, 20_000);

  it('exits 3 with no credential and 2 on a usage error, before any request', async () => {
    const { io, err } = capture();

    expect(await runHeadlessCli(['-p', 'x'], {}, io, { cwd: workspace() })).toBe(3);
    expect(err.join('')).toContain('CLAW_TOKEN');
    expect(await runHeadlessCli(['--nope'], { CLAW_TOKEN: 't' }, io, { cwd: workspace() })).toBe(2);
    expect(await runHeadlessCli(['--help'], {}, io, { cwd: workspace() })).toBe(0);
  });

  it('exits 130 when aborted', async () => {
    const runtime = await startRuntime();
    const controller = new AbortController();
    controller.abort();
    const { io } = capture();

    const code = await runHeadlessCli(
      ['-p', 'x'],
      { CLAW_TOKEN: 't', CLAW_BACKEND_URL: runtime.url, CLAW_STATE_DIR: stateDir() },
      io,
      { cwd: workspace(), signal: controller.signal },
    );

    expect(code).toBe(130);
  }, 20_000);
});
