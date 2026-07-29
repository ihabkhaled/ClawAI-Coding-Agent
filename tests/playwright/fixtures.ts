import { platform } from 'node:process';

import { expect } from '@playwright/test';

import type { Page } from '@playwright/test';

export interface MockBridge {
  messages: unknown[];
  state: unknown;
  send(message: unknown): void;
}

export const localModel = {
  contextTokens: 8192,
  displayName: 'Qwen 2.5 Coder 7B',
  id: 'ollama-qwen',
  isLocal: true,
  key: 'OLLAMA:qwen2.5-coder:7b',
  model: 'qwen2.5-coder:7b',
  provider: 'OLLAMA',
  source: 'ollama',
  supportsStreaming: true,
  supportsStructuredOutput: true,
  supportsTools: true,
  supportsVision: false,
};

export function baseState() {
  return {
    agentRun: undefined,
    agentMode: 'AUTO',
    approvalRequest: undefined,
    backendStatus: 'connected',
    backendUrl: 'https://claw.local',
    busy: false,
    connected: true,
    contextReceipt: undefined,
    entitlements: undefined,
    generationQueue: {
      active: undefined,
      pending: [],
    },
    history: [],
    lastError: undefined,
    models: [localModel],
    modelWarnings: [],
    permissionMode: 'MANUAL',
    routingMode: 'AUTO',
    selectedModel: '',
    usage: undefined,
    user: { email: 'developer@claw.local', id: 'user-1' },
    workspaceReadiness: {
      hasActiveFile: false,
      hasSelection: false,
      hasWorkspace: true,
      trusted: true,
      workspaceName: 'ClawAI',
    },
    workspaceScope: {
      folders: [{ key: 'workspace-key', name: 'ClawAI' }],
      selectedFolderKey: 'workspace-key',
      selectedFolderName: 'ClawAI',
    },
  };
}

export async function expectWindowsScreenshot(page: Page, name: string): Promise<void> {
  if (platform === 'win32') {
    await expect(page).toHaveScreenshot(name);
  }
}

export async function sendState(page: Page, patch: Record<string, unknown> = {}): Promise<void> {
  await page.evaluate(
    (state) => {
      window.__clawMock.send({ type: 'state', state });
    },
    Object.assign(baseState(), patch),
  );
}
