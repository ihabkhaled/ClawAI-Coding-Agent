import { describe, expect, it, vi } from 'vitest';

import { AgentRunService } from '../../src/services/agent-run-service';
import { SafeEditService, type WorkspaceEditPort } from '../../src/services/safe-edit-service';

import type { EditPlan } from '../../src/core/edit-plan';
import type {
  AgentRunCallbacks,
  AgentRunChatPort,
  AgentRunContextPort,
  AgentRunSessionPort,
  AgentRunSnapshot,
} from '../../src/services/agent-run-service.types';
import type { RuntimeConfiguration } from '../../src/services/configuration-service';

const configuration: RuntimeConfiguration = {
  agentMode: 'AUTO',
  effortMode: 'ULTRA',
  speedMode: '1X',
  backendUrl: 'https://claw.local',
  exclude: [],
  historyLimit: 50,
  maxContextBytes: 200_000,
  maxContextFiles: 40,
  permissionMode: 'EDIT_AUTOMATICALLY',
  requestTimeoutMs: 60_000,
  routingMode: 'MANUAL_MODEL',
  selectedModel: 'OLLAMA:qwen2.5-coder',
};

function contextPort(overrides: Partial<AgentRunContextPort> = {}): AgentRunContextPort {
  return {
    resolve: vi.fn((): 'workspace' => 'workspace'),
    collect: vi.fn(async () => ({
      files: [],
      receipt: {
        excluded: [],
        included: [],
        totalBytes: 0,
        truncated: false,
      },
    })),
    projectRules: vi.fn(async () => ''),
    ...overrides,
  };
}

function sessionPort(overrides: Partial<AgentRunSessionPort> = {}): AgentRunSessionPort {
  return {
    authorize: vi.fn(async () => true),
    isPlanMode: vi.fn(() => false),
    preparePrompt: vi.fn((content: string) => content),
    ...overrides,
  };
}

function callbacks(
  phases: AgentRunSnapshot[] = [],
  events: Record<string, unknown>[] = [],
): AgentRunCallbacks {
  return {
    onEvent: (event) => events.push(event),
    onPhase: (phase) => phases.push(phase),
    onThread: vi.fn(),
  };
}

function textChat(content: string): AgentRunChatPort {
  return {
    send: vi.fn(async () => {
      return {
        threadId: 'thread-1',
        content,
        tokens: { input: 1, output: 1, source: 'estimated' as const, total: 2 },
      };
    }),
  };
}

function inMemoryWorkspace(files: Map<string, string>): WorkspaceEditPort {
  return {
    isTrusted: () => true,
    preview: async (plan: EditPlan) => ({
      workspaceFolderUri: 'memory:///workspace',
      previews: plan.files.map((file) => ({
        path: file.path,
        before: files.get(file.path) ?? null,
        after: file.operation === 'delete' ? null : (file.content ?? null),
      })),
    }),
    applyAtomically: async (plan: EditPlan) => {
      for (const file of plan.files) {
        if (file.operation === 'delete') {
          files.delete(file.path);
        } else {
          files.set(file.path, file.content ?? '');
        }
      }
      return true;
    },
  };
}

