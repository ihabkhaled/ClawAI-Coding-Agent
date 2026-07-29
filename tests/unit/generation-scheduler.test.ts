import { describe, expect, it, vi } from 'vitest';

import { MAX_PENDING_GENERATION_BYTES } from '../../src/core/generation-queue';
import { GenerationScheduler } from '../../src/services/generation-scheduler';

function harness() {
  const hooks = {
    after: vi.fn(async () => undefined),
    before: vi.fn(async () => undefined),
    failed: vi.fn(async () => undefined),
    dropped: vi.fn(),
    queueChanged: vi.fn(),
    settled: vi.fn(),
  };
  return { hooks, scheduler: new GenerationScheduler(hooks) };
}

describe('GenerationScheduler', () => {
  it('settles a caller-cancelled request without reporting a false generation failure', async () => {
    const subject = harness();
    let started: (() => void) | undefined;
    const running = new Promise<void>((resolve) => {
      started = resolve;
    });
    const completion = subject.scheduler.enqueue('request-1', 'compare', 'Compare', (signal) => {
      started?.();
      return new Promise((_resolve, reject) => {
        signal.addEventListener(
          'abort',
          () => {
            reject(new Error('request aborted'));
          },
          { once: true },
        );
      });
    });
    await running;

    expect(subject.scheduler.cancelActive()).toBe(true);
    await completion;

    expect(subject.hooks.failed).not.toHaveBeenCalled();
    expect(subject.hooks.after).not.toHaveBeenCalled();
    expect(subject.hooks.settled).toHaveBeenCalledWith('request-1');
  });

  it('still reports genuine failures', async () => {
    const subject = harness();
    const failure = new Error('provider failed');

    await subject.scheduler.enqueue('request-1', 'chat', 'Hello', async () => {
      throw failure;
    });

    expect(subject.hooks.failed).toHaveBeenCalledWith(failure, 'request-1');
  });

  it('awaits remote failure recovery before starting the next queued request', async () => {
    const events: string[] = [];
    let finishRecovery: (() => void) | undefined;
    const recovery = new Promise<void>((resolve) => {
      finishRecovery = resolve;
    });
    const hooks = {
      after: vi.fn(async () => undefined),
      before: vi.fn(async () => undefined),
      dropped: vi.fn(),
      failed: vi.fn(async () => {
        events.push('cancel:start');
        await recovery;
        events.push('cancel:end');
      }),
      queueChanged: vi.fn(),
      settled: vi.fn(),
    };
    const scheduler = new GenerationScheduler(hooks);
    const failed = scheduler.enqueue('request-1', 'chat', 'First', async () => {
      events.push('first');
      throw new Error('stream disconnected');
    });
    const retry = scheduler.enqueue('request-2', 'chat', 'Retry', async () => {
      events.push('retry');
    });

    await vi.waitFor(() => {
      expect(events).toEqual(['first', 'cancel:start']);
    });
    finishRecovery?.();
    await Promise.all([failed, retry]);

    expect(events).toEqual(['first', 'cancel:start', 'cancel:end', 'retry']);
  });

  it('settles pending requests removed before execution exactly once', async () => {
    const subject = harness();
    let finishActive: (() => void) | undefined;
    const active = subject.scheduler.enqueue(
      'request-1',
      'chat',
      'First',
      () =>
        new Promise<void>((resolve) => {
          finishActive = resolve;
        }),
    );
    const pending = subject.scheduler.enqueue('request-2', 'chat', 'Second', async () => undefined);
    await vi.waitFor(() => {
      expect(finishActive).toBeTypeOf('function');
    });

    expect(subject.scheduler.remove('request-2')).toBe(true);
    await pending;
    expect(subject.hooks.settled).toHaveBeenCalledTimes(1);
    expect(subject.hooks.settled).toHaveBeenCalledWith('request-2');
    expect(subject.hooks.dropped).toHaveBeenCalledWith('request-2');

    finishActive?.();
    await active;
    expect(subject.hooks.settled).toHaveBeenCalledTimes(2);
    expect(subject.hooks.settled).toHaveBeenLastCalledWith('request-1');
  });

  it('settles ownership when a unique request is rejected before queue admission', async () => {
    const subject = harness();
    let finishActive: (() => void) | undefined;
    const active = subject.scheduler.enqueue(
      'active',
      'agent',
      'Active',
      () =>
        new Promise<void>((resolve) => {
          finishActive = resolve;
        }),
    );
    await vi.waitFor(() => {
      expect(finishActive).toBeTypeOf('function');
    });
    const chunk = MAX_PENDING_GENERATION_BYTES / 3;
    const pending = Array.from({ length: 3 }, (_, index) =>
      subject.scheduler.enqueue(
        `pending-${String(index)}`,
        'agent',
        'Queued',
        async () => undefined,
        chunk,
      ),
    );

    await expect(
      subject.scheduler.enqueue('overflow', 'agent', 'Overflow', async () => undefined, 1),
    ).rejects.toThrow('queue is full');
    expect(subject.hooks.settled).toHaveBeenCalledWith('overflow');

    subject.scheduler.cancelAll();
    finishActive?.();
    await Promise.all([active, ...pending]);
  });
});
