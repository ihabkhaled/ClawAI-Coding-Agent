import { describe, expect, it, vi } from 'vitest';

import { AgentRunService } from '../../src/services/agent-run-service';
import { SafeEditService } from '../../src/services/safe-edit-service';

import type {
  AgentRunChatPort,
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

describe('AgentRunService malformed model repair', () => {
  it('retries one explicit empty provider response before parsing the edit plan', async () => {
    const send = vi
      .fn<AgentRunChatPort['send']>()
      .mockRejectedValueOnce(
        new Error(
          'Cloud provider OLLAMA returned no message content (CLOUD_PROVIDER_EMPTY_RESPONSE)',
        ),
      )
      .mockResolvedValueOnce({
        threadId: 'thread-1',
        content: JSON.stringify({ summary: 'No change needed', files: [], commands: [] }),
        tokens: { input: 1, output: 1, source: 'estimated', total: 2 },
      });
    const events: Record<string, unknown>[] = [];
    const service = new AgentRunService(
      {
        resolve: () => 'workspace',
        collect: vi.fn(async () => ({
          files: [],
          receipt: { excluded: [], included: [], totalBytes: 0, truncated: false },
        })),
        projectRules: vi.fn(async () => ''),
      },
      {
        authorize: vi.fn(async () => true),
        isPlanMode: () => false,
        preparePrompt: (content) => content,
      },
      { send },
      { execute: vi.fn(), previewAndApply: vi.fn() },
    );

    await expect(
      service.run(
        {
          configuration,
          content: 'Inspect one file',
          contextMode: 'workspace',
          selection: {
            model: 'qwen2.5-coder',
            provider: 'OLLAMA',
            routingMode: 'MANUAL_MODEL',
          },
          signal: new AbortController().signal,
        },
        { onEvent: (event) => events.push(event), onPhase: vi.fn(), onThread: vi.fn() },
      ),
    ).resolves.toMatchObject({ status: 'planned', content: 'No change needed' });
    expect(send).toHaveBeenCalledTimes(2);
    expect(send.mock.calls[1]?.[0]).toEqual(send.mock.calls[0]?.[0]);
    expect(events).toContainEqual({ type: 'AGENT_DRAFT_RESET' });
  });

  it('propagates a second empty provider response without starting a retry loop', async () => {
    const empty = new Error(
      'Cloud provider OLLAMA returned no message content (CLOUD_PROVIDER_EMPTY_RESPONSE)',
    );
    const send = vi.fn<AgentRunChatPort['send']>().mockRejectedValue(empty);
    const service = new AgentRunService(
      {
        resolve: () => 'workspace',
        collect: vi.fn(async () => ({
          files: [],
          receipt: { excluded: [], included: [], totalBytes: 0, truncated: false },
        })),
        projectRules: vi.fn(async () => ''),
      },
      {
        authorize: vi.fn(async () => true),
        isPlanMode: () => false,
        preparePrompt: (content) => content,
      },
      { send },
      { execute: vi.fn(), previewAndApply: vi.fn() },
    );

    await expect(
      service.run(
        {
          configuration,
          content: 'Inspect one file',
          contextMode: 'workspace',
          selection: {
            model: 'qwen2.5-coder',
            provider: 'OLLAMA',
            routingMode: 'MANUAL_MODEL',
          },
          signal: new AbortController().signal,
        },
        { onEvent: vi.fn(), onPhase: vi.fn(), onThread: vi.fn() },
      ),
    ).rejects.toBe(empty);
    expect(send).toHaveBeenCalledTimes(2);
  });

  it('repairs one malformed response in the original thread and aggregates usage', async () => {
    const files = new Map<string, string>();
    const phases: AgentRunSnapshot[] = [];
    const events: Record<string, unknown>[] = [];
    const send = vi
      .fn<AgentRunChatPort['send']>()
      .mockResolvedValueOnce({
        threadId: 'thread-1',
        tokens: { input: 1, output: 1, source: 'estimated', total: 2 },
        content: JSON.stringify({
          summary: 'Production-ready code',
          files: [
            {
              path: '.gitattributes',
              operation: 'create | update | delete',
              content: 'No changes required.',
            },
          ],
        }),
      })
      .mockResolvedValueOnce({
        threadId: 'thread-1',
        tokens: { input: 1, output: 1, source: 'estimated', total: 2 },
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
      {
        resolve: () => 'workspace',
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
      },
      {
        authorize: vi.fn(async () => true),
        isPlanMode: () => false,
        preparePrompt: (content) => content,
      },
      { send },
      new SafeEditService(
        {
          isTrusted: () => true,
          preview: async (plan) => ({
            workspaceFolderUri: 'memory:///workspace',
            previews: plan.files.map((file) => ({
              path: file.path,
              before: files.get(file.path) ?? null,
              after: file.operation === 'delete' ? null : (file.content ?? null),
            })),
          }),
          applyAtomically: async (plan) => {
            for (const file of plan.files) {
              if (file.operation === 'delete') {
                files.delete(file.path);
              } else {
                files.set(file.path, file.content ?? '');
              }
            }
            return true;
          },
        },
        async () => true,
      ),
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
        {
          onEvent: (event) => events.push(event),
          onPhase: (phase) => phases.push(phase),
          onThread: vi.fn(),
        },
      ),
    ).resolves.toMatchObject({
      status: 'applied',
      threadId: 'thread-1',
      tokens: { input: 2, output: 2, source: 'estimated', total: 4 },
    });
    expect(send).toHaveBeenCalledTimes(2);
    expect(send.mock.calls[1]?.[0]).toMatchObject({
      routingMode: 'MANUAL_MODEL',
      threadId: 'thread-1',
    });
    expect(send.mock.calls[1]?.[0].content).toContain(
      'Original user request: Create a JavaScript loop',
    );
    expect(send.mock.calls[1]?.[0].content.split('<previous-response>')[0]).not.toContain(
      '"operation":"create | update | delete"',
    );
    expect(files.has('app/for-loop.js')).toBe(true);
    expect(phases.map((phase) => phase.phase)).toContain('repairing');
    expect(events).toContainEqual({ type: 'AGENT_DRAFT_RESET' });
  });
});
