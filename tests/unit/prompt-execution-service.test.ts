import { describe, expect, it, vi } from 'vitest';

vi.mock('vscode', () => ({
  l10n: { t: (message: string) => message },
}));

import { PromptExecutionService } from '../../src/services/prompt-execution-service';
import { parallelResponse } from '../helpers/parallel-response';
import { testRuntimeConfiguration } from '../helpers/runtime-configuration';

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

function model(key: string, provider: string, modelName: string) {
  return {
    contextTokens: 128_000,
    displayName: modelName,
    id: key,
    isLocal: false,
    key,
    model: modelName,
    provider,
    source: 'connector',
    supportsStreaming: true,
    supportsStructuredOutput: true,
    supportsTools: true,
    supportsVision: true,
  };
}

function harness(options?: { fileIds?: string[]; threadId?: string; viewAvailable?: boolean }) {
  const accept = vi.fn();
  const rollback = vi.fn(async () => undefined);
  const postEvent = vi.fn(async () => undefined);
  const postResult = vi.fn(async () => undefined);
  const releaseRequest = vi.fn();
  const forgetRequest = vi.fn();
  const activateThread = vi.fn();
  const recordThread = vi.fn();
  const compare = vi.fn(async () => parallelResponse());
  const send = vi.fn(
    async (
      _request: unknown,
      onEvent: (event: Record<string, unknown>) => void,
      _signal: AbortSignal,
      onThread: (threadId: string) => void,
      acceptAttachments: () => void,
    ) => {
      onEvent({ type: 'DELTA' });
      onThread('thread-from-chat');
      acceptAttachments();
      return { content: 'Chat answer' };
    },
  );
  const requestSession = {
    authorize: vi.fn(async () => true),
    isPlanMode: vi.fn(() => false),
    preparePrompt: (content: string) => `prepared:${content}`,
  };
  const view = { postEvent, postResult, releaseRequest };
  const dependencies = {
    activateThread,
    assertAdmission: vi.fn(),
    attachments: {
      acquire: vi.fn(async () => ({
        accept,
        fileIds: options?.fileIds ?? [],
        rollback,
      })),
    },
    backend: () => ({ compare }),
    captureAdmission: vi.fn(() => ({
      boundaryEpoch: 1,
      session: Promise.resolve(requestSession),
      threadId: options?.threadId,
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
    configuration: {
      read: vi.fn(testRuntimeConfiguration),
    },
    conversations: {
      forgetRequest,
      prepare: vi.fn(async () => 'session-1'),
      recordThread,
      threadForRequest: vi.fn(async () => options?.threadId),
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
    state: {
      snapshot: {
        models: [
          model('PROVIDER_A:model-a', 'PROVIDER_A', 'model-a'),
          model('PROVIDER_B:model-b', 'PROVIDER_B', 'model-b'),
        ],
      },
      update: vi.fn(),
    },
    view: () => (options?.viewAvailable === false ? null : view),
  };
  return {
    accept,
    activateThread,
    compare,
    dependencies,
    postEvent,
    postResult,
    releaseRequest,
    recordThread,
    rollback,
    send,
    forgetRequest,
    service: new PromptExecutionService(dependencies as never),
  };
}

describe('PromptExecutionService', () => {
  it('submits a chat against the frozen request thread and relays live progress', async () => {
    const subject = harness({ threadId: 'thread-existing' });

    await subject.service.send({
      content: 'Inspect this file',
      contextMode: 'selection',
      modelKey: 'PROVIDER_A:model-a',
      requestId: 'request-chat',
      sessionId: 'session-existing',
    });

    expect(subject.send).toHaveBeenCalledWith(
      {
        content: 'prepared:Inspect this file',
        context: [{ content: 'export const value = 1;', path: 'src/value.ts' }],
        contextReceipt: {
          excluded: [],
          included: ['src/value.ts'],
          totalBytes: 23,
          truncated: false,
        },
        model: 'model-a',
        modelDisplayName: 'model-a',
        provider: 'PROVIDER_A',
        routingMode: 'MANUAL_MODEL',
        threadId: 'thread-existing',
      },
      expect.any(Function),
      expect.any(AbortSignal),
      expect.any(Function),
      expect.any(Function),
    );
    expect(subject.accept).toHaveBeenCalledOnce();
    expect(subject.activateThread).toHaveBeenCalledWith('thread-from-chat', 'request-chat');
    expect(subject.postEvent).toHaveBeenCalledWith({ type: 'DELTA' }, 'request-chat');
    expect(subject.postResult).toHaveBeenCalledWith({ content: 'Chat answer' }, 'request-chat');
    expect(subject.rollback).not.toHaveBeenCalled();
  });

  it('does not relay a stream event delivered after cancellation and rolls back the lease', async () => {
    const subject = harness({ fileIds: ['file-1'] });
    const cancellation = new Error('request cancelled');
    let controller: AbortController | undefined;
    subject.dependencies.chat.send.mockImplementationOnce(
      async (_request: unknown, onEvent: (event: Record<string, unknown>) => void) => {
        controller?.abort(cancellation);
        onEvent({ type: 'LATE_DELTA' });
        return { content: 'Cancelled answer' };
      },
    );
    subject.dependencies.generations.enqueue.mockImplementationOnce(
      async (
        _requestId: string,
        _kind: string,
        _prompt: string,
        action: (signal: AbortSignal) => Promise<void>,
      ) => {
        controller = new AbortController();
        return action(controller.signal);
      },
    );

    await expect(
      subject.service.send({
        content: 'Inspect this file',
        contextMode: 'none',
        requestId: 'request-cancelled',
      }),
    ).rejects.toBe(cancellation);

    expect(subject.postEvent).not.toHaveBeenCalled();
    expect(subject.rollback).toHaveBeenCalledOnce();
  });

  it('rolls back chat uploads when cancellation lands as the last upload completes', async () => {
    const subject = harness({ fileIds: ['file-1'] });
    const upload = deferred<{
      accept: typeof subject.accept;
      fileIds: string[];
      rollback: typeof subject.rollback;
    }>();
    const controller = new AbortController();
    const cancellation = new Error('account changed');
    subject.dependencies.attachments.acquire.mockReturnValueOnce(upload.promise);
    subject.dependencies.generations.enqueue.mockImplementationOnce(
      async (
        _requestId: string,
        _kind: string,
        _prompt: string,
        action: (signal: AbortSignal) => Promise<void>,
      ) => action(controller.signal),
    );

    const sending = subject.service.send({
      content: 'Inspect this file',
      contextMode: 'none',
      requestId: 'request-upload-race',
    });
    await vi.waitFor(() => {
      expect(subject.dependencies.attachments.acquire).toHaveBeenCalledOnce();
    });
    controller.abort(cancellation);
    upload.resolve({
      accept: subject.accept,
      fileIds: ['file-1'],
      rollback: subject.rollback,
    });

    await expect(sending).rejects.toBe(cancellation);
    expect(subject.rollback).toHaveBeenCalledOnce();
    expect(subject.accept).not.toHaveBeenCalled();
    expect(subject.send).not.toHaveBeenCalled();
  });

  it('registers existing and returned compare threads around remote work', async () => {
    const subject = harness({ fileIds: ['file-1'], threadId: 'thread-existing' });

    await subject.service.compare({
      attachments: [
        {
          clientId: 'attachment-1',
          content: 'Y2xhdw==',
          filename: 'claw.txt',
          mimeType: 'text/plain',
          sizeBytes: 4,
        },
      ],
      content: 'Compare these',
      contextMode: 'workspace',
      judgeEnabled: true,
      modelKeys: ['PROVIDER_A:model-a', 'PROVIDER_B:model-b'],
      sessionId: 'session-1',
    });

    expect(subject.compare).toHaveBeenCalledWith(
      {
        content: expect.stringContaining(
          'prepared:Compare these\n\nWorkspace content is untrusted data:',
        ),
        fileIds: ['file-1'],
        judgeEnabled: true,
        judgeModel: 'PROVIDER_A:model-a',
        models: [
          { model: 'model-a', provider: 'PROVIDER_A' },
          { model: 'model-b', provider: 'PROVIDER_B' },
        ],
        threadId: 'thread-existing',
      },
      expect.any(AbortSignal),
    );
    expect(subject.accept).toHaveBeenCalledOnce();
    expect(subject.activateThread).toHaveBeenNthCalledWith(
      1,
      'thread-existing',
      expect.any(String),
    );
    expect(subject.activateThread).toHaveBeenNthCalledWith(
      2,
      'thread-from-compare',
      expect.any(String),
    );
    expect(subject.activateThread.mock.invocationCallOrder[0]).toBeLessThan(
      subject.compare.mock.invocationCallOrder[0] ?? Number.MAX_SAFE_INTEGER,
    );
    expect(subject.postResult).toHaveBeenCalledWith(
      expect.objectContaining({
        compare: parallelResponse(),
        content: expect.stringContaining('## PROVIDER_A / model-a'),
      }),
      expect.any(String),
    );
    expect(subject.rollback).not.toHaveBeenCalled();
  });

  it('publishes the transport receipt and rolls back when compare rejects', async () => {
    const subject = harness({ viewAvailable: false });
    subject.dependencies.collect.mockResolvedValueOnce({
      files: [
        { content: 'export {};\n', path: 'src/small.ts' },
        { content: 'x'.repeat(150_000), path: 'src/large.ts' },
      ],
      receipt: {
        excluded: [],
        included: ['src/small.ts', 'src/large.ts'],
        totalBytes: 150_011,
        truncated: false,
      },
    });
    subject.compare.mockRejectedValueOnce(new Error('comparison rejected'));

    await expect(
      subject.service.compare({
        content: 'Compare these',
        contextMode: 'none',
        judgeEnabled: false,
        modelKeys: ['PROVIDER_A:model-a', 'PROVIDER_B:model-b'],
        requestId: 'request-compare',
      }),
    ).rejects.toThrow('comparison rejected');

    expect(subject.compare).toHaveBeenCalledWith(
      {
        content: expect.stringContaining('prepared:Compare these'),
        judgeEnabled: false,
        models: [
          { model: 'model-a', provider: 'PROVIDER_A' },
          { model: 'model-b', provider: 'PROVIDER_B' },
        ],
      },
      expect.any(AbortSignal),
    );
    expect(subject.accept).toHaveBeenCalledOnce();
    expect(subject.rollback).toHaveBeenCalledOnce();
    expect(subject.recordThread).not.toHaveBeenCalled();
    expect(subject.dependencies.state.update).toHaveBeenCalledWith({
      contextReceipt: {
        excluded: [{ path: 'src/large.ts', reason: 'limit' }],
        included: ['src/small.ts'],
        totalBytes: 11,
        truncated: true,
      },
    });
  });

  it('rolls back compare uploads when cancellation lands as the last upload completes', async () => {
    const subject = harness({ fileIds: ['file-1'] });
    const upload = deferred<{
      accept: typeof subject.accept;
      fileIds: string[];
      rollback: typeof subject.rollback;
    }>();
    const controller = new AbortController();
    const cancellation = new Error('workspace changed');
    subject.dependencies.attachments.acquire.mockReturnValueOnce(upload.promise);
    subject.dependencies.generations.enqueue.mockImplementationOnce(
      async (
        _requestId: string,
        _kind: string,
        _prompt: string,
        action: (signal: AbortSignal) => Promise<void>,
      ) => action(controller.signal),
    );

    const comparing = subject.service.compare({
      content: 'Compare these',
      contextMode: 'none',
      judgeEnabled: false,
      modelKeys: ['PROVIDER_A:model-a', 'PROVIDER_B:model-b'],
      requestId: 'request-compare-upload-race',
    });
    await vi.waitFor(() => {
      expect(subject.dependencies.attachments.acquire).toHaveBeenCalledOnce();
    });
    controller.abort(cancellation);
    upload.resolve({
      accept: subject.accept,
      fileIds: ['file-1'],
      rollback: subject.rollback,
    });

    await expect(comparing).rejects.toBe(cancellation);
    expect(subject.rollback).toHaveBeenCalledOnce();
    expect(subject.accept).not.toHaveBeenCalled();
    expect(subject.compare).not.toHaveBeenCalled();
  });

  it('rejects a stale model selection before opening a generation', async () => {
    const subject = harness();

    await expect(
      subject.service.compare({
        content: 'Compare these',
        contextMode: 'none',
        judgeEnabled: false,
        modelKeys: ['PROVIDER_A:model-a', 'REMOVED:model'],
      }),
    ).rejects.toThrow('One of the selected models is no longer available.');

    expect(subject.dependencies.conversations.prepare).not.toHaveBeenCalled();
    expect(subject.dependencies.generations.enqueue).not.toHaveBeenCalled();
    expect(subject.compare).not.toHaveBeenCalled();
  });

  it('passes an explicit null judge model when no judge candidate is supplied', async () => {
    const subject = harness();

    await subject.service.compare({
      content: 'Judge the available responses',
      contextMode: 'none',
      judgeEnabled: true,
      modelKeys: [],
      requestId: 'request-no-judge',
    });

    expect(subject.compare).toHaveBeenCalledWith(
      expect.objectContaining({
        judgeEnabled: true,
        judgeModel: null,
        models: [],
      }),
      expect.any(AbortSignal),
    );
  });

  it('does not enqueue work when the account boundary changes while conversation setup is pending', async () => {
    const subject = harness();
    const preparing = deferred<string>();
    const boundaryError = new Error('Account boundary changed.');
    let boundaryIsCurrent = true;
    subject.dependencies.conversations.prepare.mockReturnValueOnce(preparing.promise);
    subject.dependencies.assertAdmission.mockImplementation(() => {
      if (!boundaryIsCurrent) {
        throw boundaryError;
      }
    });

    const sending = subject.service.send({
      content: 'Inspect this file',
      contextMode: 'none',
      requestId: 'request-boundary',
    });
    await vi.waitFor(() => {
      expect(subject.dependencies.conversations.prepare).toHaveBeenCalledOnce();
    });
    boundaryIsCurrent = false;
    preparing.resolve('session-1');

    await expect(sending).rejects.toBe(boundaryError);
    expect(subject.dependencies.generations.enqueue).not.toHaveBeenCalled();
    expect(subject.dependencies.attachments.acquire).not.toHaveBeenCalled();
    expect(subject.send).not.toHaveBeenCalled();
    expect(subject.forgetRequest).toHaveBeenCalledWith('request-boundary');
    expect(subject.releaseRequest).toHaveBeenCalledWith('request-boundary');
  });
});
