import { describe, expect, it, vi } from 'vitest';

import { cancelRunBoundary, transitionRunBoundary } from '../../src/core/run-boundary';

describe('cancelRunBoundary', () => {
  it('cancels queued generations and every pending approval before a workspace changes', () => {
    const generations = { cancelAll: vi.fn() };
    const approvals = { cancelAll: vi.fn() };

    cancelRunBoundary(generations, approvals);

    expect(generations.cancelAll).toHaveBeenCalledOnce();
    expect(approvals.cancelAll).toHaveBeenCalledOnce();
  });

  it('switches local workspace scope before waiting for remote cancellation', async () => {
    const order: string[] = [];
    let finishRemote: (() => void) | undefined;
    const transitioning = transitionRunBoundary(
      { cancelAll: () => order.push('generations') },
      { cancelAll: () => order.push('approvals') },
      () => order.push('scope'),
      () =>
        new Promise<void>((resolve) => {
          order.push('remote');
          finishRemote = resolve;
        }),
    );

    expect(order).toEqual(['generations', 'approvals', 'scope', 'remote']);
    finishRemote?.();
    await transitioning;
  });
});
