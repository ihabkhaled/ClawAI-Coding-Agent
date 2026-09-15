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

function backendFor(
  entitlements: ReturnType<typeof entitlement>,
  organizationPolicy?: { allowedModels: string[] },
): ModelBackendPort {
  return {
    getRouterModels: vi.fn(async () => [routerModel]),
    getConnectorModels: vi.fn(async () => []),
    getLocalOllamaModels: vi.fn(async () => []),
    getLocalFrontierModels: vi.fn(async () => []),
    getEntitlements: vi.fn(async () => entitlements),
    getOrganizationPolicy: vi.fn(async () => organizationPolicy as never),
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
    await expect(service.refresh()).resolves.toMatchObject({
      catalog: [{ key: 'OLLAMA:qwen3-coder' }],
    });
  });

  it('keeps every installed local Ollama model visible regardless of cloud-plan grants', async () => {
    const backend = backendFor(
      entitlement({
        allowedModels: [
          {
            provider: 'OPENAI',
            model: 'gpt-5',
            isAllowed: true,
            allowAsPrimary: true,
            allowAsFallback: true,
            allowAsJudge: true,
            allowInCompare: true,
            dailyTokenLimitOverride: null,
          },
        ],
        allowedProviders: ['OPENAI'],
      }),
    );
    backend.getLocalOllamaModels = vi.fn(async () => [
      {
        id: 'ollama-1',
        name: 'qwen2.5-coder',
        tag: '7b',
        family: 'qwen',
        isInstalled: true,
      },
      {
        id: 'ollama-2',
        name: 'smollm',
        tag: 'latest',
        family: 'llama',
        isInstalled: true,
      },
    ]);

    await expect(new ModelService(backend).refresh()).resolves.toMatchObject({
      catalog: [
        { key: 'OLLAMA:qwen2.5-coder:7b', source: 'ollama' },
        { key: 'OLLAMA:smollm', source: 'ollama' },
        { key: 'OLLAMA:qwen3-coder', source: 'routing' },
      ],
    });
  });

  it('loads installed Ollama and ready llama.cpp models before cloud models', async () => {
    const backend = backendFor(entitlement({ isAdmin: true }));
    backend.getLocalOllamaModels = vi.fn(async () => [
      {
        id: 'ollama-1',
        name: 'qwen3',
        tag: 'coder',
        family: 'qwen',
        isInstalled: true,
      },
    ]);
    backend.getLocalFrontierModels = vi.fn(async () => [
      {
        id: 'frontier-1',
        name: 'deepseek',
        tag: 'q4',
        displayName: 'DeepSeek Coder',
        parameterCount: '16B',
        contextLength: 32_768,
        downloadStatus: 'READY',
      },
    ]);

    await expect(new ModelService(backend).refresh()).resolves.toMatchObject({
      catalog: [
        { key: 'OLLAMA:qwen3:coder', source: 'ollama' },
        { key: 'LLAMACPP:deepseek:q4', source: 'llamacpp' },
        { key: 'OLLAMA:qwen3-coder' },
      ],
    });
  });

  it('reports unavailable local sources without hiding the usable catalog', async () => {
    const backend = backendFor(entitlement({ isAdmin: true }));
    backend.getLocalOllamaModels = vi.fn(async () => {
      throw new Error('ollama unavailable');
    });
    backend.getLocalFrontierModels = vi.fn(async () => {
      throw new Error('llama.cpp unavailable');
    });

    await expect(new ModelService(backend).refresh()).resolves.toMatchObject({
      catalog: [{ key: 'OLLAMA:qwen3-coder' }],
      warnings: ['ollama', 'llamacpp'],
    });
  });

  // The entitlement filter exempts local models on purpose — a local model
  // costs nothing, so entitlements have no opinion on it. An organization
  // allowlist answers a different question, what a member is permitted to use,
  // and an unvetted local model is exactly what an organization forbids. So
  // this filter must reach local models where the entitlement one does not.
  it('applies an organization allowlist to local models too', async () => {
    const backend = backendFor(entitlement({ isAdmin: true }), {
      allowedModels: ['ANTHROPIC:claude-sonnet'],
    });

    await expect(new ModelService(backend).refresh()).resolves.toMatchObject({ catalog: [] });
  });

  it('treats an empty organization allowlist as every model permitted', async () => {
    const backend = backendFor(entitlement({ isAdmin: true }), { allowedModels: [] });

    await expect(new ModelService(backend).refresh()).resolves.toMatchObject({
      catalog: [{ key: 'OLLAMA:qwen3-coder' }],
    });
  });

  it('changes nothing when the backend has no organization policy', async () => {
    const backend = backendFor(entitlement({ isAdmin: true }));

    await expect(new ModelService(backend).refresh()).resolves.toMatchObject({
      catalog: [{ key: 'OLLAMA:qwen3-coder' }],
    });
  });

  // Both filters apply: an organization allowlist narrows further than
  // entitlements, it never widens past them.
  it('intersects the organization allowlist with what entitlements already permit', async () => {
    const backend = backendFor(
      entitlement({
        allowedProviders: ['OLLAMA'],
        allowedModels: [
          {
            provider: 'OLLAMA',
            model: 'qwen3-coder',
            isAllowed: true,
            allowAsPrimary: true,
            allowAsFallback: true,
            allowAsJudge: true,
            allowInCompare: true,
            dailyTokenLimitOverride: null,
          },
        ],
      }),
      { allowedModels: ['OLLAMA:qwen3-coder'] },
    );

    await expect(new ModelService(backend).refresh()).resolves.toMatchObject({
      catalog: [{ key: 'OLLAMA:qwen3-coder' }],
    });
  });
});
