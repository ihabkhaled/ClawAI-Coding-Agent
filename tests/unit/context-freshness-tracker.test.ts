import { describe, expect, it, vi } from 'vitest';

import { contentDigest } from '../../src/core/context-freshness';
import { ContextFreshnessTracker } from '../../src/services/context-freshness-tracker';

import type { ExtensionState } from '../../src/core/extension-state';

function stateWith(
  included: { path: string; startLine?: number; endLine?: number; digest?: string }[],
) {
  return { snapshot: { contextReceipt: { included } } } as unknown as ExtensionState;
}

describe('ContextFreshnessTracker', () => {
  it('reports fresh for a row it has never checked', () => {
    const tracker = new ContextFreshnessTracker(
      stateWith([]),
      { readRange: vi.fn(async () => 'text') },
      vi.fn(),
    );

    expect(tracker.freshness('src/a.ts:1-2')).toBe('fresh');
  });

  it('ignores a save of a file the receipt does not name', async () => {
    const readRange = vi.fn(async () => 'text');
    const onChanged = vi.fn();
    const tracker = new ContextFreshnessTracker(
      stateWith([{ path: 'src/a.ts', digest: contentDigest('text') }]),
      { readRange },
      onChanged,
    );

    await tracker.fileSaved('src/unrelated.ts');

    expect(readRange).not.toHaveBeenCalled();
    expect(onChanged).not.toHaveBeenCalled();
  });

  it('marks the row and redraws when the saved file is one that was collected', async () => {
    const onChanged = vi.fn();
    const tracker = new ContextFreshnessTracker(
      stateWith([{ path: 'src/a.ts', startLine: 1, endLine: 2, digest: contentDigest('before') }]),
      { readRange: vi.fn(async () => 'after') },
      onChanged,
    );

    await tracker.fileSaved('src/a.ts');

    expect(tracker.freshness('src/a.ts:1-2')).toBe('changed');
    expect(onChanged).toHaveBeenCalledTimes(1);
  });

  it('clears a mark once the file is put back the way it was', async () => {
    let current = 'after';
    const tracker = new ContextFreshnessTracker(
      stateWith([{ path: 'src/a.ts', startLine: 1, endLine: 2, digest: contentDigest('before') }]),
      { readRange: vi.fn(async () => current) },
      vi.fn(),
    );

    await tracker.fileSaved('src/a.ts');
    expect(tracker.freshness('src/a.ts:1-2')).toBe('changed');

    current = 'before';
    await tracker.fileSaved('src/a.ts');

    expect(tracker.freshness('src/a.ts:1-2')).toBe('fresh');
  });
});
