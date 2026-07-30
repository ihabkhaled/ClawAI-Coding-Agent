import { describe, expect, it, vi } from 'vitest';

vi.mock('vscode', () => ({
  l10n: {
    t: (message: string) => message,
  },
}));

import { statusBarText } from '../../src/views/status-bar-controller';

import type { ExtensionSnapshot } from '../../src/core/extension-state';

function snapshot(patch: Partial<ExtensionSnapshot> = {}): ExtensionSnapshot {
  return {
    agentMode: 'AUTO',
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
    models: [],
    modelWarnings: [],
    permissionMode: 'MANUAL',
    routingMode: 'AUTO',
    selectedModel: '',
    usage: undefined,
    user: undefined,
    workspaceReadiness: undefined,
    workspaceScope: { folders: [] },
    ...patch,
  };
}

describe('statusBarText', () => {
  it('offers connection instead of advertising an unavailable model route', () => {
    expect(statusBarText(snapshot())).toContain('ClawAI · Connect');
    expect(statusBarText(snapshot())).not.toContain('AUTO');
  });

  it('shows authorization progress before switching to the connected route', () => {
    expect(statusBarText(snapshot({ backendStatus: 'loading' }))).toContain('Connecting');
    expect(
      statusBarText(
        snapshot({
          backendStatus: 'connected',
          connected: true,
          models: [
            {
              contextTokens: 8_192,
              displayName: 'Qwen Coder',
              id: 'qwen',
              isLocal: true,
              key: 'OLLAMA:qwen',
              model: 'qwen',
              provider: 'OLLAMA',
              source: 'ollama',
              supportsStreaming: true,
              supportsStructuredOutput: true,
              supportsTools: true,
              supportsVision: false,
            },
          ],
          routingMode: 'MANUAL_MODEL',
          selectedModel: 'OLLAMA:qwen',
        }),
      ),
    ).toContain('Qwen Coder');
  });
});
