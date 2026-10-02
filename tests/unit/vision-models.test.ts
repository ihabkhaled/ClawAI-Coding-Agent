import { describe, expect, it } from 'vitest';

import {
  modelId,
  namedVisionModel,
  VISION_NO_MODEL_MESSAGE,
  visionCandidates,
} from '../../src/sdk/vision-models';

import type { VisionCatalogModel } from '../../src/sdk/vision-tool.types';

function model(
  provider: string,
  modelKey: string,
  supportsVision = true,
  inputUsdPerMillion?: number,
): VisionCatalogModel {
  return {
    provider,
    modelKey,
    supportsVision,
    ...(inputUsdPerMillion === undefined ? {} : { inputUsdPerMillion }),
  };
}

const catalog = [
  model('OLLAMA', 'kimi-k2.7-code', false),
  model('GEMINI', 'models/gemini-embedding-001'),
  model('GEMINI', 'models/gemini-2.5-flash-preview-tts'),
  model('GEMINI', 'models/veo-3.1-generate-preview'),
  model('OPENAI', 'gpt-5', true, 1.25),
  model('OPENAI', 'gpt-4.1-nano', true, 0.1),
  model('GROK', 'grok-4.3', true, 3),
  model('OPENAI', 'gpt-4.1-mini', true, 0.4),
  model('GEMINI', 'models/gemini-2.5-flash', true, 0.3),
];

describe('visionCandidates', () => {
  it('lists the preferred cheap models first, then the rest by price, at most three', () => {
    expect(visionCandidates(catalog).map(modelId)).toEqual([
      'GEMINI/models/gemini-2.5-flash',
      'OPENAI/gpt-4.1-mini',
      'GROK/grok-4.3',
    ]);
  });

  it('leaves out models that cannot look at an image or are not chat models', () => {
    const all = visionCandidates(catalog, new Set(['OPENAI/gpt-4.1-mini'])).map(modelId);
    expect(all).not.toContain('OLLAMA/kimi-k2.7-code');
    expect(all.join()).not.toMatch(/embedding|tts|veo/u);
  });

  it('skips a model that already failed in this run', () => {
    const skip = new Set(['OPENAI/gpt-4.1-mini', 'GEMINI/models/gemini-2.5-flash']);
    expect(visionCandidates(catalog, skip).map(modelId)[0]).toBe('GROK/grok-4.3');
  });

  it('is empty when no model accepts images, and the message says what to do', () => {
    expect(visionCandidates([model('OLLAMA', 'glm-5.2', false)])).toEqual([]);
    expect(VISION_NO_MODEL_MESSAGE).toMatch(/--vision-model/u);
  });

  it('orders unknown prices last instead of first', () => {
    const rows = [model('A', 'zeta-vision'), model('B', 'cheap-vision', true, 0.05)];
    expect(visionCandidates(rows).map(modelId)).toEqual(['B/cheap-vision', 'A/zeta-vision']);
  });
});

describe('namedVisionModel', () => {
  it('finds a model by provider/model or by bare key, ignoring case', () => {
    expect(modelId(namedVisionModel(catalog, 'openai/GPT-4.1-mini'))).toBe('OPENAI/gpt-4.1-mini');
    expect(modelId(namedVisionModel(catalog, 'grok-4.3'))).toBe('GROK/grok-4.3');
    expect(modelId(namedVisionModel(catalog, 'GEMINI/models/gemini-2.5-flash'))).toBe(
      'GEMINI/models/gemini-2.5-flash',
    );
  });

  it('says so when the model is unknown or cannot see, and never picks another', () => {
    expect(() => namedVisionModel(catalog, 'nope')).toThrow(/not in this account/u);
    expect(() => namedVisionModel(catalog, 'kimi-k2.7-code')).toThrow(
      /not marked as accepting images/u,
    );
  });
});
