import { describe, expect, it } from 'vitest';

import { resolvePlacementColumn, sanitizeRememberedColumn } from '../../src/core/panel-placement';

describe('resolvePlacementColumn', () => {
  it('reuses a remembered column that still exists', () => {
    expect(resolvePlacementColumn(2, [1, 2])).toBe(2);
  });
  it('falls back when the group was closed', () => {
    expect(resolvePlacementColumn(3, [1, 2])).toBeUndefined();
  });
  it('ignores nothing remembered or nonsense', () => {
    expect(resolvePlacementColumn(undefined, [1])).toBeUndefined();
    expect(resolvePlacementColumn(0, [0, 1])).toBeUndefined();
    expect(resolvePlacementColumn(1.5, [1])).toBeUndefined();
  });
});

describe('sanitizeRememberedColumn', () => {
  it('accepts 1-9 integers only', () => {
    expect(sanitizeRememberedColumn(2)).toBe(2);
    expect(sanitizeRememberedColumn('2')).toBeUndefined();
    expect(sanitizeRememberedColumn(10)).toBeUndefined();
    expect(sanitizeRememberedColumn(-1)).toBeUndefined();
  });
});