describe('AgentRunService request boundaries', () => {
  it('stops before generation when edit permission is rejected', async () => {
    const chat = textChat('not reached');
    const prepareFileIds = vi.fn(async () => ['orphaned-file']);
    const service = new AgentRunService(
      contextPort({ resolve: () => 'none' }),
      sessionPort({
        authorize: async (operation) => operation === 'workspaceContext',
      }),
      chat,
      new SafeEditService(inMemoryWorkspace(new Map()), async () => true),
    );

    await expect(
      service.run(
        {
          configuration,
          content: 'Change a file',
          contextMode: 'none',
          prepareFileIds,
          selection: { routingMode: 'AUTO' },
          signal: new AbortController().signal,
        },
        callbacks(),
      ),
    ).resolves.toMatchObject({
      status: 'rejected',
      content: '',
    });
    expect(chat.send).not.toHaveBeenCalled();
    expect(prepareFileIds).not.toHaveBeenCalled();
  });

  it('uses the immutable request session after composer controls change', async () => {
    const liveSession = sessionPort();
    const requestSession = sessionPort({
      isPlanMode: () => true,
      preparePrompt: (content) => `SNAPSHOT:${content}`,
    });
    const chat = textChat('Read-only plan');
    const service = new AgentRunService(
      contextPort(),
      liveSession,
      chat,
      new SafeEditService(inMemoryWorkspace(new Map()), async () => true),
    );

    await expect(
      service.run(
        {
          configuration,
          content: 'Plan a safe change',
          contextMode: 'workspace',
          selection: { routingMode: 'AUTO' },
          session: requestSession,
          signal: new AbortController().signal,
        },
        callbacks(),
      ),
    ).resolves.toMatchObject({ content: 'Read-only plan', status: 'planned' });

    expect(liveSession.authorize).not.toHaveBeenCalled();
    expect(vi.mocked(chat.send).mock.calls[0]?.[0].content).toContain('SNAPSHOT:');
  });

  it('uses the immutable request permission for final diff approval', async () => {
    const liveSession = sessionPort();
    const requestAuthorize = vi.fn(async (operation) => operation !== 'finalDiff');
    const requestSession = sessionPort({ authorize: requestAuthorize });
    const workspace = inMemoryWorkspace(new Map());
    const service = new AgentRunService(
      contextPort(),
      liveSession,
      textChat(
        JSON.stringify({
          summary: 'Create a file',
          files: [{ path: 'app/a.js', operation: 'create', content: 'export {};\n' }],
        }),
      ),
      new SafeEditService(workspace, async (_previews, _summary, session) =>
        session === undefined ? false : session.authorize('finalDiff'),
      ),
    );

    await expect(
      service.run(
        {
          configuration,
          content: 'Create a file',
          contextMode: 'workspace',
          selection: { routingMode: 'AUTO' },
          session: requestSession,
          signal: new AbortController().signal,
        },
        callbacks(),
      ),
    ).resolves.toMatchObject({ status: 'rejected' });

    expect(requestAuthorize).toHaveBeenCalledWith('finalDiff');
    expect(liveSession.authorize).not.toHaveBeenCalled();
  });

  it('cannot resume old-account edits when cancellation wins an approval race', async () => {
    let finishApproval: ((approved: boolean) => void) | undefined;
    const authorize = vi.fn(
      () =>
        new Promise<boolean>((resolve) => {
          finishApproval = resolve;
        }),
    );
    const edits = {
      execute: vi.fn(),
      previewAndApply: vi.fn(),
    };
    const controller = new AbortController();
    const cancellation = new Error('Account changed.');
    const service = new AgentRunService(
      contextPort({ resolve: () => 'none' }),
      sessionPort({ authorize }),
      textChat('not reached'),
      edits,
    );
    const running = service.run(
      {
        configuration,
        content: 'Change a file',
        contextMode: 'none',
        selection: { routingMode: 'AUTO' },
        signal: controller.signal,
      },
      callbacks(),
    );
    await vi.waitFor(() => {
      expect(authorize).toHaveBeenCalledWith('editGeneration', undefined, controller.signal);
    });

    controller.abort(cancellation);
    finishApproval?.(true);

    await expect(running).rejects.toBe(cancellation);
    expect(edits.previewAndApply).not.toHaveBeenCalled();
  });

  it('keeps the workspace unchanged when final diff approval is rejected', async () => {
    const files = new Map<string, string>();
    const chat = textChat(
      JSON.stringify({
        summary: 'Create a file',
        files: [{ path: 'app/new.js', operation: 'create', content: 'export {};\n' }],
      }),
    );
    const service = new AgentRunService(
      contextPort(),
      sessionPort(),
      chat,
      new SafeEditService(inMemoryWorkspace(files), async () => false),
    );

    await expect(
      service.run(
        {
          configuration,
          content: 'Create a file',
          contextMode: 'workspace',
          selection: { routingMode: 'AUTO' },
          signal: new AbortController().signal,
        },
        callbacks(),
      ),
    ).resolves.toMatchObject({
      status: 'rejected',
      editPlan: { summary: 'Create a file' },
    });
    expect(files.size).toBe(0);
  });

  it('rejects unsafe model output and reports a failed phase', async () => {
    const phases: AgentRunSnapshot[] = [];
    const service = new AgentRunService(
      contextPort(),
      sessionPort(),
      textChat(
        JSON.stringify({
          summary: 'Escape the workspace',
          files: [{ path: '../outside.js', operation: 'create', content: 'unsafe' }],
        }),
      ),
      new SafeEditService(inMemoryWorkspace(new Map()), async () => true),
    );

    await expect(
      service.run(
        {
          configuration,
          content: 'Create a file',
          contextMode: 'workspace',
          selection: { routingMode: 'AUTO' },
          signal: new AbortController().signal,
        },
        callbacks(phases),
      ),
    ).rejects.toThrow();
    expect(phases.at(-1)).toMatchObject({
      phase: 'failed',
      summary: expect.stringContaining('path'),
    });
  });

  it('fails before reading files when workspace access is denied', async () => {
    const context = contextPort();
    const phases: AgentRunSnapshot[] = [];
    const service = new AgentRunService(
      context,
      sessionPort({ authorize: async () => false }),
      textChat('not reached'),
      new SafeEditService(inMemoryWorkspace(new Map()), async () => true),
    );

    await expect(
      service.run(
        {
          configuration,
          content: 'Read the workspace',
          contextMode: 'workspace',
          selection: { routingMode: 'AUTO' },
          signal: new AbortController().signal,
        },
        callbacks(phases),
      ),
    ).rejects.toThrow(/not approved/iu);
    expect(context.collect).not.toHaveBeenCalled();
    expect(phases.at(-1)?.phase).toBe('failed');
  });
});
