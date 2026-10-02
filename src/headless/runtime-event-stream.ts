import { HEADLESS_TERMINAL_EVENTS } from './headless-session.constants';
import { Retrier } from './retry-policy';
import { STREAM_ERROR_EVENT_TYPE, STREAM_UNAVAILABLE_CODE } from './retry-policy.constants';
import { RuntimeHttpError } from './runtime-http-error';

import type { HeadlessStreamEvent } from './headless-session.types';
import type { RetryContext } from './retry-policy.types';
import type { StreamAuth } from './token-session.types';

interface StreamRequest {
  readonly baseUrl: string;
  readonly token: string;
  readonly run: { runId: string; generation: string; threadId: string };
  readonly signal?: AbortSignal | undefined;
  readonly retry: RetryContext;
  /** When present the token is asked for on every connect and the stream is rotated before it expires. */
  readonly auth?: StreamAuth | undefined;
}

interface ParsedFrame {
  readonly event: HeadlessStreamEvent;
  readonly sequence?: number;
  /** The `code` the runtime puts on a `stream.error` frame. */
  readonly failureCode?: string;
}

/**
 * The run's events, one at a time, surviving a runtime that goes away.
 *
 * A dropped connection, a refused one and a `stream.error` saying the runtime's
 * state is unavailable all reconnect from the last sequence number seen, so the
 * events already handled are never handed over twice — a repeated
 * `tool.requested` would run a tool twice. A stream that closes without a
 * terminal event reconnects too, but only if it delivered something since the
 * last connect: a run that is genuinely over, and answers with nothing, ends
 * the loop rather than spinning.
 *
 * Frames are reassembled across chunk boundaries because a server-sent event
 * is not guaranteed to arrive whole, and a half-parsed frame is silently
 * dropped rather than reported, which is how a run appears to end on nothing.
 */
export async function* readRuntimeEvents(
  request: StreamRequest,
): AsyncGenerator<HeadlessStreamEvent> {
  const retrier = new Retrier(request.retry);
  const cursor: Cursor = { last: -1, events: 0, ended: false, renewed: false };
  for (;;) {
    const before = cursor.events;
    let failure: unknown = new StreamClosedError();
    const connection = new Connection(request);
    try {
      yield* framesOf(request, connection, cursor, retrier);
      if (cursor.ended || (cursor.events === before && !connection.rotated)) return;
    } catch (error) {
      failure = error;
      if (await shouldRenew(request, error, connection, cursor)) continue;
    } finally {
      connection.close();
    }
    // The connection was cut on purpose to move to a fresh token: reconnect at once.
    if (connection.rotated && request.signal?.aborted !== true) continue;
    await retrier.backoff(failure);
  }
}

/** Where the stream is up to; shared across reconnects so none replays an event. */
interface Cursor {
  last: number;
  /** How many events were handed over, across every connection. */
  events: number;
  ended: boolean;
  /** A 401 was already answered by renewing; a second one in a row is final. */
  renewed: boolean;
}

async function* framesOf(
  request: StreamRequest,
  connection: Connection,
  cursor: Cursor,
  retrier: Retrier,
): AsyncGenerator<HeadlessStreamEvent> {
  const token = await connection.open();
  for await (const frame of connectedFrames(
    request,
    token,
    connection.signal,
    Math.max(cursor.last, 0),
  )) {
    if (frame.sequence !== undefined && frame.sequence <= cursor.last) continue;
    if (frame.failureCode === STREAM_UNAVAILABLE_CODE) {
      throw new RuntimeHttpError('Event stream', 503, frame.failureCode);
    }
    cursor.events += 1;
    cursor.renewed = false;
    retrier.reset();
    cursor.last = frame.sequence ?? cursor.last;
    yield frame.event;
    if (HEADLESS_TERMINAL_EVENTS.includes(frame.event.type)) {
      cursor.ended = true;
      return;
    }
  }
}

/** A 401 with a refresh token to hand: renew once and reconnect from the same cursor. */
async function shouldRenew(
  request: StreamRequest,
  error: unknown,
  connection: Connection,
  cursor: Cursor,
): Promise<boolean> {
  if (request.auth === undefined || cursor.renewed || connection.rotated) return false;
  if (request.signal?.aborted === true) return false;
  if (!(error instanceof RuntimeHttpError) || error.status !== 401) return false;
  await request.auth.renewAfterRejection(connection.token);
  cursor.renewed = true;
  return true;
}

