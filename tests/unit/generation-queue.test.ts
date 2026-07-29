import { describe, expect, it, vi } from 'vitest';

import {
  GenerationQueue,
  MAX_PENDING_GENERATION_BYTES,
  MAX_PENDING_GENERATIONS,
} from '../../src/core/generation-queue';

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

  it('cancels the active request and drops every queued request for account logout', async () => {
    const activeAborted = deferred();
    let queuedStarted = false;
    const queue = new GenerationQueue(() => undefined);
    const firstRun = queue.enqueue({
      id: 'request-1',
      kind: 'agent',
      prompt: 'First',
      run: (signal) =>
        new Promise<void>((resolve) => {
          signal.addEventListener(
            'abort',
            () => {
              activeAborted.resolve();
              resolve();
            },
            { once: true },
          );
        }),
    });
    const secondRun = queue.enqueue({
      id: 'request-2',
      kind: 'chat',
      prompt: 'Private queued prompt',
      run: async () => {
        queuedStarted = true;
      },
    });
    await vi.waitFor(() => {
      expect(queue.snapshot.active?.id).toBe('request-1');
    });

    expect(queue.cancelAll()).toBe(true);
    await activeAborted.promise;
    await Promise.all([firstRun, secondRun]);

    expect(queuedStarted).toBe(false);
    expect(queue.snapshot).toEqual({ active: undefined, pending: [] });
  });

  it('rejects excess pending requests without retaining another closure', async () => {
    const active = deferred();
    const queue = new GenerationQueue(() => undefined);
    const running = queue.enqueue({
      id: 'active',
      kind: 'agent',
      prompt: 'Active',
      run: () => active.promise,
    });
    await vi.waitFor(() => {
      expect(queue.snapshot.active?.id).toBe('active');
    });
    const pending = Array.from({ length: MAX_PENDING_GENERATIONS }, (_, index) =>
      queue.enqueue({
        id: `pending-${String(index)}`,
        kind: 'chat',
        prompt: 'Queued',
        run: async () => undefined,
      }),
    );

    await expect(
      queue.enqueue({
        id: 'overflow',
        kind: 'chat',
        prompt: 'Overflow',
        run: async () => undefined,
      }),
    ).rejects.toThrow('queue is full');
    expect(queue.snapshot.pending).toHaveLength(MAX_PENDING_GENERATIONS);

    queue.cancelAll();
    active.resolve();
    await Promise.all([running, ...pending]);
  });

  it('bounds aggregate bytes retained by queued attachment snapshots', async () => {
    const active = deferred();
    const queue = new GenerationQueue(() => undefined);
    const running = queue.enqueue({
      id: 'active',
      kind: 'agent',
      prompt: 'Active',
      run: () => active.promise,
    });
    await vi.waitFor(() => {
      expect(queue.snapshot.active?.id).toBe('active');
    });
    const chunk = MAX_PENDING_GENERATION_BYTES / 3;
    const pending = Array.from({ length: 3 }, (_, index) =>
      queue.enqueue({
        id: `attachment-${String(index)}`,
        kind: 'agent',
        prompt: 'Queued attachment',
        retainedBytes: chunk,
        run: async () => undefined,
      }),
    );

    await expect(
      queue.enqueue({
        id: 'attachment-overflow',
        kind: 'agent',
        prompt: 'Too many attachments',
        retainedBytes: 1,
        run: async () => undefined,
      }),
    ).rejects.toThrow('queue is full');
    expect(queue.remove('attachment-0')).toBe(true);
    const replacement = queue.enqueue({
      id: 'attachment-replacement',
      kind: 'agent',
      prompt: 'Replacement',
      retainedBytes: 1,
      run: async () => undefined,
    });

    queue.cancelAll();
    active.resolve();
    await Promise.all([running, ...pending, replacement]);
  });
});
