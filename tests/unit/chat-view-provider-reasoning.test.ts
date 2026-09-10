import { describe, expect, it, vi } from 'vitest';

vi.mock('vscode', () => ({
  env: { language: 'en' },
  l10n: { t: (message: string) => message },
  Uri: {
    joinPath: (...segments: { path: string }[]) => ({
      path: segments.map((segment) => segment.path).join('/'),
      toString: () => segments.map((segment) => segment.path).join('/'),
    }),
  },
}));

import { ExtensionState } from '../../src/core/extension-state';
import { createRuntimeSnapshot } from '../../src/core/runtime/runtime-event-reducer';
import { ChatViewProvider } from '../../src/webview/chat-view-provider';

const CHAIN_OF_THOUGHT = 'First I will read the vault file, then quote its contents verbatim.';

function state(): ExtensionState {
  return new ExtensionState({
    agentMode: 'AUTO',
    viewDensity: 'full',
    effortMode: 'ULTRA',
    speedMode: '1X',
    agentRun: undefined,
    agentRuns: {},
    approvalRequest: undefined,
    questionRequest: undefined,
    findings: [],
    tasks: [],
    artifacts: [],
    organizationPolicy: undefined,
    backendStatus: 'connected',
    backendUrl: 'https://claw.local',
    busy: false,
    connected: true,
    contextReceipt: undefined,
    entitlements: undefined,
    generationQueue: { active: [], capacity: 2, pending: [] },
    history: [],
    lastError: undefined,
    modelWarnings: [],
    models: [],
    permissionMode: 'MANUAL',
    routingMode: 'MANUAL_MODEL',
    runtime: createRuntimeSnapshot(),
    selectedModel: 'OLLAMA:llama3',
    usage: undefined,
    user: { id: 'user-1' } as never,
    workspaceReadiness: undefined,
    workspaceScope: { folders: [] },
  });
}

function resolvedProvider(): { posted: Record<string, unknown>[]; provider: ChatViewProvider } {
  const posted: Record<string, unknown>[] = [];
  const provider = new ChatViewProvider({ path: '/ext' } as never, state(), {
    openThread: vi.fn(async () => undefined),
  } as never);
  provider.resolveWebviewView({
    webview: {
      asWebviewUri: (uri: { toString: () => string }) => uri,
      cspSource: 'vscode-webview://test',
      html: '',
      options: {},
      onDidReceiveMessage: vi.fn(),
      postMessage: async (message: Record<string, unknown>) => {
        posted.push(message);
        return true;
      },
    },
    onDidDispose: vi.fn(),
  } as never);
  posted.length = 0;
  return { posted, provider };
}

describe('ChatViewProvider.postEvent', () => {
  it('never lets a model private reasoning text reach the panel', async () => {
    const { posted, provider } = resolvedProvider();

    await provider.postEvent(
      { type: 'REASONING_DELTA', delta: CHAIN_OF_THOUGHT },
      '2f1b0c9e-1a2b-4c3d-8e4f-5a6b7c8d9e0f',
    );

    expect(JSON.stringify(posted)).not.toContain('vault');
    const [message] = posted;
    expect(message?.event).toEqual({
      type: 'REASONING_DELTA',
      redacted: true,
      deltaTokens: 17,
    });
  });

  it('leaves the answer stream alone so the panel still renders content', async () => {
    const { posted, provider } = resolvedProvider();

    await provider.postEvent(
      { type: 'CONTENT_DELTA', delta: 'the answer' },
      '2f1b0c9e-1a2b-4c3d-8e4f-5a6b7c8d9e0f',
    );

    expect(posted[0]?.event).toEqual({ type: 'CONTENT_DELTA', delta: 'the answer' });
  });
});
