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
