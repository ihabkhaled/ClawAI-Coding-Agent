import { beforeEach, describe, expect, it, vi } from 'vitest';

const vscodeConfiguration = vi.hoisted(() => {
  const values = new Map<string, unknown>();
  const updates: string[] = [];
  return {
    updates,
    values,
    configuration: {
      get: (key: string): unknown => values.get(key),
      inspect: vi.fn(),
      update: vi.fn(async (key: string, value: unknown) => {
        updates.push(`${key}:${String(value)}`);
        values.set(key, value);
      }),
    },
  };
});

vi.mock('vscode', () => ({
  ConfigurationTarget: {
    Global: 1,
    Workspace: 2,
  },
  l10n: {
    t: (message: string) => message,
  },
  window: {
    showInputBox: vi.fn(),
  },
  workspace: {
    getConfiguration: () => vscodeConfiguration.configuration,
  },
}));

import { ConfigurationService } from '../../src/services/configuration-service';

describe('ConfigurationService model selection', () => {
  beforeEach(() => {
    vscodeConfiguration.updates.length = 0;
    vscodeConfiguration.values.clear();
    vi.clearAllMocks();
  });

  it('stores the selected model before exposing MANUAL routing to observers', async () => {
    await new ConfigurationService().selectManual('OLLAMA:qwen3:coder');

    expect(vscodeConfiguration.updates).toEqual([
      'selectedModel:OLLAMA:qwen3:coder',
      'routingMode:MANUAL',
    ]);
  });

  it('switches to AUTO before clearing the old manual model', async () => {
    await new ConfigurationService().selectAuto();

    expect(vscodeConfiguration.updates).toEqual(['routingMode:AUTO', 'selectedModel:']);
  });
});
