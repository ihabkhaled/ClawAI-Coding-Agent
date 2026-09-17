import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

import { beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('vscode', () => ({
  l10n: {
    t: (message: string, ...values: (number | string)[]) =>
      values.reduce<string>(
        (result, value, index) => result.replace(`{${String(index)}}`, String(value)),
        message,
      ),
  },
}));

import { RuntimeUiProjector } from '../../src/services/runtime-ui-projection';
import { RUNTIME_PHASE_EVENTS } from '../../src/services/runtime-ui-projection.constants';

import type { RuntimeEvent } from '../../src/core/runtime/runtime-protocol.schemas';
import type { OutputLogger } from '../../src/infrastructure/output-logger';
import type { ChatViewProvider } from '../../src/webview/chat-view-provider';

const REQUEST_ID = '1c2f7f0e-6a2b-4d1e-9f0a-2b8c4d6e8f01';

const journal: RuntimeEvent[] = JSON.parse(
  readFileSync(
    fileURLToPath(
      new URL('../fixtures/journals/runtime-completed-run.journal.json', import.meta.url),
    ),
    'utf8',
  ),
) as RuntimeEvent[];

function event(type: string, payload: Record<string, unknown> = {}): RuntimeEvent {
  const [first] = journal;
  if (first === undefined) throw new Error('the captured journal fixture is empty');
  return { ...first, type, payload };
}

function harness(): {
  projector: RuntimeUiProjector;
  view: { postEvent: ReturnType<typeof vi.fn> };
} {
  const view = {
    postEvent: vi.fn().mockResolvedValue(undefined),
    postResult: vi.fn().mockResolvedValue(undefined),
    postError: vi.fn().mockResolvedValue(undefined),
  };
  const logger = { info: vi.fn(), warn: vi.fn(), error: vi.fn() };
  const projector = new RuntimeUiProjector(
    () => view as unknown as ChatViewProvider,
    logger as unknown as OutputLogger,
    REQUEST_ID,
  );
  return { projector, view };
}

/**
 * What the panel says between tool calls.
 *
 * A run is mostly not tool calls. Without these the panel goes quiet from one
 * call to the next, and a person watching cannot tell the model thinking from
 * the run having stalled.
 */
describe('runtime narration', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('answers to the phase event the protocol actually emits, under both names', () => {
    // The projection used to check `phase.changed`, a name that exists
    // nowhere, so no phase ever reached the panel — and the test asserted the
    // same wrong name, so nothing failed.
    for (const type of RUNTIME_PHASE_EVENTS) {
      const { projector, view } = harness();

      projector.project(event(type, { phase: 'Reading workspace' }));

      expect(view.postEvent).toHaveBeenCalledWith(
        { type: 'RUNTIME_PHASE', label: 'Reading workspace', description: '' },
        REQUEST_ID,
      );
    }
  });

  it('says the model is thinking when a turn starts', () => {
    const { projector, view } = harness();

    projector.project(event('model.turn.started', { turnId: 'turn-0001' }));

    expect(view.postEvent).toHaveBeenCalledWith(
      { type: 'RUNTIME_PHASE', label: 'Thinking', description: '' },
      REQUEST_ID,
    );
  });

  it("shows the model's own summary of what it did", () => {
    const { projector, view } = harness();

    projector.project(
      event('model.summary', { summary: 'Rewrote the parser', turnId: 'turn-0001' }),
    );

    expect(view.postEvent).toHaveBeenCalledWith(
      { type: 'RUNTIME_PHASE', label: 'Summary', description: 'Rewrote the parser' },
      REQUEST_ID,
    );
  });

  it('confirms when a message typed mid-run was taken into account', () => {
    const { projector, view } = harness();

    projector.project(event('run.steering.applied', { steeringId: 'steer-0001', sequence: 1 }));

    expect(view.postEvent).toHaveBeenCalledWith(
      expect.objectContaining({ label: 'Your message was taken into account' }),
      REQUEST_ID,
    );
  });

  it('says why a message typed mid-run was refused', () => {
    // "Too late" and "the run already ended" are different things to someone
    // who just typed something and is waiting to see whether it landed.
    const { projector, view } = harness();

    projector.project(
      event('run.steering.rejected', {
        steeringId: 'steer-0001',
        sequence: 1,
        reason: 'run-terminal',
      }),
    );

    expect(view.postEvent).toHaveBeenCalledWith(
      {
        type: 'RUNTIME_PHASE',
        label: 'Your message arrived too late',
        description: 'run-terminal',
      },
      REQUEST_ID,
    );
  });

  it('stays silent on an event it has nothing to say about', () => {
    // Narration is not noise. An event with no meaning for a reader should
    // produce no line at all rather than an empty one.
    const { projector, view } = harness();

    projector.project(event('run.claimed', {}));

    expect(view.postEvent).not.toHaveBeenCalled();
  });
});
