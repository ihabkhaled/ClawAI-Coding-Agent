import { describe, expect, it, vi } from 'vitest';

import { BackendSessionExpiredError } from '../../src/backend/backend-errors';
import { SessionRefresher } from '../../src/backend/session-refresher';

describe('SessionRefresher', () => {
  it('shares one rotation between every caller that asks while it is running', async () => {
    let release: (() => void) | undefined;
    const perform = vi.fn(
      async () =>
        new Promise<void>((resolve) => {
          release = resolve;
        }),
    );
    const refresher = new SessionRefresher(perform);

    const callers = [refresher.run(), refresher.run(), refresher.run()];
    await vi.waitFor(() => {
      expect(release).toBeTypeOf('function');
    });
    release?.();
    await Promise.all(callers);

    expect(perform).toHaveBeenCalledOnce();
  });

  it('starts a new rotation once the shared one has settled', async () => {
    const perform = vi.fn(() => Promise.resolve());
    const refresher = new SessionRefresher(perform);

    await refresher.run();
    await refresher.run();

    expect(perform).toHaveBeenCalledTimes(2);
  });

  it('gives every waiter the same failure when the rotation fails', async () => {
    const failure = new Error('Backend unavailable.');
    const perform = vi.fn(() => Promise.reject(failure));
    const refresher = new SessionRefresher(perform);

    const results = await Promise.allSettled([refresher.run(), refresher.run()]);

    expect(results.every((result) => result.status === 'rejected')).toBe(true);
    expect(perform).toHaveBeenCalledOnce();
    expect(refresher.isTerminated()).toBe(false);
  });

  it('never retries the backend once the refresh token itself was rejected', async () => {
    let rejecting: SessionRefresher | null = null;
    const perform = vi.fn((): Promise<void> =>
      Promise.reject(rejecting === null ? new Error('Unbound refresher.') : rejecting.terminate()),
    );
    const refresher = new SessionRefresher(perform);
    rejecting = refresher;

    await expect(refresher.run()).rejects.toBeInstanceOf(BackendSessionExpiredError);
    await expect(refresher.run()).rejects.toBeInstanceOf(BackendSessionExpiredError);
    await expect(refresher.run()).rejects.toBeInstanceOf(BackendSessionExpiredError);

    expect(perform).toHaveBeenCalledOnce();
    expect(refresher.isTerminated()).toBe(true);
  });

  it('reports one terminal error instance to every caller', () => {
    const refresher = new SessionRefresher(() => Promise.resolve());

    expect(refresher.terminate()).toBe(refresher.terminate());
  });

  it('detaches a cancelled caller without abandoning the rotation', async () => {
    let release: (() => void) | undefined;
    const perform = vi.fn(
      async () =>
        new Promise<void>((resolve) => {
          release = resolve;
        }),
    );
    const refresher = new SessionRefresher(perform);
    const controller = new AbortController();
    const cancellation = new Error('Caller cancelled.');

    const cancelled = refresher.run(controller.signal);
    const patient = refresher.run();
    await vi.waitFor(() => {
      expect(release).toBeTypeOf('function');
    });
    controller.abort(cancellation);

    await expect(cancelled).rejects.toBe(cancellation);
    release?.();
    await expect(patient).resolves.toBeUndefined();
    expect(perform).toHaveBeenCalledOnce();
  });

  it('abandons the rotation in flight when the session ends underneath it', async () => {
    const aborts: unknown[] = [];
    const perform = vi.fn(
      async (signal: AbortSignal) =>
        new Promise<void>((_resolve, reject) => {
          signal.addEventListener('abort', () => {
            aborts.push(signal.reason);
            reject(new Error('Rotation abandoned.'));
          });
        }),
    );
    const refresher = new SessionRefresher(perform);
    const ended = new Error('ClawAI session ended.');

    const running = refresher.run();
    await vi.waitFor(() => {
      expect(perform).toHaveBeenCalledOnce();
    });
    refresher.abort(ended);

    await expect(running).rejects.toThrow('Rotation abandoned.');
    expect(aborts).toEqual([ended]);
  });

  it('ignores an abort when no rotation is running', () => {
    const refresher = new SessionRefresher(() => Promise.resolve());

    expect(() => {
      refresher.abort(new Error('Nothing to stop.'));
    }).not.toThrow();
  });
});
