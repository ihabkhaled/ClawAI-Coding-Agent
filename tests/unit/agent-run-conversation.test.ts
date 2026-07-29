import { describe, expect, it, vi } from 'vitest';

import { AgentRunService } from '../../src/services/agent-run-service';

import type { RuntimeConfiguration } from '../../src/services/configuration-service';

const configuration: RuntimeConfiguration = {
  agentMode: 'AUTO',
  backendUrl: 'https://claw.local',
  exclude: [],
  historyLimit: 50,
  maxContextBytes: 200_000,
  maxContextFiles: 40,
  permissionMode: 'MANUAL',
  requestTimeoutMs: 60_000,
  routingMode: 'MANUAL_MODEL',
  selectedModel: 'OLLAMA:qwen2.5-coder:0.5b',
};

describe('AgentRunService conversational requests', () => {
  it('answers a greeting without reading or changing the workspace', async () => {
    const collect = vi.fn();
    const authorize = vi.fn();
    const previewAndApply = vi.fn();
    const send = vi.fn(async () => ({
      threadId: 'thread-greeting',
      content: 'Hi! How can I help?',
    }));
    const service = new AgentRunService(
      {
        resolve: vi.fn((): 'workspace' => 'workspace'),
        collect,
        projectRules: vi.fn(async () => ''),
      },
      {
        authorize,
        isPlanMode: () => false,
        preparePrompt: (content) => content,
      },
      {
        send,
      },
      {
        execute: vi.fn(async () => ({ exitCode: 0 })),
        previewAndApply,
      },
    );

    await expect(
      service.run(
        {
          configuration,
          content: 'say hi',
          contextMode: 'smart',
          selection: {
            model: 'qwen2.5-coder:0.5b',
            provider: 'OLLAMA',
            routingMode: 'MANUAL_MODEL',
          },
          signal: new AbortController().signal,
        },
        {
          onEvent: vi.fn(),
          onPhase: vi.fn(),
          onThread: vi.fn(),
        },
      ),
    ).resolves.toMatchObject({
      status: 'planned',
      content: 'Hi! How can I help?',
      context: {
        files: [],
        receipt: {
          included: [],
          excluded: [],
          totalBytes: 0,
          truncated: false,
        },
      },
      threadId: 'thread-greeting',
    });
    expect(send).toHaveBeenCalledWith(
      expect.objectContaining({ content: 'say hi' }),
      expect.any(Function),
      expect.any(AbortSignal),
      expect.any(Function),
    );
    expect(collect).not.toHaveBeenCalled();
    expect(authorize).not.toHaveBeenCalled();
    expect(previewAndApply).not.toHaveBeenCalled();
  });
});
