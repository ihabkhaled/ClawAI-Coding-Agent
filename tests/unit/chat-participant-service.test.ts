import { describe, expect, it, vi } from 'vitest';

vi.mock('vscode', () => ({
  l10n: { t: (message: string, value?: string) => message.replace('{0}', value ?? '') },
}));

import { BackendSessionChangedError } from '../../src/backend/backend-client';
import { AccountEpoch } from '../../src/core/account-epoch';
import { ChatParticipantService } from '../../src/services/chat-participant-service';
import { RequestAdmissionService } from '../../src/services/request-admission-service';
import { testRuntimeConfiguration } from '../helpers/runtime-configuration';

function deferred<T>() {
  let resolve: ((value: T) => void) | undefined;
  const promise = new Promise<T>((complete) => {
    resolve = complete;
  });
  return {
    promise,
    resolve: (value: T) => {
      resolve?.(value);
    },
  };
}

function responseStream() {
  return {
    button: vi.fn(),
    markdown: vi.fn(),
  };
}

function generationHarness() {
  return {
    enqueue: vi.fn(
      async (
        _requestId: string,
        _kind: string,
        _prompt: string,
        action: (signal: AbortSignal) => Promise<void>,
      ) => action(new AbortController().signal),
    ),
  };
}

function admissionHarness(context: {
  freezeWorkspaceFolder: ReturnType<typeof vi.fn>;
  scopeSnapshot: ReturnType<typeof vi.fn>;
}) {
  const epoch = new AccountEpoch();
  const session = {
    authorize: vi.fn(async () => true),
    isPlanMode: vi.fn(() => false),
    preparePrompt: vi.fn((content: string) => content),
  };
  const admissions = new RequestAdmissionService(
    epoch,
    context as never,
    { capture: vi.fn(async () => session) } as never,
  );
  return {
    admissions: Object.assign(admissions, {
      authorize: session.authorize,
      preparePrompt: session.preparePrompt,
    }),
    epoch,
  };
}

