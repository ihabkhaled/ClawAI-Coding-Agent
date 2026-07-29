import { describe, expect, it, vi } from 'vitest';

import { WorkspaceApprovalMemory } from '../../src/core/workspace-approval-memory';

describe('WorkspaceApprovalMemory', () => {
  it('persists routine access in workspace state across service instances', async () => {
    const values = new Map<string, unknown>();
    const workspaceState = {
      get: (key: string): unknown => values.get(key),
      update: vi.fn(async (key: string, value: unknown) => {
        values.set(key, value);
      }),
    };

    const first = new WorkspaceApprovalMemory(workspaceState);
    expect(first.hasRoutineAccess()).toBe(false);

    await first.rememberRoutineAccess();

    const reloaded = new WorkspaceApprovalMemory(workspaceState);
    expect(reloaded.hasRoutineAccess()).toBe(true);
    expect(workspaceState.update).toHaveBeenCalledOnce();
  });

  it('fails closed when workspace state contains an invalid value', () => {
    const workspaceState = {
      get: () => ({ approved: 'yes' }),
      update: vi.fn(async () => undefined),
    };

    expect(new WorkspaceApprovalMemory(workspaceState).hasRoutineAccess()).toBe(false);
  });
});
