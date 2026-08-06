import { describe, expect, it } from 'vitest';

import { ApprovalBroker } from '../../src/core/approval-broker';

describe('ApprovalBroker', () => {
  it('publishes one internal approval at a time and resolves in order', async () => {
    const requests: unknown[] = [];
    const broker = new ApprovalBroker({
      update: (patch) => {
        requests.push(patch.approvalRequest);
      },
    });

    const first = broker.request({
      kind: 'workspaceContext',
      message: 'Read the workspace',
      title: 'Workspace access',
    });
    const firstRequest = broker.current;
    const second = broker.request({
      details: ['src/app.ts'],
      kind: 'finalDiff',
      message: 'Apply one file',
      title: 'Apply changes',
    });

    expect(firstRequest).toMatchObject({ kind: 'workspaceContext' });
    expect(broker.current?.id).toBe(firstRequest?.id);
    expect(broker.resolve(firstRequest?.id ?? '', true)).toBe(true);
    await expect(first).resolves.toBe(true);

    const secondRequest = broker.current;
    expect(secondRequest).toMatchObject({
      details: ['src/app.ts'],
      kind: 'finalDiff',
    });
    expect(broker.resolve(secondRequest?.id ?? '', false)).toBe(true);
    await expect(second).resolves.toBe(false);
    expect(broker.current).toBeUndefined();
    expect(requests.at(-1)).toBeUndefined();
  });

  it('rejects stale responses and cancels the current approval without OS prompts', async () => {
    const broker = new ApprovalBroker({
      update: () => undefined,
    });
    const result = broker.request({
      kind: 'editGeneration',
      message: 'Generate edits',
      title: 'Edit access',
    });

    expect(broker.resolve('stale-request', true)).toBe(false);
    expect(broker.cancelCurrent()).toBe(true);
    await expect(result).resolves.toBe(false);
  });

  it('cancels the active and queued approvals at an account boundary', async () => {
    const broker = new ApprovalBroker({ update: () => undefined });
    const first = broker.request({
      kind: 'finalDiff',
      message: 'Apply changes',
      title: 'Apply',
    });
    const second = broker.request({
      kind: 'commandExecution',
      message: 'Run command',
      title: 'Run',
    });

    expect(broker.cancelAll()).toBe(true);

    await expect(Promise.all([first, second])).resolves.toEqual([false, false]);
    expect(broker.current).toBeUndefined();
  });

  it('removes an aborted run approval and activates the next request', async () => {
    const broker = new ApprovalBroker({ update: () => undefined });
    const controller = new AbortController();
    const first = broker.request(
      {
        kind: 'workspaceContext',
        message: 'Read files for request A',
        title: 'Workspace access',
      },
      controller.signal,
    );
    const second = broker.request({
      kind: 'workspaceContext',
      message: 'Read files for request B',
      title: 'Workspace access',
    });

    controller.abort();

    await expect(first).resolves.toBe(false);
    expect(broker.current?.message).toBe('Read files for request B');
    broker.cancelAll();
    await expect(second).resolves.toBe(false);
  });
  it('withdraws one lane of questions and leaves another lane standing', async () => {
    // A runtime run that ends cannot hear the answer to what it was asking, and
    // an unanswerable modal swallows every click meant for the composer — the
    // user cannot type again until the window is reloaded. Withdrawing by kind
    // clears the dead run's prompts without denying a question another lane is
    // still legitimately waiting on.
    const broker = new ApprovalBroker({ update: () => undefined });

    const runtimeEffect = broker.request({
      kind: 'runtimeEffect',
      message: 'Write one file',
      title: 'Approve agent effect',
    });
    const queuedEffect = broker.request({
      kind: 'runtimeEffect',
      message: 'Write another file',
      title: 'Approve agent effect',
    });
    const otherLane = broker.request({
      kind: 'finalDiff',
      message: 'Apply one file',
      title: 'Apply changes',
    });

    expect(broker.cancelKind('runtimeEffect')).toBe(true);

    await expect(runtimeEffect).resolves.toBe(false);
    await expect(queuedEffect).resolves.toBe(false);
    expect(broker.current).toMatchObject({ kind: 'finalDiff' });
    expect(broker.resolve(broker.current?.id ?? '', true)).toBe(true);
    await expect(otherLane).resolves.toBe(true);
  });

  it('reports nothing to withdraw when that lane has no questions open', () => {
    const broker = new ApprovalBroker({ update: () => undefined });

    expect(broker.cancelKind('runtimeEffect')).toBe(false);
  });
});
