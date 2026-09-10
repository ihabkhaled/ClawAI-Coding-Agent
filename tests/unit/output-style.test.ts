import { describe, expect, it } from 'vitest';

import {
  BUILT_IN_OUTPUT_STYLES,
  normalizeOutputStyle,
  outputStylePreamble,
} from '../../src/core/output-style';

describe('normalizeOutputStyle', () => {
  it('keeps a named style', () => {
    expect(normalizeOutputStyle('concise')).toBe('concise');
  });

  it('falls back to no style for anything else', () => {
    expect(normalizeOutputStyle(undefined)).toBe('default');
    expect(normalizeOutputStyle('')).toBe('default');
    expect(normalizeOutputStyle(7)).toBe('default');
  });
});

describe('BUILT_IN_OUTPUT_STYLES', () => {
  it('spends no tokens asking for the behaviour that already happens', () => {
    expect(BUILT_IN_OUTPUT_STYLES.find(({ name }) => name === 'default')?.preamble).toBe('');
  });

  it('gives every other style something to say', () => {
    const others = BUILT_IN_OUTPUT_STYLES.filter(({ name }) => name !== 'default');

    expect(others.every(({ preamble }) => preamble.length > 0)).toBe(true);
  });

  it('names each style once', () => {
    const names = BUILT_IN_OUTPUT_STYLES.map(({ name }) => name);

    expect(new Set(names).size).toBe(names.length);
  });
});

describe('outputStylePreamble', () => {
  it('finds a built-in style', () => {
    expect(outputStylePreamble('concise')).toContain('few words');
  });

  it('adds nothing for the default style', () => {
    expect(outputStylePreamble('default')).toBe('');
  });

  it('lets a workspace style replace a built-in of the same name', () => {
    const custom = [{ name: 'concise', preamble: 'Our idea of concise.' }];

    expect(outputStylePreamble('concise', custom)).toBe('Our idea of concise.');
  });

  it('finds a workspace style that is not a built-in', () => {
    const custom = [{ name: 'house-style', preamble: 'Follow the house style.' }];

    expect(outputStylePreamble('house-style', custom)).toBe('Follow the house style.');
  });

  it('adds nothing for a style whose file has been deleted', () => {
    expect(outputStylePreamble('vanished')).toBe('');
  });
});
