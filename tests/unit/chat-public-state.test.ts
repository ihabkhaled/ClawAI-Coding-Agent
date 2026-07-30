import { describe, expect, it } from 'vitest';

import { toPublicChatState } from '../../src/webview/chat-public-state';

import type { ExtensionSnapshot } from '../../src/core/extension-state';

const snapshot: ExtensionSnapshot = {
  agentRun: {
    files: [{ operation: 'update', path: 'src/app.ts' }],
    phase: 'reviewing',
    summary: 'Update the app',
  },
  agentRuns: {
    'request-1': {
      files: [{ operation: 'update', path: 'src/app.ts' }],
      phase: 'reviewing',
      summary: 'Update the app',
    },
  },
  agentMode: 'PLAN',
  approvalRequest: undefined,
  backendStatus: 'connected',
  backendUrl: 'https://claw.local',
  busy: false,
  connected: true,
  generationQueue: {
    active: [
      {
        concurrencyKey: 'chat-a',
        id: 'request-1',
        kind: 'agent',
        modelLabel: 'Claude Sonnet',
        prompt: 'Create a file',
        startedAt: 1,
      },
    ],
    capacity: 2,
    pending: [
      {
        concurrencyKey: 'chat-a',
        id: 'request-2',
        kind: 'chat',
        modelLabel: 'Qwen 3',
        prompt: 'Explain the result',
      },
    ],
  },
  contextReceipt: {
    excluded: [{ path: '.env', reason: 'sensitive' }],
    included: ['src/app.ts'],
    totalBytes: 42,
    truncated: false,
  },
  entitlements: undefined,
  history: [
    {
      _count: { messages: 3 },
      createdAt: new Date('2026-07-29T10:00:00.000Z'),
      id: 'thread-1',
      preferredModel: 'secret-model-choice',
      preferredProvider: 'SECRET_PROVIDER',
      routingMode: 'MANUAL_MODEL',
      title: 'Create loop file',
      updatedAt: '2026-07-29T10:05:00.000Z',
    },
  ],
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
  it('exposes the workbench state and sanitized conversation history needed by the webview', () => {
    expect(toPublicChatState(snapshot)).toMatchObject({
      agentRun: {
        files: [{ operation: 'update', path: 'src/app.ts' }],
        phase: 'reviewing',
      },
      agentMode: 'PLAN',
      backendStatus: 'connected',
      history: [
        {
          createdAt: '2026-07-29T10:00:00.000Z',
          id: 'thread-1',
          messageCount: 3,
          title: 'Create loop file',
          updatedAt: '2026-07-29T10:05:00.000Z',
        },
      ],
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
    expect(toPublicChatState(snapshot).history[0]).not.toHaveProperty('preferredProvider');
    expect(toPublicChatState(snapshot).history[0]).not.toHaveProperty('preferredModel');
  });
});
