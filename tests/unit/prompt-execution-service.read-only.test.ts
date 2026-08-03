import { describe, expect, it, vi } from 'vitest';

vi.mock('vscode', () => ({
  l10n: { t: (message: string) => message },
}));

import { PromptExecutionService } from '../../src/services/prompt-execution-service';
import { testRuntimeConfiguration } from '../helpers/runtime-configuration';

describe('PromptExecutionService read-only workflows', () => {
  it('builds an evidence-grounded prompt and publishes the generated result', async () => {
    const preparePrompt = vi.fn((content: string) => `prepared:${content}`);
    const postResult = vi.fn(async () => undefined);
    const send = vi.fn(async () => ({ content: 'Review result' }));
    const projectRules = vi.fn(async () => 'Always add tests.');
    const requestSession = {
      authorize: vi.fn(async () => true),
      isPlanMode: vi.fn(() => false),
      preparePrompt,
    };
    const conversations = {
      prepare: vi.fn(async () => 'session-1'),
      recordThread: vi.fn(),
      threadForRequest: vi.fn(async () => 'thread-1'),
    };
    const generations = {
      enqueue: vi.fn(
        async (
          _requestId: string,
          _kind: string,
          _prompt: string,
          action: (signal: AbortSignal) => Promise<void>,
        ) => action(new AbortController().signal),
      ),
    };
    const service = new PromptExecutionService({
      activateThread: vi.fn(),
      assertAdmission: vi.fn(),
      attachments: { acquire: vi.fn() },
      backend: vi.fn(),
      captureAdmission: vi.fn(() => ({
        boundaryEpoch: 4,
        session: Promise.resolve(requestSession),
        threadId: 'thread-1',
        workspaceFolderKey: 'folder-1',
      })),
      chat: { send },
      collect: vi.fn(async () => ({
        files: [{ content: 'export const value = 1;', path: 'src/value.ts' }],
        receipt: {
          excluded: [],
          included: ['src/value.ts'],
          totalBytes: 23,
          truncated: false,
        },
      })),
      configuration: { read: vi.fn(testRuntimeConfiguration) },
      conversations,
      generations,
      projectRules,
      state: { snapshot: { models: [] }, update: vi.fn() },
      view: () => ({ postEvent: vi.fn(), postResult }),
    } as never);

    await service.runReadOnly('review', 'workspace', 'Find regressions');

    expect(projectRules).toHaveBeenCalledOnce();
    expect(generations.enqueue).toHaveBeenCalledWith(
      expect.any(String),
      'chat',
      'Find regressions',
      expect.any(Function),
      {
        concurrencyKey: 'thread:thread-1',
        modelLabel: 'Automatic routing',
      },
    );
    expect(send).toHaveBeenCalledWith(
      expect.objectContaining({
        content: expect.stringContaining('Project rules:\nAlways add tests.'),
        context: [{ content: 'export const value = 1;', path: 'src/value.ts' }],
        contextReceipt: {
          excluded: [],
          included: ['src/value.ts'],
          totalBytes: 23,
          truncated: false,
        },
        modelDisplayName: 'Automatic routing',
        routingMode: 'AUTO',
        threadId: 'thread-1',
      }),
      expect.any(Function),
      expect.any(AbortSignal),
      expect.any(Function),
    );
    expect(preparePrompt).toHaveBeenCalledWith(
      expect.stringContaining('User request: Find regressions'),
    );
    expect(postResult).toHaveBeenCalledWith({ content: 'Review result' }, expect.any(String));
  });
});
