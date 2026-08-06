import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

import { describe, expect, it } from 'vitest';

import { RuntimeEventStreamService } from '../../src/services/runtime-event-stream-service';

import type { RuntimeEvent } from '../../src/core/runtime/runtime-protocol.schemas';

/**
 * Replays a REAL run journal, captured from the live backend and sanitized,
 * through the real stream service.
 *
 * The backend was observed emitting `model.delta` carrying the answer and then
 * `run.completed`, while the UI stayed on its "Reading workspace" placeholder
 * and the run showed as still running. Static reading of the render path found
 * nothing, so this drives the actual client chain with the actual bytes and
 * asserts the two things the UI depends on: that the delta reaches the
 * observer, and that the stream reports the run as terminal.
 *
 * The journal lives in the repository and is resolved relative to this module.
 * It previously came from an absolute path inside one developer's temporary
 * directory, so the test proved nothing in a fresh clone or on CI — it either
 * failed to read or, worse, silently passed on a stale capture.
 */
const journal: RuntimeEvent[] = JSON.parse(
  readFileSync(
    fileURLToPath(
      new URL('../fixtures/journals/runtime-completed-run.journal.json', import.meta.url),
    ),
    'utf8',
  ),
) as RuntimeEvent[];

function sseResponse(events: readonly RuntimeEvent[]): Response {
  const body = new ReadableStream<Uint8Array>({
    start(controller) {
      const encoder = new TextEncoder();
      for (const event of events) {
        controller.enqueue(encoder.encode(`data: ${JSON.stringify(event)}\n\n`));
      }
      controller.close();
    },
  });
  return new Response(body, { status: 200, headers: { 'content-type': 'text/event-stream' } });
}

function follow(events: readonly RuntimeEvent[], seen: RuntimeEvent[]): Promise<void> {
  const service = new RuntimeEventStreamService({
    openStream: () => Promise.resolve(sseResponse(events)),
  } as unknown as ConstructorParameters<typeof RuntimeEventStreamService>[0]);
  const runtime = {
    beginModelTurn: () => undefined,
    dispatch: () => Promise.resolve({}),
  } as unknown as Parameters<RuntimeEventStreamService['follow']>[1];
  return service.follow(
    events[0]?.runId ?? 'run',
    runtime,
    {
      onEvent: (event: RuntimeEvent) => {
        seen.push(event);
        return Promise.resolve();
      },
    },
    new AbortController().signal,
  );
}

describe('runtime stream delivers the answer a real run produced', () => {
  it('carries a portable fixture that a fresh clone can read', () => {
    expect(journal.length).toBeGreaterThan(0);
    expect(journal.map((event) => event.type)).toEqual([
      'run.created',
      'run.claimed',
      'run.provider-dispatched',
      'model.turn.started',
      'model.delta',
      'model.summary',
      'run.completed',
    ]);
  });

  it('hands every model.delta to the observer and reports the run terminal', async () => {
    const seen: RuntimeEvent[] = [];
    await follow(journal, seen);

    const deltas = seen.filter((event) => event.type === 'model.delta');
    expect(deltas.length).toBeGreaterThan(0);
    const text = deltas
      .map((event) => (typeof event.payload.text === 'string' ? event.payload.text : ''))
      .join('');
    expect(text.length).toBeGreaterThan(0);
    expect(seen.at(-1)?.type).toBe('run.completed');
  });

  it('delivers a terminal failure to the observer instead of ending silently', async () => {
    // A failed run reaches the client as an ordinary terminal event: `follow`
    // returns normally rather than throwing. Nothing downstream may treat that
    // as success.
    const terminal = journal.at(-1);
    if (terminal === undefined) {
      throw new Error('the captured journal fixture is empty');
    }
    const failed: RuntimeEvent[] = [
      ...journal.slice(0, 3),
      {
        ...terminal,
        type: 'run.failed',
        sequence: 3,
        payload: { reason: { code: 'CONNECTOR_CONFIG_FETCH_FAILED', message: 'Internal error' } },
      },
    ];
    const seen: RuntimeEvent[] = [];
    await follow(failed, seen);

    expect(seen.at(-1)?.type).toBe('run.failed');
    expect(seen.filter((event) => event.type === 'model.delta')).toHaveLength(0);
  });
});
