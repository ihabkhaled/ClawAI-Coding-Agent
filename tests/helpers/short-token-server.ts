import { createServer } from 'node:http';

import type { IncomingMessage, Server, ServerResponse } from 'node:http';

/** A backend that issues short-lived tokens and behaves like the real one about them. */
export interface ShortTokenServer {
  readonly url: string;
  readonly log: {
    refreshes: number;
    /** The `after` cursor of every stream connection, in order. */
    streamAfters: number[];
    /** Tool results received, by the order they arrived. */
    results: number;
    unauthorized: number;
    bodies: string[];
  };
  readonly mint: () => { accessToken: string; refreshToken: string };
  /** Make the next refresh answer 401 (a revoked family). */
  readonly refuseRefreshesFrom: (count: number) => void;
  readonly close: () => Promise<void>;
}

interface Options {
  /** Access token life in seconds. */
  readonly ttlSeconds: number;
  /** One event every this many ms; the run completes after `events` of them. */
  readonly everyMs: number;
  readonly events: number;
  /** Delay before a refresh answers, to give concurrent callers time to overlap. */
  readonly refreshDelayMs?: number;
}

const encode = (value: unknown): string => Buffer.from(JSON.stringify(value)).toString('base64url');

/** A JWT-shaped token carrying `exp`; the signature segment holds the sentinel the tests search for. */
export function sentinelJwt(expSeconds: number, serial: number): string {
  return `${encode({ alg: 'none' })}.${encode({ exp: expSeconds, sub: 'u' })}.SENTINELSIG${String(serial)}`;
}

export async function startShortTokenServer(options: Options): Promise<ShortTokenServer> {
  const log: ShortTokenServer['log'] = {
    refreshes: 0,
    streamAfters: [],
    results: 0,
    unauthorized: 0,
    bodies: [],
  };
  let serial = 0;
  let refuseFrom = Number.POSITIVE_INFINITY;
  const refreshTokens = new Set<string>();
  const accessExpiries = new Map<string, number>();
  const startedAt = Date.now();

  const mint = (): { accessToken: string; refreshToken: string } => {
    serial += 1;
    const exp = Math.ceil((Date.now() + options.ttlSeconds * 1000) / 1000);
    const accessToken = sentinelJwt(exp, serial);
    const refreshToken = `SENTINEL-refresh-${String(serial)}`;
    accessExpiries.set(accessToken, exp * 1000);
    refreshTokens.add(refreshToken);
    return { accessToken, refreshToken };
  };

  const valid = (request: IncomingMessage): string | undefined => {
    const token = request.headers.authorization?.replace('Bearer ', '') ?? '';
    const expiry = accessExpiries.get(token);
    return expiry !== undefined && expiry > Date.now() ? token : undefined;
  };
  const reject = (response: ServerResponse): void => {
    log.unauthorized += 1;
    response.writeHead(401).end('{"message":"Unauthorized"}');
  };
  const readBody = async (request: IncomingMessage): Promise<string> => {
    let text = '';
    for await (const chunk of request) text += String(chunk);
    log.bodies.push(text);
    return text;
  };
  const eventFor = (sequence: number): string => {
    const last = sequence === options.events;
    const frame = last
      ? { type: 'run.completed', sequence, payload: {} }
      : {
          type: 'tool.requested',
          sequence,
          payload: {
            invocationId: `inv.${String(sequence)}`,
            toolName: 'echo',
            operation: 'say',
            invocation: { arguments: {} },
          },
        };
    return `data: ${JSON.stringify(frame)}\n\n`;
  };

  const stream = (request: IncomingMessage, response: ServerResponse, after: number): void => {
    const token = valid(request);
    if (token === undefined) {
      reject(response);
      return;
    }
    log.streamAfters.push(after);
    response.writeHead(200, { 'Content-Type': 'text/event-stream' });
    let next = after + 1;
    const tick = setInterval(() => {
      // Like the backend: the stream ends when the token it was opened with expires.
      if ((accessExpiries.get(token) ?? 0) <= Date.now()) {
        clearInterval(tick);
        response.end();
        return;
      }
      while (next <= options.events && startedAt + next * options.everyMs <= Date.now()) {
        response.write(eventFor(next));
        next += 1;
      }
      if (next > options.events) {
        clearInterval(tick);
        response.end();
      }
    }, 25);
    request.on('close', () => {
      clearInterval(tick);
    });
  };

  const route = async (request: IncomingMessage, response: ServerResponse): Promise<void> => {
    const url = new URL(request.url ?? '/', 'http://x');
    if (url.pathname === '/auth/refresh') {
      const body = JSON.parse(await readBody(request)) as { refreshToken?: string };
      await new Promise((resolve) => setTimeout(resolve, options.refreshDelayMs ?? 0));
      log.refreshes += 1;
      const used = body.refreshToken ?? '';
      if (log.refreshes > refuseFrom || !refreshTokens.delete(used)) {
        // A replayed refresh token is theft to the real backend; here it is just refused.
        response.writeHead(401).end('{"message":"refresh refused"}');
        return;
      }
      const pair = mint();
      response
        .writeHead(200)
        .end(JSON.stringify({ tokens: { ...pair, expiresIn: options.ttlSeconds } }));
      return;
    }
    if (valid(request) === undefined) {
      reject(response);
      return;
    }
    if (url.pathname === '/chat-threads') {
      await readBody(request);
      response.writeHead(200).end('{"id":"thread-1"}');
    } else if (url.pathname === '/chat-messages/runtime/runs') {
      await readBody(request);
      response.writeHead(200).end('{"runId":"run-1","generation":"g1"}');
    } else if (url.pathname.endsWith('/results')) {
      await readBody(request);
      log.results += 1;
      response.writeHead(200).end('{}');
    } else if (url.pathname.startsWith('/chat-messages/stream/')) {
      stream(request, response, Number(url.searchParams.get('after') ?? '-1'));
    } else {
      response.writeHead(404).end();
    }
  };

  const server: Server = createServer((request, response) => {
    void route(request, response);
  });
  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
  const address = server.address();
  const port = typeof address === 'object' && address !== null ? address.port : 0;
  return {
    url: `http://127.0.0.1:${String(port)}`,
    log,
    mint,
    refuseRefreshesFrom: (count) => {
      refuseFrom = count;
    },
    close: () =>
      new Promise<void>((resolve) => {
        server.closeAllConnections();
        server.close(() => {
          resolve();
        });
      }),
  };
}
