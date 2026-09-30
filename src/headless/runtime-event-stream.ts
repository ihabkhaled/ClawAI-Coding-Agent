import { HEADLESS_TERMINAL_EVENTS } from './headless-session.constants';
import { Retrier } from './retry-policy';
import { STREAM_ERROR_EVENT_TYPE, STREAM_UNAVAILABLE_CODE } from './retry-policy.constants';
import { RuntimeHttpError } from './runtime-http-error';

import type { HeadlessStreamEvent } from './headless-session.types';
import type { RetryContext } from './retry-policy.types';

interface StreamRequest {
  readonly baseUrl: string;
  readonly token: string;
  readonly run: { runId: string; generation: string; threadId: string };
  readonly signal?: AbortSignal | undefined;
  readonly retry: RetryContext;
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
  let lastSequence = -1;
  for (;;) {
    let delivered = false;
    let failure: unknown = new StreamClosedError();
    try {
      for await (const frame of connectedFrames(request, Math.max(lastSequence, 0))) {
        if (frame.sequence !== undefined && frame.sequence <= lastSequence) continue;
        if (frame.failureCode === STREAM_UNAVAILABLE_CODE) {
          throw new RuntimeHttpError('Event stream', 503, frame.failureCode);
        }
        delivered = true;
        retrier.reset();
        lastSequence = frame.sequence ?? lastSequence;
        yield frame.event;
        if (HEADLESS_TERMINAL_EVENTS.includes(frame.event.type)) return;
      }
      if (!delivered) return;
    } catch (error) {
      failure = error;
    }
    await retrier.backoff(failure);
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
      headers: { Authorization: `Bearer ${request.token}`, Accept: 'text/event-stream' },
      ...(request.signal === undefined ? {} : { signal: request.signal }),
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
