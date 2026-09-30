import { describe, expect, it, vi } from 'vitest';

const captured = vi.hoisted(() => ({ policy: undefined as undefined | (() => unknown) }));

vi.mock('../../src/services/remote-control-commands', () => ({
  registerRemoteControlCommands: () => [],
}));
vi.mock('../../src/services/integration-registration', () => ({
  registerIntegrations: (_c: unknown, _s: unknown, _b: unknown, warn: (m: string) => void) => {
    warn('integration note');
  },
}));
vi.mock('../../src/services/register-plugin-commands', () => ({
  registerPluginCommands: (_context: unknown, _scope: unknown, policy: () => unknown) => {
    captured.policy = policy;
  },
}));

const { organizationPolicySchema } = await import('../../src/backend/contracts');
const { registerConnectedCommands } =
  await import('../../src/services/register-connected-commands');

const basePolicy = {
  allowedTools: [],
  allowedModels: [],
  maximumRisk: 'R4',
  deniedEffects: [],
  requireApproval: [],
  maximumRetentionDays: 30,
  minimumPermissionMode: null,
};

describe('organization marketplace allowlist', () => {
  it('survives the strict organization policy contract, whatever its shape', () => {
    expect(
      organizationPolicySchema.parse({ ...basePolicy, allowedPluginMarketplaces: ['https://m'] })
        .allowedPluginMarketplaces,
    ).toEqual(['https://m']);
    expect(
      organizationPolicySchema.safeParse({ ...basePolicy, allowedPluginMarketplaces: 7 }).success,
    ).toBe(true);
  });

  it('reaches the plugin commands from the live snapshot', () => {
    const state = {
      snapshot: { organizationPolicy: { allowedPluginMarketplaces: ['https://m'] } },
    };
    const warn = vi.fn();
    registerConnectedCommands({
      context: { subscriptions: [], secrets: {} },
      state,
      backend: {},
      logger: { warn },
      workspaceScope: {},
      version: '1.0.0',
    } as never);

    expect(captured.policy?.()).toEqual(['https://m']);
    expect(warn).toHaveBeenCalledWith('integration note');
    state.snapshot = { organizationPolicy: undefined } as never;
    expect(captured.policy?.()).toBeUndefined();
  });
});
