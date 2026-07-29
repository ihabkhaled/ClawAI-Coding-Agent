import { describe, expect, it, vi } from 'vitest';

import { WorkspaceApprovalMemory } from '../../src/core/workspace-approval-memory';

describe('WorkspaceApprovalMemory', () => {
  it('persists routine access globally for the same stable workspace identity', async () => {
    const values = new Map<string, unknown>();
    const globalState = {
      get: (key: string): unknown => values.get(key),
      update: vi.fn(async (key: string, value: unknown) => {
        values.set(key, value);
      }),
    };

    const first = new WorkspaceApprovalMemory(globalState, () => 'workspace-a');
    expect(first.hasRoutineAccess()).toBe(false);

    await first.rememberRoutineAccess();

    const reloaded = new WorkspaceApprovalMemory(globalState, () => 'workspace-a');
    expect(reloaded.hasRoutineAccess()).toBe(true);
    expect(globalState.update).toHaveBeenCalledWith(
      'clawAI.routineAccessApproval.v2.workspace-a',
      true,
    );
  });

  it('does not share approval with another workspace or an unavailable workspace', async () => {
    const values = new Map<string, unknown>();
    const globalState = {
      get: (key: string): unknown => values.get(key),
      update: vi.fn(async (key: string, value: unknown) => {
        values.set(key, value);
      }),
    };
    const approved = new WorkspaceApprovalMemory(globalState, () => 'workspace-a');
    await approved.rememberRoutineAccess();

    expect(new WorkspaceApprovalMemory(globalState, () => 'workspace-b').hasRoutineAccess()).toBe(
      false,
    );
    expect(new WorkspaceApprovalMemory(globalState, () => undefined).hasRoutineAccess()).toBe(
      false,
    );
  });

  it('fails closed when workspace state contains an invalid value', () => {
    const globalState = {
      get: () => ({ approved: 'yes' }),
      update: vi.fn(async () => undefined),
    };

    expect(
      new WorkspaceApprovalMemory(globalState, () => 'workspace-a').hasRoutineAccess(),
    ).toBe(false);
  });
});
