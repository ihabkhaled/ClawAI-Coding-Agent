import { describe, expect, it, vi } from 'vitest';

import { runPromptAdmissionFlow } from '../../src/webview/prompt-admission-flow';

function deferred<T>() {
  let resolve: ((value: T) => void) | undefined;
  const promise = new Promise<T>((complete) => {
    resolve = complete;
  });
  return {
    promise,
    resolve(value: T) {
      resolve?.(value);
    },
  };
}

describe('runPromptAdmissionFlow', () => {
  it('captures the workspace root and policy before a deferred reveal', async () => {
    let workspaceFolderKey = 'folder-a';
    let permissionMode = 'MANUAL';
    const revealedSession = deferred<string>();
    const dispatch = vi.fn(async () => undefined);
    const flow = runPromptAdmissionFlow({
      bindRequest: vi.fn(() => true),
      captureAdmission: vi.fn(() => ({
        permissionMode,
        workspaceFolderKey,
      })),
      dispatch,
      resolveSession: () => revealedSession.promise,
      threadId: undefined,
      titleSession: vi.fn(async () => undefined),
    });

    workspaceFolderKey = 'folder-b';
    permissionMode = 'BYPASS_PERMISSIONS';
    revealedSession.resolve('session-1');
    await flow;

    expect(dispatch).toHaveBeenCalledWith(
      {
        permissionMode: 'MANUAL',
        workspaceFolderKey: 'folder-a',
      },
      'session-1',
    );
  });

  it('keeps the source conversation target while title generation is deferred', async () => {
    const title = deferred<undefined>();
    const dispatch = vi.fn(async () => undefined);
    const flow = runPromptAdmissionFlow({
      bindRequest: vi.fn(() => true),
      captureAdmission: vi.fn((threadId?: string) => ({ threadId })),
      dispatch,
      resolveSession: vi.fn(async () => 'session-1'),
      threadId: 'thread-a',
      titleSession: vi.fn(() => title.promise),
    });

    await Promise.resolve();
    title.resolve(undefined);
    await flow;

    expect(dispatch).toHaveBeenCalledWith({ threadId: 'thread-a' }, 'session-1');
  });
});
