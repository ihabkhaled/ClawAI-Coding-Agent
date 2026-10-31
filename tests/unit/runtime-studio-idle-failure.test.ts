import { createHash } from 'node:crypto';

import { describe, expect, it, vi } from 'vitest';

import { RuntimeStreamIdleError } from '../../src/core/runtime/runtime-stream-idle';
import { executeRuntimeStudio } from '../../src/services/runtime-studio-execution';

import type { RuntimeEvent } from '../../src/core/runtime/runtime-protocol.schemas';
import type { RuntimeRunService } from '../../src/services/runtime-run-service';

vi.mock('vscode', () => ({ l10n: { t: (message: string) => message } }));

function digest(value: string): string {
  return `sha256:${createHash('sha256').update(value, 'utf8').digest('hex')}`;
}

type Follow = (runtime: RuntimeRunService) => Promise<void>;

function setup(follow: Follow) {
  const panel: RuntimeEvent[] = [];
  const applied: RuntimeEvent[] = [];
  const cancel = vi.fn(() => Promise.resolve());
  const dependencies = {
    input: {
      prompt: 'add a test',
      threadId: 'thread-1',
      requestId: '5b1d0f0e-6b0a-4a1e-9c1a-2f3d4e5a6b7c',
      signal: new AbortController().signal,
      onEvent: (event: RuntimeEvent) => panel.push(event),
    },
    manifest: { capabilities: [] },
    epochs: { account: 1, workspace: 1, target: 1, policy: 1 },
    router: { definitions: () => [] },
    policy: {},
    transport: {
      cancel,
      start: () => Promise.resolve({ runId: 'runtime:captured' }),
      submitResult: () => Promise.resolve(undefined),
    },
    stream: { follow: (_id: string, runtime: RuntimeRunService) => follow(runtime) },
    observability: { emit: () => undefined, emitUsage: () => undefined },
    journals: { save: () => Promise.resolve(undefined) },
    flagship: { steerIfActive: () => undefined },
    state: {
      snapshot: { runtime: { runs: {} } },
      applyRuntimeEvent: (event: RuntimeEvent) => applied.push(event),
    },
    configuration: () => ({ effortMode: 'ULTRA', agentMode: 'AUTO', permissionMode: 'ASK' }),
    targetRouter: () => ({}),
    fingerprint: () =>
      Promise.resolve({
        account: digest('account'),
        workspace: digest('workspace'),
        target: digest('target'),
        policy: digest('policy'),
        files: digest('files'),
        gitHead: digest('gitHead'),
      }),
    hash: (value: unknown) => digest(JSON.stringify(value)),
    setActive: () => undefined,
    releaseApprovals: () => undefined,
  };
  return { dependencies, panel, applied, cancel };
}

const types = (events: readonly RuntimeEvent[]): string[] => events.map((event) => event.type);

describe('runtime studio idle failure', () => {
  it('ends an idle run as one run.failed and keeps run.cancelled off the panel', async () => {
    const { dependencies, panel, applied, cancel } = setup(() =>
      Promise.reject(new RuntimeStreamIdleError(600_000)),
    );

    await expect(executeRuntimeStudio(dependencies as never)).rejects.toThrow(
      'The run stopped responding',
    );

    expect(types(panel)).toEqual(['run.failed']);
    expect(panel[0]?.payload).toEqual({
      reason: { code: 'RUNTIME_STREAM_IDLE', message: 'The run stopped responding' },
    });
    expect(types(applied)).toEqual(['run.failed']);
    expect(cancel).toHaveBeenCalledTimes(1);
    expect(cancel).toHaveBeenCalledWith('runtime:captured');
  });

  it('still publishes run.cancelled when the user cancels', async () => {
    const { dependencies, panel, cancel } = setup((runtime) => runtime.cancel());

    await executeRuntimeStudio(dependencies as never);

    expect(types(panel)).toEqual(['run.cancelled']);
    expect(cancel).toHaveBeenCalledTimes(1);
  });

  it('cancels the backend run when the stream fails for another reason', async () => {
    const { dependencies, panel, cancel } = setup(() => Promise.reject(new Error('boom')));

    await expect(executeRuntimeStudio(dependencies as never)).rejects.toThrow('boom');

    expect(types(panel)).toEqual(['run.cancelled']);
    expect(cancel).toHaveBeenCalledTimes(1);
  });
});
