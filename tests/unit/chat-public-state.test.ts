import { describe, expect, it } from 'vitest';

import { toPublicChatState } from '../../src/webview/chat-public-state';

import type { ExtensionSnapshot } from '../../src/core/extension-state';

const snapshot: ExtensionSnapshot = {
  agentMode: 'PLAN',
  backendStatus: 'connected',
  backendUrl: 'https://claw.local',
  busy: false,
  connected: true,
  contextReceipt: {
    excluded: [{ path: '.env', reason: 'sensitive' }],
    included: ['src/app.ts'],
    totalBytes: 42,
    truncated: false,
  },
  entitlements: undefined,
  history: [],
  lastError: undefined,
  models: [],
  modelWarnings: ['Ollama is unavailable'],
  permissionMode: 'MANUAL',
  routingMode: 'AUTO',
  selectedModel: '',
  usage: undefined,
  user: undefined,
  workspaceReadiness: {
    hasActiveFile: false,
    hasSelection: false,
    hasWorkspace: true,
    trusted: true,
    workspaceName: 'ClawAI',
  },
  workspaceScope: {
    folders: [
      { key: 'api-key', name: 'api' },
      { key: 'web-key', name: 'web' },
    ],
    selectedFolderKey: 'web-key',
    selectedFolderName: 'web',
  },
};

describe('toPublicChatState', () => {
  it('exposes the workbench state needed by the webview without conversation history', () => {
    expect(toPublicChatState(snapshot)).toMatchObject({
      agentMode: 'PLAN',
      backendStatus: 'connected',
      modelWarnings: ['Ollama is unavailable'],
      permissionMode: 'MANUAL',
      workspaceReadiness: {
        hasActiveFile: false,
        hasWorkspace: true,
        trusted: true,
        workspaceName: 'ClawAI',
      },
      workspaceScope: {
        folders: [
          { key: 'api-key', name: 'api' },
          { key: 'web-key', name: 'web' },
        ],
        selectedFolderKey: 'web-key',
      },
    });
    expect(toPublicChatState(snapshot)).not.toHaveProperty('history');
  });
});
