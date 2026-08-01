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

  it('stores the selected model before exposing MANUAL_MODEL routing to observers', async () => {
    await new ConfigurationService().selectManual('OLLAMA:qwen3:coder');

    expect(vscodeConfiguration.updates).toEqual([
      'selectedModel:OLLAMA:qwen3:coder',
      'routingMode:MANUAL_MODEL',
    ]);
  });

  it('normalizes a legacy MANUAL workspace value when reading configuration', () => {
    vscodeConfiguration.values.set('routingMode', 'MANUAL');
    vscodeConfiguration.values.set('selectedModel', 'OLLAMA:qwen3:coder');

    expect(new ConfigurationService().read()).toMatchObject({
      routingMode: 'MANUAL_MODEL',
      selectedModel: 'OLLAMA:qwen3:coder',
    });
  });

  it('switches to AUTO before clearing the old manual model', async () => {
    await new ConfigurationService().selectAuto();

    expect(vscodeConfiguration.updates).toEqual(['routingMode:AUTO', 'selectedModel:']);
  });

  it('persists agent and permission modes after the workbench has approved them', async () => {
    const service = new ConfigurationService();

    await service.selectAgentMode('PLAN');
    await expect(service.selectPermissionMode('BYPASS_PERMISSIONS')).resolves.toBe(true);
    expect(vscodeConfiguration.updates).toEqual([
      'agentMode:PLAN',
      'permissionMode:BYPASS_PERMISSIONS',
    ]);
  });

  it('persists a normalized backend URL supplied by the in-extension connection gateway', async () => {
    await expect(
      new ConfigurationService().saveBackendUrl('https://claw.local/api/v1/'),
    ).resolves.toBe('https://claw.local');

    expect(vscodeConfiguration.updates).toEqual(['backendUrl:https://claw.local']);
  });

  it('uses the local ClawAI origin as the first-run default', () => {
    expect(new ConfigurationService().read()).toMatchObject({
      backendEnvironment: 'LOCAL',
      backendUrl: 'https://claw.local',
      frontendEnvironment: 'LOCAL',
      frontendUrl: 'https://claw.local',
    });
  });

  it('persists custom backend and frontend connection profiles before exposing them', async () => {
    await new ConfigurationService().saveConnectionProfile({
      backendEnvironment: 'CUSTOM',
      backendCustomUrl: 'https://api.example.com/',
      frontendEnvironment: 'CUSTOM',
      frontendCustomUrl: 'https://app.example.com/',
    });

    expect(vscodeConfiguration.updates).toEqual([
      'backendCustomUrl:https://api.example.com',
      'frontendCustomUrl:https://app.example.com',
      'backendEnvironment:CUSTOM',
      'frontendEnvironment:CUSTOM',
      'backendUrl:https://api.example.com',
    ]);
    expect(new ConfigurationService().read()).toMatchObject({
      backendEnvironment: 'CUSTOM',
      backendUrl: 'https://api.example.com',
      frontendEnvironment: 'CUSTOM',
      frontendUrl: 'https://app.example.com',
    });
  });

  it('keeps custom URLs available when switching back to local without exposing an invalid intermediate state', async () => {
    vscodeConfiguration.values.set('backendCustomUrl', 'https://api.example.com');
    vscodeConfiguration.values.set('frontendCustomUrl', 'https://app.example.com');

    await new ConfigurationService().saveConnectionProfile({
      backendEnvironment: 'LOCAL',
      backendCustomUrl: '',
      frontendEnvironment: 'LOCAL',
      frontendCustomUrl: '',
    });

    expect(vscodeConfiguration.updates.slice(0, 2)).toEqual([
      'backendCustomUrl:https://api.example.com',
      'frontendCustomUrl:https://app.example.com',
    ]);
  });
});
