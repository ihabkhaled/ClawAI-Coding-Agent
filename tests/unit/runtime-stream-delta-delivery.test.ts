import { readFileSync } from 'node:fs';

import { describe, expect, it } from 'vitest';

import { RuntimeEventStreamService } from '../../src/services/runtime-event-stream-service';

import type { RuntimeEvent } from '../../src/core/runtime/runtime-protocol.schemas';

/**
 * Replays a REAL run journal, captured from the live backend, through the real
 * stream service.
 *
 * The backend was observed emitting `model.delta` carrying the answer and then
 * `run.completed`, while the UI stayed on its "Reading workspace" placeholder
 * and the run showed as still running. Static reading of the render path found
 * nothing, so this drives the actual client chain with the actual bytes and
 * asserts the two things the UI depends on: that the delta reaches the
 * observer, and that the stream reports the run as terminal.
 */
const journal: RuntimeEvent[] = JSON.parse(
  readFileSync(
    'C:/Users/Ihab/AppData/Local/Temp/claude/d--Freelance-Claw/ceca00cf-cd19-4aab-a766-66b45f5a7175/scratchpad/captured-journal.json',
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

describe('runtime stream delivers the answer a real run produced', () => {
  it('hands every model.delta to the observer and reports the run terminal', async () => {
    const seen: RuntimeEvent[] = [];
    const service = new RuntimeEventStreamService({
      openStream: () => Promise.resolve(sseResponse(journal)),
    } as unknown as ConstructorParameters<typeof RuntimeEventStreamService>[0]);

    const runtime = {
      beginModelTurn: () => undefined,
      dispatch: () => Promise.resolve({}),
    } as unknown as Parameters<RuntimeEventStreamService['follow']>[1];

    await service.follow(
      journal[0]?.runId ?? 'run',
      runtime,
      {
        onEvent: (event: RuntimeEvent) => {
          seen.push(event);
          return Promise.resolve();
        },
      },
      new AbortController().signal,
    );

    const deltas = seen.filter((event) => event.type === 'model.delta');
    expect(deltas.length).toBeGreaterThan(0);
    const text = deltas
      .map((event) => (typeof event.payload.text === 'string' ? event.payload.text : ''))
      .join('');
    expect(text.length).toBeGreaterThan(0);
    expect(seen.at(-1)?.type).toBe('run.completed');
  });
});
