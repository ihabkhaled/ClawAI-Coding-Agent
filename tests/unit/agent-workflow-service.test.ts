import { describe, expect, it, vi } from 'vitest';

vi.mock('vscode', () => ({
  l10n: { t: (message: string) => message },
}));

import { AgentWorkflowService } from '../../src/services/agent-workflow-service';
import { ChatService } from '../../src/services/chat-service';
import { ConversationSessionService } from '../../src/services/conversation-session-service';
import { testRuntimeConfiguration } from '../helpers/runtime-configuration';

function deferred() {
  let resolve: (() => void) | undefined;
  const promise = new Promise<void>((complete) => {
    resolve = complete;
  });
  return {
    promise,
    resolve: () => {
      resolve?.();
    },
  };
}

describe('AgentWorkflowService', () => {
  it('persists a new conversation thread before Runtime V2 starts', async () => {
    const createRequests: unknown[] = [];
    const backend = {
      createThread: async (input: unknown) => {
        createRequests.push(input);
        return { id: 'thread-runtime' };
      },
      listMessages: async () => [],
    };
    const conversations = new ConversationSessionService(
      { snapshot: { history: [] } } as never,
      () => backend as never,
      () =>
        ({
          bindRequest: vi.fn(),
          titleSessionFromPrompt: vi.fn(async () => undefined),
          updateSession: vi.fn(async () => undefined),
        }) as never,
    );
    const service = new AgentWorkflowService({
      chat: new ChatService(backend as never),
      conversations,
    } as never);
    const input = {
      content: 'First runtime question',
      selection: { routingMode: 'AUTO' },
    } as never;
    await conversations.prepare('session-1', 'request-1', 'First runtime question');

    await expect(service.runtimeThread(input, 'request-1')).resolves.toBe('thread-runtime');
    await expect(conversations.threadForRequest('request-1')).resolves.toBe('thread-runtime');
    expect(createRequests).toEqual([{ title: 'First runtime question', routingMode: 'AUTO' }]);
  });

  it('captures immutable workflow inputs and accepts uploaded attachments after execution starts', async () => {
    const accept = vi.fn();
    const acquire = vi.fn(async () => ({
      accept,
      fileIds: ['file-1'],
      rollback: vi.fn(async () => undefined),
    }));
    const execute = vi.fn(
      async (input: { onAccepted?: () => void; prepareFileIds?: () => Promise<string[]> }) => {
        await input.prepareFileIds?.();
        input.onAccepted?.();
      },
    );
    const session = {
      authorize: vi.fn(async () => true),
      isPlanMode: vi.fn(() => false),
      preparePrompt: vi.fn((content: string) => content),
    };
    const admission = {
      boundaryEpoch: 7,
      session: Promise.resolve(session),
      threadId: 'thread-1',
      workspaceFolderKey: 'folder-1',
    };
    const service = new AgentWorkflowService({
      assertAdmission: vi.fn(),
      attachments: { acquire },
      captureAdmission: vi.fn(() => admission),
      configuration: { read: vi.fn(testRuntimeConfiguration) },
      conversations: {
        forgetRequest: vi.fn(),
        prepare: vi.fn(async () => 'session-1'),
        threadForRequest: vi.fn(async () => 'thread-1'),
      },
      executions: { execute },
      state: { snapshot: { models: [] } },
    } as never);

    const queued = await service.snapshot({
      attachments: [
        {
          clientId: 'attachment-1',
          content: 'bm90ZXM=',
          filename: 'notes.txt',
          mimeType: 'text/plain',
          sizeBytes: 5,
        },
      ],
      content: 'Review this',
      contextMode: 'workspace',
      kind: 'review',
    });
    await service.execute(queued, new AbortController().signal, 'request-1');

    expect(queued).toEqual(
      expect.objectContaining({
        admission,
        configuration: testRuntimeConfiguration(),
        modelLabel: 'Automatic routing',
        selection: { routingMode: 'AUTO' },
        session,
      }),
    );
    expect(acquire).toHaveBeenCalledWith(queued.attachments, expect.any(AbortSignal), 'request-1');
    expect(execute).toHaveBeenCalledWith(
      expect.objectContaining({
        onAccepted: expect.any(Function),
        prepareFileIds: expect.any(Function),
        threadId: 'thread-1',
      }),
      expect.any(AbortSignal),
      'request-1',
    );
    expect(accept).toHaveBeenCalledOnce();
  });

  it('rolls back an attachment lease when agent execution fails', async () => {
    const failure = new Error('agent failed');
    const rollback = vi.fn(async () => undefined);
    const acquire = vi.fn(async () => ({
      accept: vi.fn(),
      fileIds: ['file-1'],
      rollback,
    }));
    const session = {
      authorize: vi.fn(async () => true),
      isPlanMode: vi.fn(() => false),
      preparePrompt: vi.fn((content: string) => content),
    };
    const admission = {
      boundaryEpoch: 1,
      session: Promise.resolve(session),
      threadId: undefined,
      workspaceFolderKey: 'folder-1',
    };
    const service = new AgentWorkflowService({
      assertAdmission: vi.fn(),
      attachments: { acquire },
      captureAdmission: vi.fn(() => admission),
      configuration: { read: vi.fn(testRuntimeConfiguration) },
      conversations: {
        forgetRequest: vi.fn(),
        prepare: vi.fn(async () => 'session-1'),
        threadForRequest: vi.fn(async () => undefined),
      },
      executions: {
        execute: vi.fn(async (input: { prepareFileIds?: () => Promise<string[]> }) => {
          await input.prepareFileIds?.();
          throw failure;
        }),
      },
      state: { snapshot: { models: [] } },
    } as never);
    const queued = await service.snapshot({
      attachments: [
        {
          clientId: 'attachment-1',
          content: 'bm90ZXM=',
          filename: 'notes.txt',
          mimeType: 'text/plain',
          sizeBytes: 5,
        },
      ],
      content: 'Review this',
      contextMode: 'workspace',
      kind: 'review',
    });

    await expect(service.execute(queued, new AbortController().signal, 'request-1')).rejects.toBe(
      failure,
    );

    expect(rollback).toHaveBeenCalledOnce();
  });

  it('releases pending thread ownership when a boundary changes during title generation', async () => {
    const title = deferred();
    const titleSessionFromPrompt = vi
      .fn()
      .mockImplementationOnce(() => title.promise)
      .mockResolvedValue(undefined);
    const conversations = new ConversationSessionService(
      { snapshot: { history: [] } } as never,
      vi.fn() as never,
      () =>
        ({
          bindRequest: vi.fn(),
          titleSessionFromPrompt,
        }) as never,
    );
    let current = true;
    const admission = {
      boundaryEpoch: 1,
      session: Promise.resolve({} as never),
      threadId: undefined,
      workspaceFolderKey: 'folder-1',
    };
    const service = new AgentWorkflowService({
      assertAdmission: vi.fn(() => {
        if (!current) {
          throw new Error('workspace changed');
        }
      }),
      attachments: {},
      captureAdmission: vi.fn(() => admission),
      configuration: {},
      conversations,
      executions: {},
      state: {},
    } as never);
    const firstInput = {
      admission,
      content: 'First prompt',
      sessionId: 'session-1',
    } as never;

    const firstPreparation = service.prepare(firstInput, 'request-1');
    expect(titleSessionFromPrompt).toHaveBeenCalledOnce();
    current = false;
    title.resolve();

    await expect(firstPreparation).rejects.toThrow('workspace changed');

    current = true;
    await service.prepare(
      {
        admission,
        content: 'Second prompt',
        sessionId: 'session-1',
      } as never,
      'request-2',
    );
    const nextThread = await Promise.race([
      conversations.threadForRequest('request-2').then(() => 'ready'),
      new Promise<string>((resolve) => {
        setTimeout(() => {
          resolve('blocked');
        }, 0);
      }),
    ]);

    expect(nextThread).toBe('ready');
  });
});
