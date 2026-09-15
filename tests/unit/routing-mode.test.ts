import { describe, expect, it } from 'vitest';

import {
  isRouterSelectedMode,
  isRoutingModeName,
  normalizeRoutingMode,
  ROUTING_MODES,
} from '../../src/core/configuration';
import { resolveModelSelection } from '../../src/core/model-catalog';
import { selectedModelRunsTools } from '../../src/core/model-tools';
import { selectedModelAcceptsImages } from '../../src/core/model-vision';

import type { ExtensionSnapshot } from '../../src/core/extension-state';
import type { ModelCatalogEntry } from '../../src/core/model-catalog';

const STRATEGIES = ROUTING_MODES.filter((mode) => mode !== 'MANUAL_MODEL');

function snapshot(overrides: Partial<ExtensionSnapshot> = {}): ExtensionSnapshot {
  return {
    routingMode: 'MANUAL_MODEL',
    selectedModel: '',
    models: [],
    ...overrides,
  } as ExtensionSnapshot;
}

function entry(overrides: Partial<ModelCatalogEntry>): ModelCatalogEntry {
  return {
    id: 'id',
    key: 'PROVIDER:model',
    provider: 'PROVIDER',
    model: 'model',
    displayName: 'Model',
    isLocal: false,
    source: 'connector',
    supportsStreaming: true,
    supportsTools: true,
    supportsVision: false,
    supportsStructuredOutput: false,
    contextTokens: null,
    ...overrides,
  };
}

describe('routing modes', () => {
  it('offers every strategy the backend has, not the two the panel used to', () => {
    expect([...ROUTING_MODES]).toEqual([
      'AUTO',
      'MANUAL_MODEL',
      'LOCAL_ONLY',
      'PRIVACY_FIRST',
      'LOW_LATENCY',
      'HIGH_REASONING',
      'COST_SAVER',
    ]);
  });

  it('treats every mode but the manual one as router-selected', () => {
    expect(isRouterSelectedMode('MANUAL_MODEL')).toBe(false);
    for (const mode of STRATEGIES) {
      expect(isRouterSelectedMode(mode)).toBe(true);
    }
  });

  it('recognises a strategy name without mistaking a model key for one', () => {
    expect(isRoutingModeName('COST_SAVER')).toBe(true);
    expect(isRoutingModeName('OPENAI:gpt-4o')).toBe(false);
  });

  it('still migrates the legacy stored value, and still falls back on nonsense', () => {
    expect(normalizeRoutingMode('MANUAL')).toBe('MANUAL_MODEL');
    expect(normalizeRoutingMode('LOCAL_ONLY')).toBe('LOCAL_ONLY');
    expect(() => normalizeRoutingMode('SOMETHING_ELSE')).toThrow();
  });
});

describe('resolveModelSelection', () => {
  it('leaves the model to the router under every strategy', () => {
    for (const mode of STRATEGIES) {
      expect(resolveModelSelection(mode, 'PROVIDER:model', [entry({})])).toEqual({
        routingMode: mode,
      });
    }
  });

  it('still resolves the chosen model under manual routing', () => {
    expect(resolveModelSelection('MANUAL_MODEL', 'PROVIDER:model', [entry({})])).toEqual({
      routingMode: 'MANUAL_MODEL',
      provider: 'PROVIDER',
      model: 'model',
    });
  });

  it('still refuses a manual selection the catalog does not carry', () => {
    expect(() => resolveModelSelection('MANUAL_MODEL', 'gone', [entry({})])).toThrow(
      /not available/u,
    );
  });
});

describe('selectedModelRunsTools', () => {
  it('says yes under every strategy, because the router has not chosen yet', () => {
    for (const mode of STRATEGIES) {
      expect(selectedModelRunsTools(snapshot({ routingMode: mode }))).toBe(true);
    }
  });

  it('says no only when the catalog explicitly says the model cannot', () => {
    const blind = snapshot({
      selectedModel: 'PROVIDER:model',
      models: [entry({ supportsTools: false })],
    });

    expect(selectedModelRunsTools(blind)).toBe(false);
  });

  it('says yes for a model the catalog has not caught up with', () => {
    expect(selectedModelRunsTools(snapshot({ selectedModel: 'unknown' }))).toBe(true);
  });
});

describe('selectedModelAcceptsImages', () => {
  it('answers for every strategy, not only for AUTO', () => {
    for (const mode of STRATEGIES) {
      expect(selectedModelAcceptsImages(snapshot({ routingMode: mode }))).toBe(true);
    }
  });
});
