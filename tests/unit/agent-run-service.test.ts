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

describe('AgentRunService', () => {
  it('turns the exact coding prompt into an approved workspace file change', async () => {
    const prompt = 'write for loop from 1 to 10 in file .js inside folder app';
    const files = new Map<string, string>();
    const chat: AgentRunChatPort = {
      send: vi.fn(async () => ({
        threadId: 'thread-1',
        tokens: { input: 1, output: 1, source: 'estimated' as const, total: 2 },
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
      'validating',
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

  it('runs command-only verification plans without applying an empty workspace edit', async () => {
    const execute = vi.fn(async () => ({ exitCode: 0 }));
    const applyAtomically = vi.fn(async () => true);
    const service = new AgentRunService(
      contextPort(),
      sessionPort(),
      textChat(
        JSON.stringify({
          summary: 'Verify the generated loop',
          files: [],
          commands: [{ command: 'node app/for-loop.js', purpose: 'Verify the output' }],
        }),
      ),
      new SafeEditService(
        {
          applyAtomically,
          execute,
          isTrusted: () => true,
          preview: async () => ({
            workspaceFolderUri: 'memory:///workspace',
            previews: [],
          }),
        },
        async () => true,
      ),
    );

    await expect(
      service.run(
        {
          configuration,
          content: 'Run the generated loop',
          contextMode: 'workspace',
          selection: { routingMode: 'AUTO' },
          signal: new AbortController().signal,
        },
        callbacks(),
      ),
    ).resolves.toMatchObject({
      status: 'applied',
      commandsExecuted: true,
      filesApplied: false,
    });
    expect(applyAtomically).not.toHaveBeenCalled();
    expect(execute).toHaveBeenCalledWith(
      expect.objectContaining({ command: 'node app/for-loop.js' }),
      expect.any(AbortSignal),
    );
  });

  it('reports a rejected command-only plan when command approval is declined', async () => {
    const execute = vi.fn();
    const service = new AgentRunService(
      contextPort(),
      sessionPort({
        authorize: vi.fn(async (operation) => operation !== 'commandExecution'),
      }),
      textChat(
        JSON.stringify({
          summary: 'Verify the generated loop',
          files: [],
          commands: [{ command: 'node app/for-loop.js', purpose: 'Verify the output' }],
        }),
      ),
      new SafeEditService(
        {
          applyAtomically: vi.fn(async () => true),
          execute,
          isTrusted: () => true,
          preview: async () => ({
            workspaceFolderUri: 'memory:///workspace',
            previews: [],
          }),
        },
        async () => true,
      ),
    );

    await expect(
      service.run(
        {
          configuration,
          content: 'Run the generated loop',
          contextMode: 'workspace',
          selection: { routingMode: 'AUTO' },
          signal: new AbortController().signal,
        },
        callbacks(),
      ),
    ).resolves.toMatchObject({
      status: 'rejected',
      commandsExecuted: false,
      filesApplied: false,
    });
    expect(execute).not.toHaveBeenCalled();
  });

  it('preserves an applied file receipt when a reviewed command fails', async () => {
    const files = new Map<string, string>();
    const service = new AgentRunService(
      contextPort(),
      sessionPort(),
      textChat(
        JSON.stringify({
          summary: 'Create and verify a file',
          files: [{ path: 'app/a.js', operation: 'create', content: 'export {};\n' }],
          commands: [{ command: 'npm test', purpose: 'Run tests' }],
        }),
      ),
      new SafeEditService(
        {
          ...inMemoryWorkspace(files),
          execute: vi.fn(async () => ({ exitCode: 1 })),
        },
        async () => true,
      ),
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
    ).resolves.toMatchObject({
      status: 'applied',
      commandsExecuted: false,
      commandError: expect.stringContaining('exit code 1'),
      filesApplied: true,
    });
    expect(files.get('app/a.js')).toBe('export {};\n');
  });

  it('reports partial completion when the second command-only verification fails', async () => {
    const execute = vi
      .fn()
      .mockResolvedValueOnce({ exitCode: 0 })
      .mockResolvedValueOnce({ exitCode: 1 });
    const service = new AgentRunService(
      contextPort(),
      sessionPort(),
      textChat(
        JSON.stringify({
          summary: 'Run both verification commands',
          files: [],
          commands: [
            { command: 'npm run lint', purpose: 'Check lint' },
            { command: 'npm test', purpose: 'Run tests' },
          ],
        }),
      ),
      new SafeEditService(
        {
          ...inMemoryWorkspace(new Map()),
          execute,
        },
        async () => true,
      ),
    );

    await expect(
      service.run(
        {
          configuration,
          content: 'Run the checks',
          contextMode: 'workspace',
          selection: { routingMode: 'AUTO' },
          signal: new AbortController().signal,
        },
        callbacks(),
      ),
    ).resolves.toMatchObject({
      commandError: expect.stringContaining('npm test'),
      commandsCompleted: 1,
      commandsExecuted: false,
      commandsTotal: 2,
      filesApplied: false,
      status: 'applied',
    });
    expect(execute).toHaveBeenCalledTimes(2);
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
    ).resolves.toMatchObject({
      status: 'applied',
      commandsExecuted: false,
      filesApplied: true,
    });
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

  it('returns a conversational no-op plan as an assistant reply without editing files', async () => {
    const applyAtomically = vi.fn(async () => true);
    const service = new AgentRunService(
      contextPort(),
      sessionPort(),
      textChat('Hi! How can I help with your code?'),
      new SafeEditService(
        {
          applyAtomically,
          isTrusted: () => true,
          preview: async () => ({
            workspaceFolderUri: 'memory:///workspace',
            previews: [],
          }),
        },
        async () => true,
      ),
    );
    const phases: AgentRunSnapshot[] = [];

    await expect(
      service.run(
        {
          configuration,
          content: 'say hi',
          contextMode: 'smart',
          selection: { routingMode: 'AUTO' },
          signal: new AbortController().signal,
        },
        callbacks(phases),
      ),
    ).resolves.toMatchObject({
      status: 'planned',
      content: 'Hi! How can I help with your code?',
    });
    expect(applyAtomically).not.toHaveBeenCalled();
    expect(phases.map((phase) => phase.phase)).toEqual(['generating', 'planned']);
  });
});
