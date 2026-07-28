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
});
