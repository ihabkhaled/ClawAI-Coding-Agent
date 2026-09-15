import { describe, expect, it } from 'vitest';

import { selectedModelAcceptsImages } from '../../src/core/model-vision';

import type { ExtensionSnapshot } from '../../src/core/extension-state';

function snapshot(overrides: Partial<ExtensionSnapshot> = {}): ExtensionSnapshot {
  return {
    routingMode: 'MANUAL_MODEL',
    selectedModel: '',
    models: [],
    ...overrides,
  } as ExtensionSnapshot;
}

describe('selectedModelAcceptsImages', () => {
  it('says yes under automatic routing, which has not chosen yet', () => {
    expect(selectedModelAcceptsImages(snapshot({ routingMode: 'AUTO' }))).toBe(true);
  });

  it('says yes for a model that can see', () => {
    const seeing = snapshot({
      selectedModel: 'a',
      models: [{ key: 'a', supportsVision: true }],
    } as Partial<ExtensionSnapshot>);

    expect(selectedModelAcceptsImages(seeing)).toBe(true);
  });

  it('says no for a model that explicitly cannot', () => {
    const blind = snapshot({
      selectedModel: 'a',
      models: [{ key: 'a', supportsVision: false }],
    } as Partial<ExtensionSnapshot>);

    expect(selectedModelAcceptsImages(blind)).toBe(false);
  });

  it('says yes for a model the catalog has not caught up with', () => {
    expect(selectedModelAcceptsImages(snapshot({ selectedModel: 'unknown' }))).toBe(true);
  });
});
