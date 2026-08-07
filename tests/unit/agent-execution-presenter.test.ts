import { describe, expect, it, vi } from 'vitest';

vi.mock('vscode', () => ({
  l10n: {
    t: (message: string, ...values: (number | string)[]) =>
      values.reduce<string>(
        (result, value, index) => result.replace(`{${String(index)}}`, String(value)),
        message,
      ),
  },
}));

import { AgentExecutionPresenter } from '../../src/services/agent-execution-presenter';

import type { AgentRunCallbacks, AgentRunInput } from '../../src/services/agent-run-service.types';
import type { RuntimeConfiguration } from '../../src/services/configuration-service';

const configuration: RuntimeConfiguration = {
  agentMode: 'AUTO',
  effortMode: 'ULTRA',
  backendUrl: 'https://claw.local',
  exclude: [],
  historyLimit: 50,
  maxContextBytes: 200_000,
  maxContextFiles: 40,
  permissionMode: 'MANUAL',
  requestTimeoutMs: 60_000,
  routingMode: 'AUTO',
  selectedModel: '',
};

describe('AgentExecutionPresenter', () => {
  it('keeps each request phase in request-owned run state', async () => {
    const snapshot = {
      agentRuns: {
        'request-a': { files: [], phase: 'reading' as const },
      },
    };
    const state = {
      snapshot,
      update: vi.fn((patch: Partial<typeof snapshot>) => {
        Object.assign(snapshot, patch);
      }),
    };
    const runs = {
      run: vi.fn(async (_input: AgentRunInput, callbacks: AgentRunCallbacks) => {
        callbacks.onPhase({ files: [], phase: 'generating' });
        return {
          content: 'Plan B',
          context: {
            files: [],
            receipt: { excluded: [], included: [], totalBytes: 0, truncated: false },
          },
          status: 'planned' as const,
        };
      }),
    };
    const presenter = new AgentExecutionPresenter(
      runs as never,
      state as never,
      () => ({ postResult: vi.fn(async () => undefined) }) as never,
      vi.fn(),
    );

    await presenter.execute(
      {
        configuration,
        content: 'Plan B',
        contextMode: 'workspace',
        selection: { routingMode: 'AUTO' },
      },
      new AbortController().signal,
      'request-b',
    );

    expect(snapshot.agentRuns).toEqual({
      'request-a': { files: [], phase: 'reading' },
      'request-b': { files: [], phase: 'generating' },
    });
  });

  it('streams request-owned events and publishes a planned response with tokens', async () => {
    const postEvent = vi.fn(async () => undefined);
    const postResult = vi.fn(async () => undefined);
    const state = { snapshot: { agentRuns: {} }, update: vi.fn() };
    const threadChanged = vi.fn();
    const runs = {
      run: vi.fn(async (_input: AgentRunInput, callbacks: AgentRunCallbacks) => {
        callbacks.onEvent({ type: 'CONTENT_DELTA', delta: 'Plan' });
        callbacks.onPhase({ files: [], phase: 'generating' });
        callbacks.onThread('thread-1');
        return {
          content: 'Plan the change',
          context: {
            files: [],
            receipt: { excluded: [], included: ['src/a.ts'], totalBytes: 10, truncated: false },
          },
          status: 'planned' as const,
          tokens: { input: 2, output: 3, source: 'reported' as const, total: 5 },
        };
      }),
    };
    const presenter = new AgentExecutionPresenter(
      runs as never,
      state as never,
      () => ({ postEvent, postResult }) as never,
      threadChanged,
    );

    await presenter.execute(
      {
        configuration,
        content: 'Plan',
        contextMode: 'workspace',
        selection: { routingMode: 'AUTO' },
      },
      new AbortController().signal,
      'request-1',
    );

    expect(postEvent).toHaveBeenCalledWith({ type: 'CONTENT_DELTA', delta: 'Plan' }, 'request-1');
    expect(threadChanged).toHaveBeenCalledWith('thread-1', 'request-1');
    expect(state.update).toHaveBeenCalledWith(
      expect.objectContaining({ contextReceipt: expect.any(Object) }),
    );
    expect(postResult).toHaveBeenCalledWith(
      expect.objectContaining({
        content: 'Plan the change',
        tokens: expect.objectContaining({ total: 5 }),
      }),
      'request-1',
    );
  });

  it('reports rejected runs with and without a validated edit plan', async () => {
    const postResult = vi.fn(async () => undefined);
    const baseResult = {
      content: '',
      context: {
        files: [],
        receipt: { excluded: [], included: [], totalBytes: 0, truncated: false },
      },
      status: 'rejected' as const,
    };
    const runs = {
      run: vi
        .fn()
        .mockResolvedValueOnce(baseResult)
        .mockResolvedValueOnce({
          ...baseResult,
          editPlan: {
            summary: 'Create app/a.js',
            files: [{ path: 'app/a.js', operation: 'create', content: 'export {};\n' }],
          },
          previewId: 'preview-1',
        }),
    };
    const presenter = new AgentExecutionPresenter(
      runs as never,
      { update: vi.fn() } as never,
      () => ({ postResult }) as never,
      vi.fn(),
    );
    const input = {
      configuration,
      content: 'Create a file',
      contextMode: 'workspace' as const,
      selection: { routingMode: 'AUTO' as const },
    };

    await presenter.execute(input, new AbortController().signal, 'request-1');
    await presenter.execute(input, new AbortController().signal, 'request-2');

    expect(postResult).toHaveBeenNthCalledWith(
      1,
      { content: 'Rejected: no files were changed.' },
      'request-1',
    );
    expect(postResult).toHaveBeenNthCalledWith(
      2,
      expect.objectContaining({
        content: 'Rejected: Create app/a.js',
        previewId: 'preview-1',
        undoAvailable: false,
      }),
      'request-2',
    );
  });

  it('does not publish a cancelled non-committed result', async () => {
    const controller = new AbortController();
    const cancellation = new Error('Account changed.');
    const presenter = new AgentExecutionPresenter(
      {
        run: vi.fn(async () => {
          controller.abort(cancellation);
          return {
            content: '',
            context: {
              files: [],
              receipt: { excluded: [], included: [], totalBytes: 0, truncated: false },
            },
            status: 'rejected' as const,
          };
        }),
      } as never,
      { update: vi.fn() } as never,
      () => ({ postResult: vi.fn() }) as never,
      vi.fn(),
    );

    await expect(
      presenter.execute(
        {
          configuration,
          content: 'Create a file',
          contextMode: 'workspace',
          selection: { routingMode: 'AUTO' },
        },
        controller.signal,
        'request-1',
      ),
    ).rejects.toBe(cancellation);
  });

  it('reports an applied result when cancellation raced the non-cancellable commit', async () => {
    const controller = new AbortController();
    const postResult = vi.fn(async () => undefined);
    const runs = {
      run: vi.fn(async () => {
        controller.abort(new Error('Workspace changed.'));
        return {
          content: 'created',
          context: {
            files: [],
            receipt: { excluded: [], included: [], totalBytes: 0, truncated: false },
          },
          editPlan: {
            summary: 'Create app/a.js',
            files: [{ path: 'app/a.js', operation: 'create' as const, content: 'export {};\n' }],
          },
          filesApplied: true,
          status: 'applied' as const,
        };
      }),
    };
    const state = { update: vi.fn() };
    const presenter = new AgentExecutionPresenter(
      runs as never,
      state as never,
      () => ({ postResult }) as never,
      vi.fn(),
    );

    await expect(
      presenter.execute(
        {
          configuration,
          content: 'Create a file',
          contextMode: 'workspace',
          selection: { routingMode: 'AUTO' },
        },
        controller.signal,
        'request-1',
      ),
    ).resolves.toBeUndefined();

    expect(postResult).toHaveBeenCalledWith(
      expect.objectContaining({ content: 'Applied: Create app/a.js', undoAvailable: true }),
      'request-1',
    );
    expect(state.update).not.toHaveBeenCalled();
  });

  it('keeps Undo visible when a command fails after file changes were applied', async () => {
    const postResult = vi.fn(async () => undefined);
    const presenter = new AgentExecutionPresenter(
      {
        run: vi.fn(async () => ({
          commandError: 'Command failed with exit code 1: npm test',
          commandsCompleted: 1,
          commandsExecuted: false,
          commandsTotal: 2,
          content: '',
          context: {
            files: [],
            receipt: { excluded: [], included: [], totalBytes: 0, truncated: false },
          },
          editPlan: {
            summary: 'Create app/a.js',
            files: [{ path: 'app/a.js', operation: 'create', content: 'export {};\n' }],
          },
          filesApplied: true,
          status: 'applied' as const,
        })),
      } as never,
      { update: vi.fn() } as never,
      () => ({ postResult }) as never,
      vi.fn(),
    );

    await presenter.execute(
      {
        configuration,
        content: 'Create and test a file',
        contextMode: 'workspace',
        selection: { routingMode: 'AUTO' },
      },
      new AbortController().signal,
      'request-1',
    );

    expect(postResult).toHaveBeenCalledWith(
      expect.objectContaining({
        content: expect.stringMatching(/Command failed[\s\S]*1 of 2 commands completed/u),
        undoAvailable: true,
      }),
      'request-1',
    );
  });
});
