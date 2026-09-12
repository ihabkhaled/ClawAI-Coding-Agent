import { describe, expect, it } from 'vitest';

import {
  FOCUS_HIDDEN_SECTIONS,
  VIEW_DENSITIES,
  normalizeViewDensity,
  toggleViewDensity,
} from '../../src/core/view-density';

describe('normalizeViewDensity', () => {
  it('reads a stored focus setting', () => {
    expect(normalizeViewDensity('focus')).toBe('focus');
  });

  it('falls back to the full view for anything else', () => {
    expect(normalizeViewDensity('full')).toBe('full');
    expect(normalizeViewDensity(undefined)).toBe('full');
    expect(normalizeViewDensity('FOCUS')).toBe('full');
    expect(normalizeViewDensity(7)).toBe('full');
  });
});

describe('toggleViewDensity', () => {
  it('goes both ways from one command', () => {
    expect(toggleViewDensity('full')).toBe('focus');
    expect(toggleViewDensity('focus')).toBe('full');
  });

  it('returns to where it started after two toggles', () => {
    for (const density of VIEW_DENSITIES) {
      expect(toggleViewDensity(toggleViewDensity(density))).toBe(density);
    }
  });
});

describe('FOCUS_HIDDEN_SECTIONS', () => {
  it('never hides the conversation or the composer', () => {
    expect(FOCUS_HIDDEN_SECTIONS).not.toContain('conversation');
    expect(FOCUS_HIDDEN_SECTIONS).not.toContain('composer');
  });

  it('hides the surfaces that start or steer work rather than carry it', () => {
    expect(FOCUS_HIDDEN_SECTIONS).toEqual(['runtimeTimeline', 'modelTray', 'runDeck']);
  });

  it('never hides the empty state, which would leave a new chat blank', () => {
    expect(FOCUS_HIDDEN_SECTIONS).not.toContain('emptyState');
  });

  it('leaves the way out reachable, because a mode you cannot leave is not a mode', () => {
    expect(FOCUS_HIDDEN_SECTIONS).not.toContain('workspaceBar');
    expect(FOCUS_HIDDEN_SECTIONS).not.toContain('composer');
  });
});
