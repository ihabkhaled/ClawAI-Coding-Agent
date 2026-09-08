import { describe, expect, it } from 'vitest';

import { selectLocations } from '../../src/core/workspace-symbols';

import type { WorkspaceLocation } from '../../src/core/workspace-symbols';

function location(overrides: Partial<WorkspaceLocation> = {}): WorkspaceLocation {
  return { path: 'src/a.ts', line: 1, column: 1, ...overrides };
}

describe('selectLocations', () => {
  it('orders by path, then line, then column', () => {
    const selection = selectLocations(
      [
        location({ path: 'src/b.ts', line: 1 }),
        location({ path: 'src/a.ts', line: 9, column: 2 }),
        location({ path: 'src/a.ts', line: 2 }),
      ],
      100,
    );

    expect(selection.locations.map((entry) => `${entry.path}:${String(entry.line)}`)).toEqual([
      'src/a.ts:2',
      'src/a.ts:9',
      'src/b.ts:1',
    ]);
  });

  // Providers answer once per overload or re-export, so the same position
  // arrives repeatedly and would spend the cap on duplicates.
  it('collapses identical positions', () => {
    const selection = selectLocations([location(), location(), location({ column: 2 })], 100);

    expect(selection.total).toBe(2);
  });

  // A language server answers about whatever it has open, including files
  // outside this workspace. `preview` carries a line of source, so emitting one
  // is a read of a file the tool was never granted.
  it('drops locations outside the workspace or on credential-shaped files', () => {
    const selection = selectLocations(
      [
        location({ path: 'C:/elsewhere/private.ts' }),
        location({ path: '../sibling/a.ts' }),
        location({ path: '.env' }),
        location({ path: 'node_modules/pkg/index.d.ts' }),
        location({ path: 'src/a.ts' }),
      ],
      100,
    );

    // `node_modules` is inside the workspace and readable, so it stays: a
    // definition in a dependency is a legitimate answer.
    expect(selection.locations.map((entry) => entry.path)).toEqual([
      'node_modules/pkg/index.d.ts',
      'src/a.ts',
    ]);
  });

  it('counts every match, then caps what is shown', () => {
    const selection = selectLocations(
      Array.from({ length: 10 }, (_entry, index) => location({ line: index + 1 })),
      3,
    );

    expect(selection.locations).toHaveLength(3);
    expect(selection.total).toBe(10);
    expect(selection.truncated).toBe(true);
  });

  it('normalizes backslash paths', () => {
    const selection = selectLocations([location({ path: String.raw`src\nested\a.ts` })], 100);

    expect(selection.locations[0]?.path).toBe('src/nested/a.ts');
  });
});
