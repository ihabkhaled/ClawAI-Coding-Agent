import { describe, expect, it, vi } from 'vitest';

import { AgentRunService } from '../../src/services/agent-run-service';

import type { EditPlan } from '../../src/core/edit-plan';
import type {
  AgentRunChatPort,
  AgentRunEditPort,
  AgentRunSessionPort,
} from '../../src/services/agent-run-service.types';

const configuration = {
  agentMode: 'AUTO' as const,
  backendUrl: 'https://claw.local',
  exclude: [],
  historyLimit: 50,
  maxContextBytes: 200_000,
  maxContextFiles: 40,
  permissionMode: 'EDIT_AUTOMATICALLY' as const,
  requestTimeoutMs: 60_000,
  routingMode: 'AUTO' as const,
  selectedModel: 'AUTO',
};
const dockerPlan = JSON.stringify({
  summary: 'Inspect',
  files: [],
  commands: [{ command: 'docker ps', purpose: 'Inspect containers' }],
});

function service(chat: AgentRunChatPort, edits: AgentRunEditPort, authorizeCommands = true) {
  const session: AgentRunSessionPort = {
    authorize: vi.fn(async (operation) => operation !== 'commandExecution' || authorizeCommands),
    isPlanMode: () => false,
    preparePrompt: (content) => content,
  };
  return new AgentRunService(
    {
      resolve: () => 'workspace',
      collect: vi.fn(async () => ({
        files: [],
        receipt: { excluded: [], included: [], totalBytes: 0, truncated: false },
      })),
      projectRules: vi.fn(async () => ''),
    },
    session,
    chat,
    edits,
  );
}

function input() {
  return {
    configuration,
    content: 'Inspect Docker and fix it',
    contextMode: 'workspace' as const,
    selection: { routingMode: 'AUTO' as const },
    signal: new AbortController().signal,
  };
}

function callbacks(events: Record<string, unknown>[] = []) {
  return {
    onEvent: (event: Record<string, unknown>) => events.push(event),
    onPhase: vi.fn(),
    onThread: vi.fn(),
  };
}

function editPort(result = { exitCode: 0, stdout: '', stderr: '' }): AgentRunEditPort {
  return {
    execute: vi.fn(async () => result),
    previewAndApply: vi.fn(async (plan: EditPlan) => ({
      applied: true,
      previews: plan.files.map((file) => ({
        path: file.path,
        before: null,
        after: file.content ?? null,
      })),
    })),
  };
}

describe('AgentRunService Docker diagnostics', () => {
  it('feeds output back into a final file plan', async () => {
    const chat: AgentRunChatPort = {
      send: vi
        .fn()
        .mockResolvedValueOnce({
          threadId: 'thread-1',
          content: dockerPlan,
          tokens: { input: 2, output: 2, source: 'estimated', total: 4 },
        })
        .mockResolvedValueOnce({
          threadId: 'thread-1',
          content: JSON.stringify({
            summary: 'Fix',
            files: [{ path: 'app/fix.js', operation: 'create', content: 'export {};\n' }],
          }),
          tokens: { input: 3, output: 3, source: 'estimated', total: 6 },
        }),
    };
    const events: Record<string, unknown>[] = [];
    const result = await service(
      chat,
      editPort({ exitCode: 0, stdout: 'healthy', stderr: '' }),
    ).run(input(), callbacks(events));
    expect(result).toMatchObject({ status: 'applied', tokens: { total: 10 } });
    expect(events).toContainEqual(expect.objectContaining({ type: 'TOOL_OUTPUT' }));
    expect(vi.mocked(chat.send).mock.calls[1]?.[0].content).toContain('<tool-results>');
  });

  it('stops after two rounds', async () => {
    const chat: AgentRunChatPort = {
      send: vi.fn(async () => ({
        threadId: 'thread-1',
        content: dockerPlan,
        tokens: { input: 1, output: 1, source: 'estimated' as const, total: 2 },
      })),
    };
    const result = await service(chat, editPort()).run(input(), callbacks());
    expect(result.content).toContain('two-round diagnostic safety limit');
    expect(chat.send).toHaveBeenCalledTimes(3);
  });

  it('does not continue rejected diagnostics', async () => {
    const chat: AgentRunChatPort = {
      send: vi.fn(async () => ({
        threadId: 'thread-1',
        content: dockerPlan,
        tokens: { input: 1, output: 1, source: 'estimated' as const, total: 2 },
      })),
    };
    expect(await service(chat, editPort(), false).run(input(), callbacks())).toMatchObject({
      status: 'rejected',
    });
  });

  it('reports failed stderr diagnostics', async () => {
    const chat: AgentRunChatPort = {
      send: vi.fn(async () => ({
        threadId: 'thread-1',
        content: dockerPlan,
        tokens: { input: 1, output: 1, source: 'estimated' as const, total: 2 },
      })),
    };
    const events: Record<string, unknown>[] = [];
    const result = await service(
      chat,
      editPort({ exitCode: 1, stderr: 'not found', stdout: '' }),
    ).run(input(), callbacks(events));
    expect(result.commandError).toContain('exit code 1');
    expect(events).toContainEqual(
      expect.objectContaining({ type: 'TOOL_OUTPUT', description: 'not found' }),
    );
  });
});
