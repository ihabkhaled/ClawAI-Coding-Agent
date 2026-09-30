import { mkdtempSync } from 'node:fs';
import { rm } from 'node:fs/promises';
import { createServer } from 'node:http';
import { tmpdir } from 'node:os';
import path from 'node:path';

import type { IncomingMessage, Server, ServerResponse } from 'node:http';
import type { AddressInfo } from 'node:net';

/**
 * A fake Runtime V2 backend on a real socket, driven through the real HTTP
 * transport. The stream asks for one file write, waits until the result has
 * been posted back, then completes — so a pass proves the whole round trip:
 * start, stream, local execution, receipt submission, terminal event.
 */
export interface FakeRuntime {
  readonly url: string;
  readonly requests: { method: string; path: string; auth?: string; body: unknown }[];
  readonly close: () => Promise<void>;
}

const cleanups: (() => Promise<void>)[] = [];

/** Closes every server and removes every workspace made since the last call. */
export async function cleanupRuntimes(): Promise<void> {
  for (const cleanup of cleanups.splice(0)) await cleanup();
}

/** A private state directory for one test, so `--continue` never touches the real home. */
export function stateDir(): string {
  return workspace();
}

export function workspace(): string {
  const directory = mkdtempSync(path.join(tmpdir(), 'claw-headless-cli-'));
  cleanups.push(async () => {
    // A spawned MCP server can still hold the directory for a moment on Windows.
    // Async, so the loop stays free to deliver the stdin close that lets it exit.
    await rm(directory, { force: true, recursive: true, maxRetries: 20, retryDelay: 100 });
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

export interface FakeTool {
  readonly toolName: string;
  readonly operation: string;
  readonly arguments: Record<string, unknown>;
}

export const WRITE_HELLO: FakeTool = {
  toolName: 'workspace.file',
  operation: 'create',
  arguments: { path: 'hello.txt', content: 'from the agent' },
};

export async function startRuntime(
  options: { rejectToken?: boolean; tool?: FakeTool } = {},
): Promise<FakeRuntime> {
  const tool = options.tool ?? WRITE_HELLO;
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
      if (url.pathname.startsWith('/api/v1/chat-messages/stream/')) {
        response.writeHead(200, { 'Content-Type': 'text/event-stream' });
        const frame = (event: unknown): string => `data: ${JSON.stringify(event)}\n\n`;
        response.write(frame({ type: 'model.delta', payload: { text: 'Writing ' } }));
        response.write(
          frame({
            type: 'tool.requested',
            payload: {
              invocationId: 'invocation-1',
              toolName: tool.toolName,
              operation: tool.operation,
              invocation: { arguments: tool.arguments },
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

export function capture(confirm?: (question: string) => Promise<boolean>) {
  const out: string[] = [];
  const err: string[] = [];
  return {
    out,
    err,
    io: {
      stdout: (text: string) => out.push(text),
      stderr: (text: string) => err.push(text),
      ...(confirm === undefined ? {} : { confirm }),
    },
  };
}
