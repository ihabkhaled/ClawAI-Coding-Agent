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
  it('runs two different conversations concurrently and publishes both active summaries', async () => {
    const snapshots: unknown[] = [];
    const first = deferred();
    const second = deferred();
    const started: string[] = [];
    const queue = new GenerationQueue((snapshot) => snapshots.push(snapshot));

    const firstRun = queue.enqueue({
      concurrencyKey: 'chat-a',
      id: 'request-1',
      kind: 'agent',
      modelLabel: 'Claude Sonnet',
      prompt: 'First',
      run: async () => {
        started.push('first');
        await first.promise;
      },
    });
    const secondRun = queue.enqueue({
      concurrencyKey: 'chat-b',
      id: 'request-2',
      kind: 'chat',
      modelLabel: 'Qwen 3',
      prompt: 'Second',
      run: async () => {
        started.push('second');
        await second.promise;
      },
    });

    await vi.waitFor(() => {
      expect(started).toEqual(['first', 'second']);
    });
    expect(queue.snapshot.active.map(({ id }) => id)).toEqual(['request-1', 'request-2']);
    first.resolve();
    second.resolve();
    await Promise.all([firstRun, secondRun]);

    expect(queue.snapshot).toEqual({ active: [], capacity: 2, pending: [] });
    expect(snapshots).toContainEqual({
      active: [
        expect.objectContaining({ id: 'request-1', modelLabel: 'Claude Sonnet' }),
        expect.objectContaining({ id: 'request-2', modelLabel: 'Qwen 3' }),
      ],
      capacity: 2,
      pending: [],
    });
  });

  it('cancels only the active request and can remove queued work', async () => {
    const activeAborted = deferred();
    const queue = new GenerationQueue(() => {
      // No state assertions are needed for this cancellation case.
    });
    const firstRun = queue.enqueue({
      concurrencyKey: 'chat-a',
      id: 'request-1',
      kind: 'agent',
      modelLabel: 'Claude Sonnet',
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
      concurrencyKey: 'chat-a',
      id: 'request-2',
      kind: 'agent',
      modelLabel: 'Claude Sonnet',
      prompt: 'Second',
      run: async () => undefined,
    });

    await vi.waitFor(() => {
      expect(queue.snapshot.active[0]?.id).toBe('request-1');
    });
    expect(queue.remove('request-2')).toBe(true);
    expect(queue.cancelActive()).toBe(true);
    await activeAborted.promise;
    await Promise.all([firstRun, secondRun]);

    expect(queue.snapshot).toEqual({ active: [], capacity: 2, pending: [] });
  });

  it('cancels the active request and drops every queued request for account logout', async () => {
    const activeAborted = deferred();
    let queuedStarted = false;
    const queue = new GenerationQueue(() => undefined);
    const firstRun = queue.enqueue({
      concurrencyKey: 'chat-a',
      id: 'request-1',
      kind: 'agent',
      modelLabel: 'Claude Sonnet',
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
      concurrencyKey: 'chat-a',
      id: 'request-2',
      kind: 'chat',
      modelLabel: 'Qwen 3',
      prompt: 'Private queued prompt',
      run: async () => {
        queuedStarted = true;
      },
    });
    await vi.waitFor(() => {
      expect(queue.snapshot.active[0]?.id).toBe('request-1');
    });

    expect(queue.cancelAll()).toBe(true);
    await activeAborted.promise;
    await Promise.all([firstRun, secondRun]);

    expect(queuedStarted).toBe(false);
    expect(queue.snapshot).toEqual({ active: [], capacity: 2, pending: [] });
  });

  it('rejects excess pending requests without retaining another closure', async () => {
    const active = deferred();
    const queue = new GenerationQueue(() => undefined);
    const running = queue.enqueue({
      concurrencyKey: 'chat-a',
      id: 'active',
      kind: 'agent',
      modelLabel: 'Claude Sonnet',
      prompt: 'Active',
      run: () => active.promise,
    });
    await vi.waitFor(() => {
      expect(queue.snapshot.active[0]?.id).toBe('active');
    });
    const pending = Array.from({ length: MAX_PENDING_GENERATIONS }, (_, index) =>
      queue.enqueue({
        concurrencyKey: 'chat-a',
        id: `pending-${String(index)}`,
        kind: 'chat',
        modelLabel: 'Claude Sonnet',
        prompt: 'Queued',
        run: async () => undefined,
      }),
    );

    await expect(
      queue.enqueue({
        concurrencyKey: 'chat-a',
        id: 'overflow',
        kind: 'chat',
        modelLabel: 'Claude Sonnet',
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
      concurrencyKey: 'chat-a',
      id: 'active',
      kind: 'agent',
      modelLabel: 'Claude Sonnet',
      prompt: 'Active',
      run: () => active.promise,
    });
    await vi.waitFor(() => {
      expect(queue.snapshot.active[0]?.id).toBe('active');
    });
    const chunk = MAX_PENDING_GENERATION_BYTES / 3;
    const pending = Array.from({ length: 3 }, (_, index) =>
      queue.enqueue({
        concurrencyKey: 'chat-a',
        id: `attachment-${String(index)}`,
        kind: 'agent',
        modelLabel: 'Claude Sonnet',
        prompt: 'Queued attachment',
        retainedBytes: chunk,
        run: async () => undefined,
      }),
    );

    await expect(
      queue.enqueue({
        concurrencyKey: 'chat-a',
        id: 'attachment-overflow',
        kind: 'agent',
        modelLabel: 'Claude Sonnet',
        prompt: 'Too many attachments',
        retainedBytes: 1,
        run: async () => undefined,
      }),
    ).rejects.toThrow('queue is full');
    expect(queue.remove('attachment-0')).toBe(true);
    const replacement = queue.enqueue({
      concurrencyKey: 'chat-a',
      id: 'attachment-replacement',
      kind: 'agent',
      modelLabel: 'Claude Sonnet',
      prompt: 'Replacement',
      retainedBytes: 1,
      run: async () => undefined,
    });

    queue.cancelAll();
    active.resolve();
    await Promise.all([running, ...pending, replacement]);
  });

  it('keeps same-conversation requests ordered while another conversation uses the free slot', async () => {
    const first = deferred();
    const second = deferred();
    const started: string[] = [];
    const queue = new GenerationQueue(() => undefined);
    const firstRun = queue.enqueue({
      concurrencyKey: 'chat-a',
      id: 'request-a1',
      kind: 'chat',
      modelLabel: 'Claude Sonnet',
      prompt: 'First A',
      run: async () => {
        started.push('a1');
        await first.promise;
      },
    });
    const followUp = queue.enqueue({
      concurrencyKey: 'chat-a',
      id: 'request-a2',
      kind: 'chat',
      modelLabel: 'Qwen 3',
      prompt: 'Second A',
      run: async () => {
        started.push('a2');
      },
    });
    const otherChat = queue.enqueue({
      concurrencyKey: 'chat-b',
      id: 'request-b1',
      kind: 'chat',
      modelLabel: 'Codex',
      prompt: 'First B',
      run: async () => {
        started.push('b1');
        await second.promise;
      },
    });

    await vi.waitFor(() => {
      expect(started).toEqual(['a1', 'b1']);
    });
    expect(queue.snapshot.pending.map(({ id }) => id)).toEqual(['request-a2']);
    first.resolve();
    await vi.waitFor(() => {
      expect(started).toEqual(['a1', 'b1', 'a2']);
    });
    second.resolve();
    await Promise.all([firstRun, followUp, otherChat]);
  });

  it('waits at capacity and starts the third conversation after one slot settles', async () => {
    const first = deferred();
    const second = deferred();
    const started: string[] = [];
    const queue = new GenerationQueue(() => undefined);
    const one = queue.enqueue({
      concurrencyKey: 'chat-a',
      id: 'request-a',
      kind: 'chat',
      modelLabel: 'Claude Sonnet',
      prompt: 'A',
      run: async () => {
        started.push('a');
        await first.promise;
      },
    });
    const two = queue.enqueue({
      concurrencyKey: 'chat-b',
      id: 'request-b',
      kind: 'chat',
      modelLabel: 'Qwen 3',
      prompt: 'B',
      run: async () => {
        started.push('b');
        await second.promise;
      },
    });
    const three = queue.enqueue({
      concurrencyKey: 'chat-c',
      id: 'request-c',
      kind: 'chat',
      modelLabel: 'Codex',
      prompt: 'C',
      run: async () => {
        started.push('c');
      },
    });

    await vi.waitFor(() => {
      expect(started).toEqual(['a', 'b']);
    });
    expect(queue.snapshot.pending.map(({ id }) => id)).toEqual(['request-c']);
    first.resolve();
    await vi.waitFor(() => {
      expect(started).toEqual(['a', 'b', 'c']);
    });
    second.resolve();
    await Promise.all([one, two, three]);
  });

  it('cancels one active request without aborting the other', async () => {
    const aborted: string[] = [];
    const queue = new GenerationQueue(() => undefined);
    const run = (id: string) => (signal: AbortSignal) =>
      new Promise<void>((resolve) => {
        signal.addEventListener(
          'abort',
          () => {
            aborted.push(id);
            resolve();
          },
          { once: true },
        );
      });
    const one = queue.enqueue({
      concurrencyKey: 'chat-a',
      id: 'request-a',
      kind: 'chat',
      modelLabel: 'Claude Sonnet',
      prompt: 'A',
      run: run('request-a'),
    });
    const two = queue.enqueue({
      concurrencyKey: 'chat-b',
      id: 'request-b',
      kind: 'chat',
      modelLabel: 'Qwen 3',
      prompt: 'B',
      run: run('request-b'),
    });

    await vi.waitFor(() => {
      expect(queue.snapshot.active).toHaveLength(2);
    });
    expect(queue.cancel('request-b')).toBe(true);
    await vi.waitFor(() => {
      expect(aborted).toEqual(['request-b']);
    });
    expect(queue.snapshot.active.map(({ id }) => id)).toEqual(['request-a']);
    expect(queue.cancel('request-a')).toBe(true);
    await Promise.all([one, two]);
  });
});
