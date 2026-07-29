import { platform } from 'node:process';

import { expect } from '@playwright/test';

import type { Page } from '@playwright/test';

export interface MockBridge {
  messages: unknown[];
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

export async function expectWindowsScreenshot(page: Page, name: string): Promise<void> {
  if (platform === 'win32') {
    await expect(page).toHaveScreenshot(name);
  }
}
