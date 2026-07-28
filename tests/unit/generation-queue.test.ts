import { describe, expect, it, vi } from 'vitest';

import { GenerationQueue } from '../../src/core/generation-queue';

function deferred(): {
  promise: Promise<void>;
  resolve(): void;
} {
  let resolvePromise: (() => void) | undefined;
  const promise = new Promise<void>((resolve) => {
    resolvePromise = resolve;
  });
  return {
    promise,
    resolve: () => resolvePromise?.(),
  };
}

describe('GenerationQueue', () => {
  it('runs requests serially and publishes active and queued summaries', async () => {
    const snapshots: unknown[] = [];
    const first = deferred();
    const order: string[] = [];
    const queue = new GenerationQueue((snapshot) => snapshots.push(snapshot));

    const firstRun = queue.enqueue({
      id: 'request-1',
      kind: 'agent',
      prompt: 'First',
      run: async () => {
        order.push('first:start');
        await first.promise;
        order.push('first:end');
      },
    });
    const secondRun = queue.enqueue({
      id: 'request-2',
      kind: 'chat',
      prompt: 'Second',
      run: async () => {
        order.push('second');
      },
    });

    await vi.waitFor(() => {
      expect(queue.snapshot).toMatchObject({
        active: { id: 'request-1' },
        pending: [{ id: 'request-2' }],
      });
    });
    first.resolve();
    await Promise.all([firstRun, secondRun]);

    expect(order).toEqual(['first:start', 'first:end', 'second']);
    expect(queue.snapshot).toEqual({ active: undefined, pending: [] });
    expect(snapshots).toContainEqual({
      active: expect.objectContaining({ id: 'request-1' }),
      pending: [expect.objectContaining({ id: 'request-2' })],
    });
  });

  it('cancels only the active request and can remove queued work', async () => {
    const activeAborted = deferred();
    const queue = new GenerationQueue(() => {
      // No state assertions are needed for this cancellation case.
    });
    const firstRun = queue.enqueue({
      id: 'request-1',
      kind: 'agent',
      prompt: 'First',
      run: async (signal) => {
        await new Promise<void>((resolve) => {
          signal.addEventListener(
            'abort',
            () => {
              activeAborted.resolve();
              resolve();
            },
            { once: true },
          );
        });
      },
    });
    const secondRun = queue.enqueue({
      id: 'request-2',
      kind: 'agent',
      prompt: 'Second',
      run: async () => undefined,
    });

    await vi.waitFor(() => {
      expect(queue.snapshot.active?.id).toBe('request-1');
    });
    expect(queue.remove('request-2')).toBe(true);
    expect(queue.cancelActive()).toBe(true);
    await activeAborted.promise;
    await Promise.all([firstRun, secondRun]);

    expect(queue.snapshot).toEqual({ active: undefined, pending: [] });
  });
});
