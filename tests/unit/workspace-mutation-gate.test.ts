import { describe, expect, it, vi } from 'vitest';

import { WorkspaceMutationGate } from '../../src/core/workspace-mutation-gate';

function deferred(): {
  promise: Promise<void>;
  resolve(): void;
} {
  let resolvePromise: (() => void) | undefined;
  return {
    promise: new Promise<void>((resolve) => {
      resolvePromise = resolve;
    }),
    resolve: () => resolvePromise?.(),
  };
}

describe('WorkspaceMutationGate', () => {
  it('never overlaps workspace operations', async () => {
    const gate = new WorkspaceMutationGate();
    const first = deferred();
    const events: string[] = [];
    const one = gate.runExclusive(new AbortController().signal, async () => {
      events.push('one:start');
      await first.promise;
      events.push('one:end');
    });
    const two = gate.runExclusive(new AbortController().signal, async () => {
      events.push('two:start');
    });

    await vi.waitFor(() => {
      expect(events).toEqual(['one:start']);
    });
    first.resolve();
    await Promise.all([one, two]);
    expect(events).toEqual(['one:start', 'one:end', 'two:start']);
  });

  it('skips an aborted waiter and still releases the following operation', async () => {
    const gate = new WorkspaceMutationGate();
    const first = deferred();
    const events: string[] = [];
    const one = gate.runExclusive(new AbortController().signal, () => first.promise);
    const aborted = new AbortController();
    const two = gate.runExclusive(aborted.signal, async () => {
      events.push('two');
    });
    const three = gate.runExclusive(new AbortController().signal, async () => {
      events.push('three');
    });

    aborted.abort(new Error('cancelled while waiting'));
    first.resolve();

    await expect(two).rejects.toThrow('cancelled while waiting');
    await Promise.all([one, three]);
    expect(events).toEqual(['three']);
  });
});
