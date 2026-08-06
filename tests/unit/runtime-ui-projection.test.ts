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

function template(): RuntimeEvent {
  const first = journal[0];
  if (first === undefined) {
    throw new Error('the captured journal fixture is empty');
  }
  return first;
}

function event(type: string, payload: Record<string, unknown> = {}): RuntimeEvent {
  return { ...template(), type, payload };
}

function harness() {
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
  return { projector, view, logger };
}

describe('runtime UI projection', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('streams every delta to the owning request and finishes with the whole answer', async () => {
    const { projector, view } = harness();
    projector.project(event('model.delta', { text: 'The rules directory ' }));
    projector.project(event('model.delta', { text: 'contains 7 files.' }));
    projector.project(event('run.completed'));
    await projector.settle();

    expect(view.postEvent).toHaveBeenCalledTimes(2);
    expect(view.postEvent).toHaveBeenNthCalledWith(
      1,
      { type: 'CONTENT_DELTA', delta: 'The rules directory ' },
      REQUEST_ID,
    );
    expect(view.postResult).toHaveBeenCalledWith(
      { content: 'The rules directory contains 7 files.' },
      REQUEST_ID,
    );
    expect(view.postError).not.toHaveBeenCalled();
  });

  it('reports a terminal failure with its stable reason instead of leaving the card running', async () => {
    const { projector, view } = harness();
    projector.project(
      event('run.failed', {
        reason: { code: 'CONNECTOR_CONFIG_FETCH_FAILED', message: 'Internal server error' },
      }),
    );
    await projector.settle();

    expect(view.postResult).not.toHaveBeenCalled();
    expect(view.postError).toHaveBeenCalledWith(
      'Internal server error (CONNECTOR_CONFIG_FETCH_FAILED)',
      REQUEST_ID,
    );
  });

  it('still terminalizes when a failure carries no reason', async () => {
    const { projector, view } = harness();
    projector.project(event('run.failed'));
    await projector.settle();

    expect(view.postError).toHaveBeenCalledWith(
      'The ClawAI run failed without a reported reason.',
      REQUEST_ID,
    );
  });

  it('fails loudly when the stream ends without any terminal event', async () => {
    // The run must never be left silently unfinished: the card would keep its
    // placeholder forever once the generation settled and released the binding.
    const { projector, view } = harness();
    projector.project(event('model.delta', { text: 'partial' }));
    await projector.settle();

    expect(view.postResult).not.toHaveBeenCalled();
    expect(view.postError).toHaveBeenCalledWith(
      'The ClawAI run ended without reporting a result.',
      REQUEST_ID,
    );
  });

  it('keeps a cancelled run visible with whatever it had produced', async () => {
    const { projector, view } = harness();
    projector.project(event('model.delta', { text: 'half an answer' }));
    projector.project(event('run.cancelled'));
    await projector.settle();

    expect(view.postResult).toHaveBeenCalledWith(
      { content: 'half an answer\n\nThe ClawAI run was cancelled.' },
      REQUEST_ID,
    );
  });

  it('says so when a run completes without producing an answer', async () => {
    const { projector, view } = harness();
    projector.project(event('run.completed'));
    await projector.settle();

    expect(view.postResult).toHaveBeenCalledWith(
      { content: 'The ClawAI run finished without producing an answer.' },
      REQUEST_ID,
    );
  });

  it('terminalizes exactly once however often it is settled', async () => {
    const { projector, view } = harness();
    projector.project(event('run.completed'));
    await projector.settle();
    await projector.settle();
    await projector.settle();

    expect(view.postResult).toHaveBeenCalledTimes(1);
    expect(view.postError).not.toHaveBeenCalled();
  });

  it('projects a phase change as an activity label and ignores empty deltas', async () => {
    const { projector, view } = harness();
    projector.project(event('phase.changed', { phase: 'Reading workspace' }));
    projector.project(event('model.delta', { text: '' }));
    projector.project(event('model.delta', {}));

    expect(view.postEvent).toHaveBeenCalledTimes(1);
    expect(view.postEvent).toHaveBeenCalledWith(
      { type: 'RUNTIME_PHASE', label: 'Reading workspace', description: '' },
      REQUEST_ID,
    );
  });

  it('shows the tool trail so a working run does not look like a hung one', () => {
    const { projector, view } = harness();
    projector.project(
      event('tool.requested', {
        invocationId: 'invocation_1',
        toolName: 'workspace.files',
        operation: 'list',
      }),
    );
    projector.project(event('tool.started', { invocationId: 'invocation_1' }));
    projector.project(
      event('tool.completed', {
        invocationId: 'invocation_1',
        status: 'succeeded',
        receipt: { durationMs: 42, outputBytes: 1_024 },
      }),
    );

    expect(view.postEvent.mock.calls.map(([envelope]) => envelope)).toEqual([
      { type: 'RUNTIME_PHASE', label: 'workspace.files · list', description: 'Requested' },
      { type: 'RUNTIME_PHASE', label: 'workspace.files · list', description: 'Running' },
      {
        type: 'RUNTIME_PHASE',
        label: 'workspace.files · list',
        description: 'succeeded · 1024 bytes in 42 ms',
      },
    ]);
  });

  it('ignores tool progress for an invocation it never saw requested', () => {
    const { projector, view } = harness();
    projector.project(event('tool.started', { invocationId: 'invocation_unknown' }));

    expect(view.postEvent).not.toHaveBeenCalled();
  });

  it('says when the run is waiting on the person and what they decided', () => {
    // A run blocked on the approval dialog used to show nothing at all, which
    // is exactly what a hang looks like.
    const { projector, view } = harness();
    projector.approval('waiting', 'read target:workspace');
    projector.approval('approved', 'read target:workspace');

    expect(view.postEvent.mock.calls.map(([envelope]) => envelope)).toEqual([
      {
        type: 'RUNTIME_PHASE',
        label: 'Waiting for your approval',
        description: 'read target:workspace',
      },
      {
        type: 'RUNTIME_PHASE',
        label: 'You approved this step',
        description: 'read target:workspace',
      },
    ]);
  });

  it('records a rejected step', () => {
    const { projector, view } = harness();
    projector.approval('rejected', 'write target:workspace');

    expect(view.postEvent).toHaveBeenCalledWith(
      {
        type: 'RUNTIME_PHASE',
        label: 'You rejected this step',
        description: 'write target:workspace',
      },
      REQUEST_ID,
    );
  });

  it('drives the captured journal end to end', async () => {
    const { projector, view } = harness();
    for (const entry of journal) {
      projector.project(entry);
    }
    await projector.settle();

    expect(view.postResult).toHaveBeenCalledWith(
      { content: 'The rules directory contains 7 files.' },
      REQUEST_ID,
    );
  });
});
