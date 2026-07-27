import { describe, expect, it, vi } from 'vitest';

import { ModelService, type ModelBackendPort } from '../../src/services/model-service';

const routerModel = {
  id: 'router-1',
  provider: 'OLLAMA',
  modelKey: 'qwen3-coder',
  displayName: 'Qwen 3 Coder',
  isLocal: true,
  isExecutionCapable: true,
  lifecycle: 'ACTIVE',
};

function entitlement(
  override: {
    isAdmin?: boolean;
    allowedProviders?: string[];
    allowedModels?: {
      provider: string;
      model: string;
      isAllowed: boolean;
      allowAsPrimary: boolean;
      allowAsFallback: boolean;
      allowAsJudge: boolean;
      allowInCompare: boolean;
      dailyTokenLimitOverride: number | null;
    }[];
  } = {},
) {
  return {
    userId: 'user-1',
    role: 'USER',
    isAdmin: override.isAdmin ?? false,
    permissions: [],
    plan: null,
    allowedModels: override.allowedModels ?? [],
    allowedProviders: override.allowedProviders ?? [],
    quota: {
      dailyLimit: 10_000,
      used: 100,
      remaining: 9_900,
      unlimited: false,
    },
  };
}

function backendFor(entitlements: ReturnType<typeof entitlement>): ModelBackendPort {
  return {
    getRouterModels: vi.fn(async () => [routerModel]),
    getConnectorModels: vi.fn(async () => []),
    getEntitlements: vi.fn(async () => entitlements),
  };
}

describe('ModelService', () => {
  it('keeps the catalog unrestricted for admins and unrestricted plans', async () => {
    await expect(
      new ModelService(backendFor(entitlement({ isAdmin: true }))).refresh(),
    ).resolves.toMatchObject({
      catalog: [{ key: 'OLLAMA:qwen3-coder' }],
    });
    await expect(new ModelService(backendFor(entitlement())).refresh()).resolves.toMatchObject({
      catalog: [{ key: 'OLLAMA:qwen3-coder' }],
    });
  });

  it('applies primary-model grants while treating an empty provider list as unrestricted', async () => {
    const allowedModel = {
      provider: 'OLLAMA',
      model: 'qwen3-coder',
      isAllowed: true,
      allowAsPrimary: true,
      allowAsFallback: true,
      allowAsJudge: true,
      allowInCompare: true,
      dailyTokenLimitOverride: null,
    };

    const service = new ModelService(
      backendFor(entitlement({ allowedModels: [allowedModel], allowedProviders: [] })),
    );
    await expect(service.refresh()).resolves.toMatchObject({
      catalog: [{ key: 'OLLAMA:qwen3-coder' }],
    });

    service.setBackend(
      backendFor(entitlement({ allowedModels: [allowedModel], allowedProviders: ['OPENAI'] })),
    );
    await expect(service.refresh()).resolves.toMatchObject({ catalog: [] });
  });
});
