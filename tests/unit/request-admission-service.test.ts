import { describe, expect, it, vi } from 'vitest';

vi.mock('vscode', () => ({
  l10n: { t: (message: string) => message },
}));

import { AccountEpoch } from '../../src/core/account-epoch';
import { RequestAdmissionService } from '../../src/services/request-admission-service';

describe('RequestAdmissionService', () => {
  it('freezes and validates the exact workspace root while starting policy capture synchronously', () => {
    let workspaceFolderKey = 'folder-a';
    const boundary = new AccountEpoch();
    const requestSession = Promise.resolve({ isPlanMode: () => false });
    const capture = vi.fn(() => requestSession);
    const freezeWorkspaceFolder = vi.fn();
    const service = new RequestAdmissionService(
      boundary,
      {
        freezeWorkspaceFolder,
        scopeSnapshot: vi.fn(() => ({ folders: [], selectedFolderKey: workspaceFolderKey })),
      } as never,
      { capture } as never,
    );

    const admission = service.capture('thread-a');

    expect(freezeWorkspaceFolder).toHaveBeenCalledOnce();
    expect(capture).toHaveBeenCalledOnce();
    expect(admission).toEqual({
      boundaryEpoch: 0,
      boundarySignal: expect.any(AbortSignal),
      session: requestSession,
      threadId: 'thread-a',
      workspaceFolderKey: 'folder-a',
      externalOutputRoots: [],
    });
    expect(Object.isFrozen(admission)).toBe(true);
    expect(admission.boundarySignal.aborted).toBe(false);

    workspaceFolderKey = 'folder-b';
    expect(() => {
      service.assert(admission);
    }).toThrow('ClawAI request was cancelled because the account or workspace changed.');

    boundary.invalidate();
    expect(admission.boundarySignal.aborted).toBe(true);
  });
});
