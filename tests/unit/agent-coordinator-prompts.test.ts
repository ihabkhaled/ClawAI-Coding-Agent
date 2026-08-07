import { describe, expect, it, vi } from 'vitest';

vi.mock('vscode', () => ({
  l10n: { t: (message: string) => message },
  window: {},
}));

import {
  currentModelSelection,
  modelSelectionLabel,
} from '../../src/services/agent-coordinator-prompts';

import type { ModelCatalogEntry } from '../../src/core/model-catalog';
import type { RuntimeConfiguration } from '../../src/services/configuration-service';

const configuration: RuntimeConfiguration = {
  agentMode: 'AUTO',
  effortMode: 'ULTRA',
  backendUrl: 'https://claw.local',
  exclude: [],
  historyLimit: 50,
  maxContextBytes: 200_000,
  maxContextFiles: 40,
  permissionMode: 'BYPASS_PERMISSIONS',
  requestTimeoutMs: 60_000,
  routingMode: 'MANUAL_MODEL',
  selectedModel: 'OLLAMA:gemma3:4b',
};

const models: ModelCatalogEntry[] = [
  {
    contextTokens: 8_192,
    displayName: 'Gemma 3 4B',
    id: 'gemma',
    isLocal: true,
    key: 'OLLAMA:gemma3:4b',
    model: 'gemma3:4b',
    provider: 'local-ollama',
    source: 'ollama',
    supportsStreaming: true,
    supportsStructuredOutput: true,
    supportsTools: true,
    supportsVision: false,
  },
  {
    contextTokens: 131_072,
    displayName: 'Qwen 3 32B',
    id: 'qwen',
    isLocal: true,
    key: 'OLLAMA:qwen3:32b',
    model: 'qwen3:32b',
    provider: 'local-ollama',
    source: 'ollama',
    supportsStreaming: true,
    supportsStructuredOutput: true,
    supportsTools: true,
    supportsVision: false,
  },
];

describe('request model selection', () => {
  it('uses the model snapshotted by the composer instead of stale persisted configuration', () => {
    expect(currentModelSelection(configuration, models, 'OLLAMA:qwen3:32b')).toEqual({
      model: 'qwen3:32b',
      provider: 'local-ollama',
      routingMode: 'MANUAL_MODEL',
    });
  });

  it('uses AUTO without mutating configuration when a persisted manual model disappeared', () => {
    expect(
      currentModelSelection(
        {
          ...configuration,
          routingMode: 'MANUAL_MODEL',
          selectedModel: 'OLLAMA:removed',
        },
        models,
      ),
    ).toEqual({ routingMode: 'AUTO' });
  });

  it('uses AUTO when the request snapshots AUTO even if persisted configuration is manual', () => {
    expect(currentModelSelection(configuration, models, 'AUTO')).toEqual({
      routingMode: 'AUTO',
    });
  });

  it('keeps the snapshotted model display label with the scheduled request', () => {
    expect(modelSelectionLabel(models, 'OLLAMA:qwen3:32b')).toBe('Qwen 3 32B');
    expect(modelSelectionLabel(models, 'AUTO')).toBe('Automatic routing');
  });
});
