import { describe, expect, it } from 'vitest';

import { buildModelCatalog, resolveModelSelection } from '../../src/core/model-catalog';

describe('model catalog', () => {
  const catalog = buildModelCatalog(
    [
      {
        id: 'router-1',
        provider: 'OLLAMA',
        modelKey: 'qwen3-coder',
        displayName: 'Qwen 3 Coder',
        isLocal: true,
        isExecutionCapable: true,
        lifecycle: 'ACTIVE',
        supportsStreaming: true,
        supportsTools: true,
        supportsStructuredOutput: true,
        contextWindowTokens: 131_072,
      },
      {
        id: 'router-only',
        provider: 'OPENAI',
        modelKey: 'router',
        displayName: 'Router',
        isLocal: false,
        isExecutionCapable: false,
        lifecycle: 'ACTIVE',
      },
    ],
    [
      {
        id: 'connector-1',
        connectorId: 'c1',
        provider: 'OPENAI',
        modelKey: 'gpt-5',
        displayName: 'GPT-5',
        lifecycle: 'ACTIVE',
        supportsStreaming: true,
        supportsTools: true,
        supportsVision: true,
        supportsAudio: false,
        supportsStructuredOutput: true,
        maxContextTokens: 200_000,
      },
    ],
  );

  it('keeps only active execution-capable models and preserves capability provenance', () => {
    expect(catalog.map((model) => model.key)).toEqual(['OLLAMA:qwen3-coder', 'OPENAI:gpt-5']);
    expect(catalog[0]).toMatchObject({
      source: 'routing',
      isLocal: true,
    });
    expect(catalog[1]).toMatchObject({
      source: 'connector',
      supportsVision: true,
    });
  });

  it('uses AUTO without a model and validates manual selections against the catalog', () => {
    expect(resolveModelSelection('AUTO', '', catalog)).toEqual({
      routingMode: 'AUTO',
    });
    expect(resolveModelSelection('MANUAL_MODEL', 'OPENAI:gpt-5', catalog)).toMatchObject({
      model: 'gpt-5',
      provider: 'OPENAI',
      routingMode: 'MANUAL_MODEL',
    });
    expect(() => resolveModelSelection('MANUAL_MODEL', 'OPENAI:missing', catalog)).toThrow();
  });

  it('maps local model keys to runtime execution providers and de-duplicates snapshots', () => {
    const localCatalog = buildModelCatalog(
      [
        {
          id: 'router-local',
          provider: 'OLLAMA',
          modelKey: 'qwen3:coder',
          displayName: 'Qwen 3 Coder',
          isLocal: true,
          isExecutionCapable: true,
          lifecycle: 'ACTIVE',
        },
      ],
      [],
      [
        {
          id: 'ollama-local',
          name: 'qwen3',
          tag: 'coder',
          family: 'qwen',
          isInstalled: true,
        },
      ],
      [
        {
          id: 'llamacpp-local',
          name: 'deepseek',
          tag: 'q4',
          displayName: 'DeepSeek Coder',
          parameterCount: '16B',
          contextLength: 32_768,
          downloadStatus: 'READY',
        },
      ],
    );

    expect(localCatalog.map((model) => model.key)).toEqual([
      'OLLAMA:qwen3:coder',
      'LLAMACPP:deepseek:q4',
    ]);
    expect(resolveModelSelection('MANUAL_MODEL', 'OLLAMA:qwen3:coder', localCatalog)).toEqual({
      routingMode: 'MANUAL_MODEL',
      provider: 'local-ollama',
      model: 'qwen3:coder',
    });
    expect(resolveModelSelection('MANUAL_MODEL', 'LLAMACPP:deepseek:q4', localCatalog)).toEqual({
      routingMode: 'MANUAL_MODEL',
      provider: 'local-llamacpp',
      model: 'deepseek:q4',
    });
  });
});

describe('Ollama cloud models', () => {
  // The local daemon lists the cloud models it can proxy. Claiming those as
  // local made the local entry shadow the connector entry that holds the
  // credentials, so selecting one dispatched it to the local runtime and came
  // back "Unauthorized" — every Ollama cloud model was unusable from the picker.
  const cloudModel = {
    id: 'ollama-cloud',
    name: 'kimi-k2.7-code',
    tag: 'cloud',
    family: 'kimi',
    isInstalled: true,
  };
  const connectorModel = {
    id: 'connector-cloud',
    connectorId: 'connector-ollama',
    provider: 'OLLAMA',
    modelKey: 'kimi-k2.7-code:cloud',
    displayName: 'Kimi K2.7 Code',
    lifecycle: 'ACTIVE' as const,
    supportsStreaming: true,
    supportsTools: true,
    supportsVision: false,
    supportsAudio: false,
    supportsStructuredOutput: true,
    maxContextTokens: 262_144,
  };

  it('routes a cloud-tagged model through the connector, not the local runtime', () => {
    const catalog = buildModelCatalog([], [connectorModel], [cloudModel], []);
    const entry = catalog.find((candidate) => candidate.key === 'OLLAMA:kimi-k2.7-code:cloud');

    expect(entry?.provider).toBe('OLLAMA');
    expect(entry?.isLocal).toBe(false);
    expect(entry?.source).toBe('ollama');
    // The connector entry is also the truthful one about tool support; the
    // local entry hardcodes false, which made every cloud model look incapable.
    expect(entry?.supportsTools).toBe(true);
  });

  it('resolves the manual selection to the cloud provider', () => {
    const catalog = buildModelCatalog([], [connectorModel], [cloudModel], []);

    expect(
      resolveModelSelection('MANUAL_MODEL', 'OLLAMA:kimi-k2.7-code:cloud', catalog),
    ).toMatchObject({ provider: 'OLLAMA', model: 'kimi-k2.7-code:cloud' });
  });

  it('still treats a genuinely local model as local', () => {
    const catalog = buildModelCatalog(
      [],
      [],
      [{ id: 'ollama-local', name: 'qwen3', tag: '14b', family: 'qwen', isInstalled: true }],
      [],
    );
    const entry = catalog.find((candidate) => candidate.key === 'OLLAMA:qwen3:14b');

    expect(entry?.provider).toBe('local-ollama');
    expect(entry?.isLocal).toBe(true);
  });

  it('still points a cloud model at the connector when its id is not synced', () => {
    // The connector's synced model list does not necessarily carry every cloud
    // id the daemon can proxy. Dropping those removed the tool-capable models
    // from the picker entirely, so the entry is re-pointed rather than removed.
    const catalog = buildModelCatalog([], [], [cloudModel], []);
    const entry = catalog.find((candidate) => candidate.key === 'OLLAMA:kimi-k2.7-code:cloud');

    expect(entry?.provider).toBe('OLLAMA');
    expect(entry?.isLocal).toBe(false);
    expect(entry?.supportsTools).toBe(true);
  });
});