/**
 * One connection's token and its rotation timer.
 *
 * A token past about 80% of its life is rotated and the connection closed
 * deliberately, because the backend ends the stream when the token it was
 * opened with expires. The caller reconnects with the next token and the same
 * cursor, so rotation costs nothing in events.
 */
class Connection {
  rotated = false;
  token: string;
  readonly signal: AbortSignal;
  private readonly controller = new AbortController();
  private timer: ReturnType<typeof setTimeout> | undefined;

  constructor(private readonly request: StreamRequest) {
    this.token = request.token;
    this.signal =
      request.signal === undefined
        ? this.controller.signal
        : AbortSignal.any([request.signal, this.controller.signal]);
  }

  async open(): Promise<string> {
    const { auth } = this.request;
    if (auth === undefined) return this.token;
    this.token = await auth.token();
    const delay = auth.msUntilRotation();
    if (delay !== undefined) {
      this.timer = setTimeout(() => {
        void this.rotate(auth);
      }, delay);
      this.timer.unref();
    }
    return this.token;
  }

  close(): void {
    if (this.timer !== undefined) clearTimeout(this.timer);
  }

  private async rotate(auth: StreamAuth): Promise<void> {
    try {
      // Rotates only if nobody else already has; either way this connection's token is stale.
      await auth.renewAfterRejection(this.token);
    } catch {
      // The old token still works until it expires; a refused refresh surfaces on the next request.
      return;
    }
    this.rotated = true;
    this.controller.abort();
  }
}

/** A stream that ended without a terminal event; retried as a dropped connection. */
class StreamClosedError extends Error {
  readonly code = 'ECONNRESET';
  constructor() {
    super(`Event stream closed before the run ended`);
    this.name = 'StreamClosedError';
  }
}

async function* connectedFrames(
  request: StreamRequest,
  token: string,
  signal: AbortSignal,
  after: number,
): AsyncGenerator<ParsedFrame> {
  const query = new URLSearchParams({
    protocol: 'v2',
    runId: request.run.runId,
    generation: request.run.generation,
    after: String(after),
  });
  const response = await fetch(
    `${request.baseUrl}/chat-messages/stream/${encodeURIComponent(request.run.threadId)}?${query.toString()}`,
    {
      headers: { Authorization: `Bearer ${token}`, Accept: 'text/event-stream' },
      signal,
    },
  );
  if (!response.ok || response.body === null) {
    const body = response.ok ? '' : await response.text().catch(() => '');
    throw RuntimeHttpError.fromResponse('Event stream', response, body);
  }
  const decoder = new TextDecoder();
  let buffer = '';
  for await (const chunk of streamChunks(response.body)) {
    buffer += decoder.decode(chunk, { stream: true });
    const frames = buffer.split('\n\n');
    buffer = frames.pop() ?? '';
    for (const text of frames) {
      const frame = parseFrame(text);
      if (frame !== undefined) yield frame;
    }
  }
}

async function* streamChunks(body: ReadableStream<Uint8Array>): AsyncGenerator<Uint8Array> {
  const reader = body.getReader();
  try {
    for (;;) {
      const { done, value } = await reader.read();
      if (done) return;
      yield value;
    }
  } finally {
    reader.releaseLock();
  }
}

function parseFrame(frame: string): ParsedFrame | undefined {
  const line = frame.split('\n').find((candidate) => candidate.startsWith('data:'));
  if (line === undefined) return undefined;
  try {
    const parsed: unknown = JSON.parse(line.slice(5).trim());
    if (!isRecord(parsed)) return undefined;
    const { payload, sequence, code } = parsed;
    const type = parsed.type;
    if (typeof type !== 'string') return undefined;
    return {
      event: { type, ...(isRecord(payload) ? { payload } : {}) },
      ...(typeof sequence === 'number' ? { sequence } : {}),
      ...(type === STREAM_ERROR_EVENT_TYPE && typeof code === 'string'
        ? { failureCode: code }
        : {}),
    };
  } catch {
    return undefined;
  }
}

function isRecord(value: unknown): value is Readonly<Record<string, unknown>> {
  return value !== null && typeof value === 'object' && !Array.isArray(value);
}
