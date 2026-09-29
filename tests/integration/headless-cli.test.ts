import { mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { createServer } from 'node:http';
import { tmpdir } from 'node:os';
import path from 'node:path';

import { afterEach, describe, expect, it } from 'vitest';

import { runHeadlessCli } from '../../src/headless/headless-cli';

import type { IncomingMessage, Server, ServerResponse } from 'node:http';
import type { AddressInfo } from 'node:net';

/**
 * A fake Runtime V2 backend on a real socket, driven through the real HTTP
 * transport. The stream asks for one file write, waits until the result has
 * been posted back, then completes — so a pass proves the whole round trip:
 * start, stream, local execution, receipt submission, terminal event.
 */
interface FakeRuntime {
  readonly url: string;
  readonly requests: { method: string; path: string; auth?: string; body: unknown }[];
  readonly close: () => Promise<void>;
}

const cleanups: (() => Promise<void>)[] = [];

afterEach(async () => {
  for (const cleanup of cleanups.splice(0)) await cleanup();
});

function workspace(): string {
  const directory = mkdtempSync(path.join(tmpdir(), 'claw-headless-cli-'));
  cleanups.push(async () => {
    rmSync(directory, { force: true, recursive: true });
    return Promise.resolve();
  });
  return directory;
}

async function readBody(request: IncomingMessage): Promise<unknown> {
  const chunks: Buffer[] = [];
  for await (const chunk of request) chunks.push(chunk as Buffer);
  const text = Buffer.concat(chunks).toString('utf8');
  return text.length === 0 ? undefined : JSON.parse(text);
}

function send(response: ServerResponse, status: number, body: unknown): void {
  response.writeHead(status, { 'Content-Type': 'application/json' });
  response.end(JSON.stringify(body));
}

async function startRuntime(options: { rejectToken?: boolean } = {}): Promise<FakeRuntime> {
  const requests: FakeRuntime['requests'] = [];
  let resultPosted: () => void = () => undefined;
  const posted = new Promise<void>((resolve) => {
    resultPosted = resolve;
  });

  const server: Server = createServer((request, response) => {
    void (async () => {
      const url = new URL(request.url ?? '/', 'http://fake');
      const body = await readBody(request);
      requests.push({
        method: request.method ?? '',
        path: url.pathname,
        ...(request.headers.authorization === undefined
          ? {}
          : { auth: request.headers.authorization }),
        body,
      });
      if (options.rejectToken === true) {
        send(response, 401, { message: 'Unauthorized' });
        return;
      }
      if (url.pathname === '/api/v1/chat-threads') {
        send(response, 201, { id: 'thread-1' });
        return;
      }
      if (url.pathname === '/api/v1/chat-messages/runtime/runs') {
        send(response, 202, { runId: 'run-1', generation: 'gen-1' });
        return;
      }
      if (url.pathname === '/api/v1/chat-messages/runtime/runs/run-1/results') {
        send(response, 202, { accepted: true });
        resultPosted();
        return;
      }
      if (url.pathname === '/api/v1/chat-messages/stream/thread-1') {
        response.writeHead(200, { 'Content-Type': 'text/event-stream' });
        const frame = (event: unknown): string => `data: ${JSON.stringify(event)}\n\n`;
        response.write(frame({ type: 'model.delta', payload: { text: 'Writing ' } }));
        response.write(
          frame({
            type: 'tool.requested',
            payload: {
              invocationId: 'invocation-1',
              toolName: 'workspace.file',
              operation: 'create',
              invocation: { arguments: { path: 'hello.txt', content: 'from the agent' } },
            },
          }),
        );
        await posted;
        response.write(frame({ type: 'model.delta', payload: { text: 'done.' } }));
        response.end(frame({ type: 'run.completed' }));
        return;
      }
      send(response, 404, {});
    })();
  });

  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
  const { port } = server.address() as AddressInfo;
  const close = async (): Promise<void> =>
    new Promise((resolve) => {
      server.closeAllConnections();
      server.close(() => {
        resolve();
      });
    });
  cleanups.push(close);
  return { url: `http://127.0.0.1:${String(port)}/api/v1`, requests, close };
}

function capture() {
  const out: string[] = [];
  const err: string[] = [];
  return {
    out,
    err,
    io: { stdout: (text: string) => out.push(text), stderr: (text: string) => err.push(text) },
  };
}

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
      { CLAW_TOKEN: 'secret-token', CLAW_BACKEND_URL: runtime.url },
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
      { CLAW_TOKEN: 't', CLAW_BACKEND_URL: runtime.url },
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
      { CLAW_TOKEN: 't', CLAW_BACKEND_URL: runtime.url },
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
      { CLAW_TOKEN: 'secret-token', CLAW_BACKEND_URL: runtime.url },
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
      { CLAW_TOKEN: 't', CLAW_BACKEND_URL: runtime.url },
      io,
      { cwd: workspace(), signal: controller.signal },
    );

    expect(code).toBe(130);
  }, 20_000);
});
