import { createServer } from 'node:http';

import { WRITE_HELLO } from './fake-runtime-server';

import type { FakeTool } from './fake-runtime-server';
import type { IncomingMessage, Server, ServerResponse } from 'node:http';
import type { AddressInfo } from 'node:net';

/** One request the server saw, numbered per route so a test can fail "the first two". */
export interface FlakyCall {
  readonly route: 'thread' | 'memory' | 'start' | 'results' | 'stream';
  /** 1 for the first request to this route. */
  readonly count: number;
  readonly body: Record<string, unknown> | undefined;
  readonly after: number | undefined;
}

/** What to answer instead of the normal reply: an HTTP status, or a dropped socket. */
export type FlakyReply =
  | { readonly status: number; readonly body?: unknown; readonly headers?: Record<string, string> }
  | 'reset';

export interface FlakyOptions {
  readonly tool?: FakeTool;
  /** Overrides the reply to a request; undefined means the normal reply. */
  readonly intercept?: (call: FlakyCall) => FlakyReply | undefined;
  /**
   * Cuts stream connection N (1-based) with a dropped socket right after the
   * tool request was sent, or (`frame`) sends a `stream.error` frame instead.
   */
  readonly cutStream?: Readonly<Record<number, 'reset' | 'frame'>>;
}

export interface FlakyRuntime {
  readonly url: string;
  readonly calls: FlakyCall[];
  readonly results: () => FlakyCall[];
}

async function readJson(request: IncomingMessage): Promise<Record<string, unknown> | undefined> {
  const chunks: Buffer[] = [];
  for await (const chunk of request) chunks.push(chunk as Buffer);
  const text = Buffer.concat(chunks).toString('utf8');
  return text.length === 0 ? undefined : (JSON.parse(text) as Record<string, unknown>);
}

function routeOf(pathname: string, method: string): FlakyCall['route'] | undefined {
  if (pathname.endsWith('/chat-threads')) return 'thread';
  if (method === 'PATCH' && pathname.includes('/chat-threads/')) return 'memory';
  if (pathname.endsWith('/runtime/runs')) return 'start';
  if (pathname.endsWith('/results')) return 'results';
  return pathname.includes('/chat-messages/stream/') ? 'stream' : undefined;
}

function reply(response: ServerResponse, planned: FlakyReply): void {
  if (planned === 'reset') {
    response.socket?.destroy();
    return;
  }
  response.writeHead(planned.status, {
    'Content-Type': 'application/json',
    ...planned.headers,
  });
  response.end(JSON.stringify(planned.body ?? { message: 'planned failure' }));
}

/** The ordinary answer of the routes that need no state. */
const NORMAL_REPLIES: Partial<Record<FlakyCall['route'], FlakyReply>> = {
  thread: { status: 201, body: { id: 'thread-1' } },
  memory: { status: 200, body: { id: 'thread-1' } },
  start: { status: 202, body: { runId: 'run-1', generation: 'gen-1' } },
};

const cleanupCloseHooks: (() => Promise<void>)[] = [];

const frame = (event: unknown): string => `data: ${JSON.stringify(event)}\n\n`;

/**
 * A fake Runtime V2 backend whose failures a test decides. The normal round
 * trip is the one in `fake-runtime-server`: one file write, then completion.
 * Stream frames carry the `sequence` a real runtime sends, and a reconnect
 * (`after=N`) is answered with only the frames past N, as the real one does.
 */
export async function startFlakyRuntime(options: FlakyOptions = {}): Promise<FlakyRuntime> {
  const tool = options.tool ?? WRITE_HELLO;
  const calls: FlakyCall[] = [];
  const counts: Record<string, number> = {};
  let posted = false;
  let streams = 0;
  let wake: () => void = () => undefined;
  const server: Server = createServer((request, response) => {
    void (async () => {
      const url = new URL(request.url ?? '/', 'http://fake');
      const route = routeOf(url.pathname, request.method ?? '');
      const body = await readJson(request);
      if (route === undefined) {
        reply(response, { status: 404 });
        return;
      }
      counts[route] = (counts[route] ?? 0) + 1;
      const afterText = url.searchParams.get('after');
      const call: FlakyCall = {
        route,
        count: counts[route],
        body,
        after: afterText === null ? undefined : Number(afterText),
      };
      calls.push(call);
      const planned = options.intercept?.(call);
      if (planned !== undefined) {
        reply(response, planned);
        return;
      }
      const normal = NORMAL_REPLIES[route];
      if (normal !== undefined) {
        reply(response, normal);
        return;
      }
      if (route === 'results') {
        posted = true;
        wake();
        reply(response, { status: 202, body: { accepted: true } });
        return;
      }
      streams += 1;
      await stream(response, call.after ?? 0, options.cutStream?.[streams]);
    })();
  });

  async function stream(
    response: ServerResponse,
    after: number,
    cut: 'reset' | 'frame' | undefined,
  ): Promise<void> {
    response.writeHead(200, { 'Content-Type': 'text/event-stream' });
    const send = (sequence: number, event: Record<string, unknown>): void => {
      if (sequence > after) response.write(frame({ ...event, sequence }));
    };
    send(1, { type: 'model.delta', payload: { text: 'Writing ' } });
    send(2, {
      type: 'tool.requested',
      payload: {
        invocationId: 'invocation-1',
        toolName: tool.toolName,
        operation: tool.operation,
        invocation: { arguments: tool.arguments },
      },
    });
    if (cut === 'frame') {
      response.end(frame({ type: 'stream.error', code: 'RUNTIME_STATE_UNAVAILABLE' }));
      return;
    }
    if (cut === 'reset') {
      // Give the two frames time to reach the client before the socket dies.
      await new Promise((resolve) => setTimeout(resolve, 50));
      response.socket?.destroy();
      return;
    }
    if (!posted) await new Promise<void>((resolve) => (wake = resolve));
    send(3, { type: 'model.delta', payload: { text: 'done.' } });
    response.end(frame({ type: 'run.completed', sequence: 4 }));
  }

  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
  const { port } = server.address() as AddressInfo;
  const close = async (): Promise<void> =>
    new Promise((resolve) => {
      server.closeAllConnections();
      server.close(() => {
        resolve();
      });
    });
  cleanupCloseHooks.push(close);
  return {
    url: `http://127.0.0.1:${String(port)}/api/v1`,
    calls,
    results: () => calls.filter((call) => call.route === 'results'),
  };
}

/** Closes every flaky server started since the last call. */
export async function closeFlakyRuntimes(): Promise<void> {
  for (const close of cleanupCloseHooks.splice(0)) await close();
}
