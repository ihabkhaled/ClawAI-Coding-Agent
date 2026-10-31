import { createServer } from 'node:http';

import type { IncomingMessage, Server, ServerResponse } from 'node:http';
import type { AddressInfo } from 'node:net';

/** What the mock backend answers instead of the normal 2xx. */
export interface Planned {
  readonly status: number;
  readonly headers?: Record<string, string>;
}

export interface Seen {
  readonly route: 'start' | 'results' | 'steering' | 'refresh' | 'stream' | 'other';
  readonly key: string | undefined;
  readonly after: number | undefined;
}

export interface Mock {
  readonly url: string;
  readonly seen: Seen[];
  readonly plan: Record<'start' | 'results' | 'steering', Planned[]>;
  readonly streams: ServerResponse[];
  readonly count: (route: Seen['route']) => number;
  readonly push: (index: number, ...frames: object[]) => void;
  readonly close: () => Promise<void>;
}

const closers: (() => Promise<void>)[] = [];

/** Closes every mock started since the last call. */
export async function closePanelMocks(): Promise<void> {
  for (const close of closers.splice(0)) await close();
}

async function readJson(request: IncomingMessage): Promise<Record<string, unknown>> {
  const chunks: Buffer[] = [];
  for await (const chunk of request) chunks.push(chunk as Buffer);
  const text = Buffer.concat(chunks).toString('utf8');
  return text.length === 0 ? {} : (JSON.parse(text) as Record<string, unknown>);
}

function routeOf(pathname: string): Seen['route'] {
  if (pathname.endsWith('/runtime/runs')) return 'start';
  if (pathname.endsWith('/results')) return 'results';
  if (pathname.endsWith('/steering')) return 'steering';
  if (pathname.includes('/auth/')) return 'refresh';
  return pathname.includes('/chat-messages/stream/') ? 'stream' : 'other';
}

/** The run id every acknowledgement carries. */
export const RUN_ID = 'run_01JZZZZZZZZZZZZZZZZZZZZZZZ';

const ACKS = {
  start: {
    runId: RUN_ID,
    generation: 'generation-1',
    messageId: 'm-1',
    sequence: 0,
    replayed: false,
  },
  mutation: { runId: RUN_ID, sequence: 1, eventId: 'event-ack', replayed: false },
};

function plannedFor(plan: Mock['plan'], route: Seen['route']): Planned | undefined {
  return route === 'start' || route === 'results' || route === 'steering'
    ? plan[route].shift()
    : undefined;
}

function answer(
  response: ServerResponse,
  route: Seen['route'],
  planned: Planned | undefined,
): void {
  const status = route === 'refresh' ? 401 : (planned?.status ?? 200);
  response.writeHead(status, { 'Content-Type': 'application/json', ...planned?.headers });
  if (status >= 400) response.end(JSON.stringify({ message: 'planned failure' }));
  else response.end(JSON.stringify(route === 'start' ? ACKS.start : ACKS.mutation));
}

export async function startMock(): Promise<Mock> {
  const seen: Seen[] = [];
  const streams: ServerResponse[] = [];
  const plan: Mock['plan'] = { start: [], results: [], steering: [] };
  const server: Server = createServer((request, response) => {
    void (async () => {
      const url = new URL(request.url ?? '/', 'http://mock');
      const route = routeOf(url.pathname);
      const body = await readJson(request);
      const key = typeof body.idempotencyKey === 'string' ? body.idempotencyKey : undefined;
      const afterText = url.searchParams.get('after');
      seen.push({ route, key, after: afterText === null ? undefined : Number(afterText) });
      if (route === 'stream') {
        response.writeHead(200, { 'Content-Type': 'text/event-stream' });
        streams.push(response);
        return;
      }
      answer(response, route, plannedFor(plan, route));
    })();
  });
  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
  const { port } = server.address() as AddressInfo;
  const close = (): Promise<void> =>
    new Promise((resolve) => {
      server.closeAllConnections();
      server.close(() => {
        resolve();
      });
    });
  closers.push(close);
  return {
    url: `http://127.0.0.1:${String(port)}`,
    seen,
    plan,
    streams,
    count: (wanted) => seen.filter((entry) => entry.route === wanted).length,
    push(index, ...frames) {
      const stream = streams[index];
      if (stream === undefined) throw new Error(`stream ${String(index)} is not open`);
      for (const frame of frames) stream.write(`data: ${JSON.stringify(frame)}\n\n`);
    },
    close,
  };
}
