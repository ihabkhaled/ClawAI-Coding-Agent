import { describe, expect, it } from 'vitest';

import {
  SafeRuntimeFixtureExecutor,
  safeRuntimeFixtureDefinition,
} from '../../src/infrastructure/safe-runtime-fixture-executor';

const invocation = {
  schemaVersion: '2.0' as const,
  invocationId: 'inv_01JZZZZZZZZZZZZZZZZZZZZZZZ',
  runId: 'run_01JZZZZZZZZZZZZZZZZZZZZZZZ',
  turnId: 'turn_01JZZZZZZZZZZZZZZZZZZZZZZ',
  toolName: 'fixture.workspace-summary',
  toolVersion: '1.0',
  operation: 'read',
  arguments: {},
  targetId: 'target:fixture',
  epochs: { account: 1, workspace: 2, target: 3, policy: 4 },
  idempotencyKey: 'idem_01JZZZZZZZZZZZZZZZZZZZZZZ',
  requestedAt: '2026-08-02T08:00:00.000Z',
};

describe('SafeRuntimeFixtureExecutor', () => {
  it('returns deterministic bounded fixture metadata for its exact read-only definition', async () => {
    const executor = new SafeRuntimeFixtureExecutor({
      documentCount: 3,
      workspaceLabel: 'Fixture',
    });

    await expect(executor.execute(invocation)).resolves.toEqual({
      modelText: 'Fixture workspace summary is ready.',
      structured: { documentCount: 3, workspaceLabel: 'Fixture' },
    });
    expect(safeRuntimeFixtureDefinition).toMatchObject({
      name: 'fixture.workspace-summary',
      operations: ['read'],
      riskClasses: ['inspect'],
    });
  });

  it('denies every unknown target, operation, and definition before producing output', async () => {
    const executor = new SafeRuntimeFixtureExecutor({
      documentCount: 3,
      workspaceLabel: 'Fixture',
    });

    await expect(executor.execute({ ...invocation, operation: 'write' })).rejects.toThrow(
      /fixture/i,
    );
    await expect(executor.execute({ ...invocation, targetId: 'target:other' })).rejects.toThrow(
      /fixture/i,
    );
    await expect(
      executor.execute({ ...invocation, toolName: 'workspace.command' }),
    ).rejects.toThrow(/fixture/i);
    await expect(executor.execute({ ...invocation, toolVersion: '2.0' })).rejects.toThrow(
      /fixture/i,
    );
    await expect(
      executor.execute({ ...invocation, arguments: { section: 'secret' } }),
    ).rejects.toThrow(/fixture/i);
  });

  it('rejects invalid fixtures and respects a pre-cancelled signal', async () => {
    expect(
      () => new SafeRuntimeFixtureExecutor({ documentCount: -1, workspaceLabel: 'Fixture' }),
    ).toThrow(/count/i);
    expect(() => new SafeRuntimeFixtureExecutor({ documentCount: 1, workspaceLabel: ' ' })).toThrow(
      /label/i,
    );
    expect(
      () => new SafeRuntimeFixtureExecutor({ documentCount: 1, workspaceLabel: 'x'.repeat(201) }),
    ).toThrow(/label/i);
    const controller = new AbortController();
    controller.abort(new Error('cancelled'));

    await expect(
      new SafeRuntimeFixtureExecutor({ documentCount: 1, workspaceLabel: 'Fixture' }).execute(
        invocation,
        controller.signal,
      ),
    ).rejects.toThrow(/fixture was cancelled/i);
    const noReasonController = new AbortController();
    noReasonController.abort();
    await expect(
      new SafeRuntimeFixtureExecutor({ documentCount: 1, workspaceLabel: 'Fixture' }).execute(
        invocation,
        noReasonController.signal,
      ),
    ).rejects.toThrow();
    await expect(
      new SafeRuntimeFixtureExecutor({ documentCount: 1, workspaceLabel: 'Fixture' }).execute(
        invocation,
        new AbortController().signal,
      ),
    ).resolves.toMatchObject({ structured: { documentCount: 1 } });
  });
});
