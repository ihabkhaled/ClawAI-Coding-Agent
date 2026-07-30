import { describe, expect, it, vi } from 'vitest';

vi.mock('vscode', () => ({
  l10n: { t: (message: string) => message },
}));

import { PromptExecutionService } from '../../src/services/prompt-execution-service';
import { testRuntimeConfiguration } from '../helpers/runtime-configuration';

describe('PromptExecutionService attachment submission', () => {
  it('rolls back a new attachment lease when message submission fails', async () => {
    const rollback = vi.fn(async () => undefined);
    const accept = vi.fn();
    const requestSession = {
      authorize: vi.fn(async () => true),
      isPlanMode: vi.fn(() => false),
      preparePrompt: (content: string) => content,
    };
    const service = new PromptExecutionService({
      activateThread: vi.fn(),
      assertAdmission: vi.fn(),
      attachments: {
        acquire: vi.fn(async () => ({
          accept,
          fileIds: ['file-1'],
          rollback,
        })),
      },
      backend: () => ({}) as never,
      captureAdmission: vi.fn(() => ({
        boundaryEpoch: 1,
        session: Promise.resolve(requestSession),
        threadId: undefined,
        workspaceFolderKey: 'folder-1',
      })),
      chat: {
        send: vi.fn(async () => {
          throw new Error('message rejected');
        }),
      },
      collect: vi.fn(async () => ({
        files: [],
        receipt: { excluded: [], included: [], totalBytes: 0, truncated: false },
      })),
      configuration: {
        read: vi.fn(testRuntimeConfiguration),
      },
      conversations: {
        prepare: vi.fn(async () => 'session-1'),
        threadForRequest: vi.fn(async () => undefined),
      },
      generations: {
        enqueue: vi.fn(
          async (
            _requestId: string,
            _kind: string,
            _prompt: string,
            action: (signal: AbortSignal) => Promise<void>,
          ) => action(new AbortController().signal),
        ),
      },
      projectRules: vi.fn(async () => ''),
      state: { snapshot: { models: [] } },
      view: () => null,
    } as never);

    await expect(
      service.send({
        content: 'Inspect this file',
        contextMode: 'none',
      }),
    ).rejects.toThrow('message rejected');

    expect(accept).not.toHaveBeenCalled();
    expect(rollback).toHaveBeenCalledOnce();
  });
});
