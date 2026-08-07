import { describe, expect, it, vi } from 'vitest';

import { AgentRunService } from '../../src/services/agent-run-service';

import type {
  AgentRunCallbacks,
  AgentRunContextPort,
  AgentRunSessionPort,
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
  permissionMode: 'MANUAL',
  requestTimeoutMs: 60_000,
  routingMode: 'AUTO',
  selectedModel: '',
};

const context: AgentRunContextPort = {
  collect: vi.fn(async () => ({
    files: [],
    receipt: { excluded: [], included: [], totalBytes: 0, truncated: false },
  })),
  projectRules: vi.fn(async () => ''),
  resolve: () => 'workspace',
};

const session: AgentRunSessionPort = {
  authorize: vi.fn(async () => true),
  isPlanMode: () => false,
  preparePrompt: (content) => content,
};

const callbacks: AgentRunCallbacks = {
  onEvent: vi.fn(),
  onPhase: vi.fn(),
  onThread: vi.fn(),
};

describe('AgentRunService commit cancellation', () => {
  it('returns an applied receipt and skips commands when cancellation races a commit', async () => {
    let finishApply: ((result: { applied: true; previews: [] }) => void) | undefined;
    const edits = {
      execute: vi.fn(),
      previewAndApply: vi.fn(
        () =>
          new Promise<{ applied: true; previews: [] }>((resolve) => {
            finishApply = resolve;
          }),
      ),
    };
    const controller = new AbortController();
    const service = new AgentRunService(
      context,
      session,
      {
        send: vi.fn(async () => ({
          content: JSON.stringify({
            summary: 'Create and verify a file',
            files: [{ path: 'app/a.js', operation: 'create', content: 'export {};\n' }],
            commands: [{ command: 'npm test', purpose: 'Run tests' }],
          }),
          threadId: 'thread-1',
          tokens: { input: 1, output: 1, source: 'estimated' as const, total: 2 },
        })),
      },
      edits,
    );
    const running = service.run(
      {
        configuration,
        content: 'Create and test a file',
        contextMode: 'workspace',
        selection: { routingMode: 'AUTO' },
        signal: controller.signal,
      },
      callbacks,
    );
    await vi.waitFor(() => {
      expect(edits.previewAndApply).toHaveBeenCalledOnce();
    });

    controller.abort(new Error('Workspace changed.'));
    finishApply?.({ applied: true, previews: [] });

    await expect(running).resolves.toMatchObject({ status: 'applied' });
    expect(edits.execute).not.toHaveBeenCalled();
  });

  it('returns the applied receipt when cancellation arrives during a post-edit command', async () => {
    let finishCommand: (() => void) | undefined;
    const commandFinished = new Promise<void>((resolve) => {
      finishCommand = resolve;
    });
    const edits = {
      execute: vi.fn(async () => {
        await commandFinished;
        return { exitCode: 0 };
      }),
      previewAndApply: vi.fn(async () => ({ applied: true as const, previews: [] })),
    };
    const controller = new AbortController();
    const service = new AgentRunService(
      context,
      session,
      {
        send: vi.fn(async () => ({
          content: JSON.stringify({
            summary: 'Create and verify a file',
            files: [{ path: 'app/a.js', operation: 'create', content: 'export {};\n' }],
            commands: [{ command: 'npm test', purpose: 'Run tests' }],
          }),
          threadId: 'thread-1',
          tokens: { input: 1, output: 1, source: 'estimated' as const, total: 2 },
        })),
      },
      edits,
    );
    const running = service.run(
      {
        configuration,
        content: 'Create and test a file',
        contextMode: 'workspace',
        selection: { routingMode: 'AUTO' },
        signal: controller.signal,
      },
      callbacks,
    );
    await vi.waitFor(() => {
      expect(edits.execute).toHaveBeenCalledOnce();
    });

    controller.abort(new Error('Workspace changed.'));
    finishCommand?.();

    await expect(running).resolves.toMatchObject({
      status: 'applied',
      commandsExecuted: false,
      commandError: 'Workspace changed.',
      filesApplied: true,
    });
  });
});