describe('ChatParticipantService', () => {
  it('invalidates account state when native chat detects a changed session', async () => {
    const markdown = vi.fn();
    const cancellation = { dispose: vi.fn() };
    const context = {
      collect: vi.fn(async () => ({
        files: [],
        receipt: { excluded: [], included: [], totalBytes: 0, truncated: false },
      })),
      freezeWorkspaceFolder: vi.fn(),
      resolve: vi.fn(() => 'none'),
      scopeSnapshot: vi.fn(() => ({ folders: [], selectedFolderKey: 'folder-a' })),
    };
    const { admissions, epoch } = admissionHarness(context);
    const accountBoundary = vi.fn(async () => {
      epoch.invalidate();
    });
    const service = new ChatParticipantService(
      {
        snapshot: {
          connected: true,
          models: [],
        },
        update: vi.fn(),
      } as never,
      { error: vi.fn() } as never,
      { read: vi.fn(testRuntimeConfiguration) } as never,
      context as never,
      {
        send: vi.fn(async () => {
          throw new BackendSessionChangedError();
        }),
      } as never,
      admissions,
      generationHarness() as never,
      vi.fn(),
      vi.fn(async () => undefined),
      accountBoundary,
    );

    await service.send(
      'hello',
      { button: vi.fn(), markdown } as never,
      {
        onCancellationRequested: vi.fn(() => cancellation),
      } as never,
    );

    expect(accountBoundary).toHaveBeenCalledOnce();
    expect(markdown).toHaveBeenCalledWith(
      expect.stringContaining('account changed in another VS Code window'),
    );
    expect(cancellation.dispose).toHaveBeenCalledOnce();
  });

  it('does not send context collected after the native chat workspace changes', async () => {
    let workspaceFolderKey = 'folder-a';
    const collected = deferred<{
      files: never[];
      receipt: { excluded: never[]; included: string[]; totalBytes: number; truncated: boolean };
    }>();
    const context = {
      collect: vi.fn(() => collected.promise),
      freezeWorkspaceFolder: vi.fn(),
      resolve: vi.fn(() => 'none'),
      scopeSnapshot: vi.fn(() => ({
        folders: [],
        selectedFolderKey: workspaceFolderKey,
      })),
    };
    const { admissions, epoch } = admissionHarness(context);
    const chat = { send: vi.fn() };
    const response = responseStream();
    const service = new ChatParticipantService(
      { snapshot: { connected: true, models: [] }, update: vi.fn() } as never,
      { error: vi.fn() } as never,
      { read: vi.fn(testRuntimeConfiguration) } as never,
      context as never,
      chat as never,
      admissions,
      generationHarness() as never,
      vi.fn(),
      vi.fn(async () => undefined),
      vi.fn(),
    );

    const sending = service.send(
      'inspect the workspace',
      response as never,
      { onCancellationRequested: vi.fn(() => ({ dispose: vi.fn() })) } as never,
    );
    await vi.waitFor(() => {
      expect(context.collect).toHaveBeenCalledOnce();
    });
    workspaceFolderKey = 'folder-b';
    epoch.invalidate();
    collected.resolve({
      files: [],
      receipt: {
        excluded: [],
        included: ['folder-a/private.ts'],
        totalBytes: 1,
        truncated: false,
      },
    });
    await sending;

    expect(chat.send).not.toHaveBeenCalled();
    expect(response.markdown).toHaveBeenCalledWith(
      expect.stringContaining('account or workspace changed'),
    );
  });

  it('aborts an active native chat request when its admission boundary changes', async () => {
    const backendResult = deferred<{
      content: string;
      contextReceipt: undefined;
    }>();
    const context = {
      collect: vi.fn(async () => ({
        files: [],
        receipt: { excluded: [], included: [], totalBytes: 0, truncated: false },
      })),
      freezeWorkspaceFolder: vi.fn(),
      resolve: vi.fn(() => 'none'),
      scopeSnapshot: vi.fn(() => ({ folders: [], selectedFolderKey: 'folder-a' })),
    };
    const { admissions, epoch } = admissionHarness(context);
    let requestSignal: AbortSignal | undefined;
    const chat = {
      send: vi.fn(
        async (
          _input: unknown,
          _onEvent: () => void,
          signal?: AbortSignal,
          onThread?: (threadId: string) => void,
        ) => {
          requestSignal = signal;
          onThread?.('thread-native');
          const result = await backendResult.promise;
          signal?.throwIfAborted();
          return result;
        },
      ),
    };
    const response = responseStream();
    const generations = generationHarness();
    const activateThread = vi.fn();
    const service = new ChatParticipantService(
      { snapshot: { connected: true, models: [] }, update: vi.fn() } as never,
      { error: vi.fn() } as never,
      { read: vi.fn(testRuntimeConfiguration) } as never,
      context as never,
      chat as never,
      admissions,
      generations as never,
      activateThread,
      vi.fn(async () => undefined),
      vi.fn(),
    );

    const sending = service.send(
      'inspect the workspace',
      response as never,
      { onCancellationRequested: vi.fn(() => ({ dispose: vi.fn() })) } as never,
    );
    await vi.waitFor(() => {
      expect(chat.send).toHaveBeenCalledOnce();
    });
    expect(chat.send).toHaveBeenCalledWith(
      expect.objectContaining({ modelDisplayName: 'Automatic routing' }),
      expect.any(Function),
      expect.any(AbortSignal),
      expect.any(Function),
    );
    expect(generations.enqueue).toHaveBeenCalledWith(
      expect.any(String),
      'chat',
      'inspect the workspace',
      expect.any(Function),
      expect.objectContaining({
        concurrencyKey: expect.stringMatching(/^participant:/u),
        modelLabel: 'Automatic routing',
      }),
    );
    expect(activateThread).toHaveBeenCalledWith('thread-native', expect.any(String));
    epoch.invalidate();
    backendResult.resolve({ content: 'stale account response', contextReceipt: undefined });
    await sending;

    expect(requestSignal?.aborted).toBe(true);
    expect(response.markdown).not.toHaveBeenCalledWith('stale account response');
    expect(response.markdown).toHaveBeenCalledWith(
      expect.stringContaining('account or workspace changed'),
    );
  });
});
