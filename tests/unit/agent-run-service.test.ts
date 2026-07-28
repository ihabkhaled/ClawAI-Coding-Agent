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

function callbacks(phases: AgentRunSnapshot[] = []): AgentRunCallbacks {
  return {
    onEvent: vi.fn(),
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
      };
    }),
  };
}

function inMemoryWorkspace(files: Map<string, string>): WorkspaceEditPort {
  return {
    isTrusted: () => true,
    preview: async (plan: EditPlan) =>
      plan.files.map((file) => ({
        path: file.path,
        before: files.get(file.path) ?? null,
        after: file.operation === 'delete' ? null : (file.content ?? null),
      })),
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

describe('AgentRunService', () => {
  it('turns the exact coding prompt into an approved workspace file change', async () => {
    const prompt = 'write for loop from 1 to 10 in file .js inside folder app';
    const files = new Map<string, string>();
    const chat: AgentRunChatPort = {
      send: vi.fn(async () => ({
        threadId: 'thread-1',
        content: JSON.stringify({
          summary: 'Create a JavaScript loop',
          files: [
            {
              path: 'app/for-loop.js',
              operation: 'create',
              content: 'for (let index = 1; index <= 10; index += 1) {\n  console.log(index);\n}\n',
            },
          ],
        }),
      })),
    };
    const service = new AgentRunService(
      contextPort(),
      sessionPort(),
      chat,
      new SafeEditService(inMemoryWorkspace(files), async () => true),
    );
    const phases: AgentRunSnapshot[] = [];

    const result = await service.run(
      {
        configuration,
        content: prompt,
        contextMode: 'smart',
        selection: {
          model: 'qwen2.5-coder',
          provider: 'OLLAMA',
          routingMode: 'MANUAL_MODEL',
        },
        signal: new AbortController().signal,
      },
      callbacks(phases),
    );

    expect(result.status).toBe('applied');
    expect(files.get('app/for-loop.js')).toContain('index <= 10');
    expect(vi.mocked(chat.send).mock.calls[0]?.[0]).toMatchObject({
      routingMode: 'MANUAL_MODEL',
      provider: 'OLLAMA',
      model: 'qwen2.5-coder',
    });
    expect(vi.mocked(chat.send).mock.calls[0]?.[0].content).toContain(prompt);
    expect(phases.map((phase) => phase.phase)).toEqual([
      'reading',
      'generating',
      'reviewing',
      'applied',
    ]);
  });

  it('runs approved verification commands after applying workspace edits', async () => {
    const files = new Map<string, string>();
    const executed: string[] = [];
    const service = new AgentRunService(
      contextPort(),
      sessionPort(),
      textChat(
        JSON.stringify({
          summary: 'Create and verify a loop',
          files: [
            {
              path: 'app/for-loop.js',
              operation: 'create',
              content: 'for (let index = 1; index <= 10; index += 1) {}\n',
            },
          ],
          commands: [
            {
              command: 'node app/for-loop.js',
              purpose: 'Run the generated program',
            },
          ],
        }),
      ),
      new SafeEditService(
        {
          ...inMemoryWorkspace(files),
          execute: async (command) => {
            executed.push(command.command);
            return { exitCode: 0 };
          },
        },
        async () => true,
      ),
    );
    const phases: AgentRunSnapshot[] = [];

    await expect(
      service.run(
        {
          configuration,
          content: 'Create and run a JavaScript loop',
          contextMode: 'workspace',
          selection: { routingMode: 'AUTO' },
          signal: new AbortController().signal,
        },
        callbacks(phases),
      ),
    ).resolves.toMatchObject({ status: 'applied' });

    expect(executed).toEqual(['node app/for-loop.js']);
    expect(phases.map((phase) => phase.phase)).toContain('executing');
    expect(phases.at(-1)).toMatchObject({ phase: 'verified' });
  });

  it('does not run commands when in-panel command approval is rejected', async () => {
    const execute = vi.fn();
    const authorize = vi.fn(async (operation) => operation !== 'commandExecution');
    const service = new AgentRunService(
      contextPort(),
      sessionPort({ authorize }),
      textChat(
        JSON.stringify({
          summary: 'Create and verify a file',
          files: [{ path: 'app/a.js', operation: 'create', content: 'export {};\n' }],
          commands: [{ command: 'npm test', purpose: 'Run tests' }],
        }),
      ),
      new SafeEditService({ ...inMemoryWorkspace(new Map()), execute }, async () => true),
    );

    await expect(
      service.run(
        {
          configuration,
          content: 'Create and test a file',
          contextMode: 'workspace',
          selection: { routingMode: 'AUTO' },
          signal: new AbortController().signal,
        },
        callbacks(),
      ),
    ).resolves.toMatchObject({ status: 'applied', commandsExecuted: false });
    expect(execute).not.toHaveBeenCalled();
  });

  it('returns analysis without proposing or applying edits in plan mode', async () => {
    const files = new Map<string, string>();
    const chat = textChat('1. Inspect the app folder.\n2. Add the JavaScript file.');
    const edits = new SafeEditService(inMemoryWorkspace(files), async () => true);
    const service = new AgentRunService(
      contextPort(),
      sessionPort({ isPlanMode: () => true }),
      chat,
      edits,
    );
    const phases: AgentRunSnapshot[] = [];

    await expect(
      service.run(
        {
          configuration: { ...configuration, agentMode: 'PLAN' },
          content: 'Plan a JavaScript loop',
          contextMode: 'workspace',
          selection: { routingMode: 'AUTO' },
          signal: new AbortController().signal,
        },
        callbacks(phases),
      ),
    ).resolves.toMatchObject({
      status: 'planned',
      content: expect.stringContaining('Inspect'),
      threadId: 'thread-1',
    });
    expect(files.size).toBe(0);
    expect(phases.map((phase) => phase.phase)).toEqual(['reading', 'generating', 'planned']);
  });

  it('stops before generation when edit permission is rejected', async () => {
    const chat = textChat('not reached');
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

  it('repairs one malformed local-model response in a fresh stream thread', async () => {
    const files = new Map<string, string>();
    const send = vi
      .fn<AgentRunChatPort['send']>()
      .mockResolvedValueOnce({
        threadId: 'thread-1',
        content: 'Here is the JavaScript file you requested.',
      })
      .mockResolvedValueOnce({
        threadId: 'thread-2',
        content: JSON.stringify({
          summary: 'Create the loop',
          files: [
            {
              path: 'app/for-loop.js',
              operation: 'create',
              content: 'for (let i = 1; i <= 10; i += 1) {}\n',
            },
          ],
        }),
      });
    const service = new AgentRunService(
      contextPort(),
      sessionPort(),
      { send },
      new SafeEditService(inMemoryWorkspace(files), async () => true),
    );

    await expect(
      service.run(
        {
          configuration,
          content: 'Create a JavaScript loop',
          contextMode: 'workspace',
          selection: {
            model: 'qwen2.5-coder',
            provider: 'OLLAMA',
            routingMode: 'MANUAL_MODEL',
          },
          signal: new AbortController().signal,
        },
        callbacks(),
      ),
    ).resolves.toMatchObject({ status: 'applied', threadId: 'thread-2' });
    expect(send).toHaveBeenCalledTimes(2);
    expect(send.mock.calls[1]?.[0]).toMatchObject({
      routingMode: 'MANUAL_MODEL',
    });
    expect(send.mock.calls[1]?.[0]).not.toHaveProperty('threadId');
    expect(files.has('app/for-loop.js')).toBe(true);
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
