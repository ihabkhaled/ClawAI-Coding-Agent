import { describe, expect, it, vi } from 'vitest';

vi.mock('vscode', () => ({
  l10n: { t: (message: string) => message },
}));

import { ExtensionState } from '../../src/core/extension-state';
import {
  cancelTargetGeneration,
  resetAccountScopedState,
} from '../../src/services/agent-coordinator-runtime';

describe('agent coordinator account boundary', () => {
  it('cancels only the targeted local and remote generation', async () => {
    const cancel = vi.fn(() => true);
    const takeThread = vi.fn(() => 'thread-b');
    const cancelStream = vi.fn(async () => undefined);

    await cancelTargetGeneration(
      cancel,
      takeThread,
      { cancelStream } as never,
      { warn: vi.fn() } as never,
    );

    expect(cancel).toHaveBeenCalledOnce();
    expect(takeThread).toHaveBeenCalledOnce();
    expect(cancelStream).toHaveBeenCalledWith('thread-b');
  });

  it('clears every account-scoped value while preserving workspace and local settings', () => {
    const state = new ExtensionState({
      agentMode: 'PLAN',
      agentRun: { phase: 'generating' } as never,
      agentRuns: {
        'request-a': { phase: 'generating' } as never,
      },
      approvalRequest: { id: 'approval-a' } as never,
      backendStatus: 'connected',
      backendUrl: 'https://claw.local',
      busy: true,
      connected: true,
      contextReceipt: { included: ['private.ts'] } as never,
      entitlements: { plan: { name: 'Pro' } } as never,
      generationQueue: {
        active: [
          {
            concurrencyKey: 'chat-a',
            id: 'request-a',
            kind: 'agent',
            modelLabel: 'Claude Sonnet',
            prompt: 'Inspect private.ts',
            startedAt: 1,
          },
        ],
        capacity: 2,
        pending: [
          {
            concurrencyKey: 'chat-a',
            id: 'request-b',
            kind: 'chat',
            modelLabel: 'Qwen 3',
            prompt: 'Continue',
          },
        ],
      },
      history: [{ id: 'thread-a', title: 'Private account thread' }] as never,
      lastError: 'old error',
      modelWarnings: ['ollama'],
      models: [{ key: 'OPENAI:private-model' }] as never,
      permissionMode: 'BYPASS_PERMISSIONS',
      routingMode: 'MANUAL_MODEL',
      selectedModel: 'OPENAI:private-model',
      usage: { day: { used: 99 } } as never,
      user: { id: 'account-a' } as never,
      workspaceReadiness: {
        hasActiveFile: true,
        hasSelection: false,
        hasWorkspace: true,
        trusted: true,
        workspaceName: 'ClawAI',
      },
      workspaceScope: {
        folders: [{ key: 'folder-a', name: 'ClawAI' }],
        selectedFolderKey: 'folder-a',
        selectedFolderName: 'ClawAI',
      },
    });
    resetAccountScopedState(state);

    expect(state.snapshot).toMatchObject({
      agentMode: 'PLAN',
      agentRun: undefined,
      agentRuns: {},
      approvalRequest: undefined,
      backendStatus: 'disconnected',
      backendUrl: 'https://claw.local',
      busy: false,
      connected: false,
      contextReceipt: undefined,
      entitlements: undefined,
      generationQueue: { active: [], capacity: 2, pending: [] },
      history: [],
      lastError: undefined,
      modelWarnings: [],
      models: [],
      permissionMode: 'BYPASS_PERMISSIONS',
      routingMode: 'AUTO',
      selectedModel: '',
      usage: undefined,
      user: undefined,
      workspaceScope: {
        folders: [{ key: 'folder-a', name: 'ClawAI' }],
        selectedFolderKey: 'folder-a',
      },
    });
  });
});
