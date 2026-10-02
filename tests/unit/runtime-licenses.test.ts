import { existsSync, readFileSync } from 'node:fs';
import { join } from 'node:path';

import { describe, expect, it } from 'vitest';

/**
 * Every package that ships in the extension (the runtime dependency tree) must be
 * usable under a permissive licence. A dual licence passes when one side is
 * permissive; an AND needs every side permissive; GPL, AGPL and LGPL alone fail.
 */
const PERMISSIVE = new Set([
  '0BSD',
  'Apache-2.0',
  'BSD-2-Clause',
  'BSD-3-Clause',
  'BlueOak-1.0.0',
  'CC0-1.0',
  'ISC',
  'MIT',
  'Unlicense',
  'WTFPL',
  'Zlib',
]);

interface PackageJson {
  readonly license?: string;
  readonly dependencies?: Record<string, string>;
  readonly optionalDependencies?: Record<string, string>;
}

function readPackage(name: string): PackageJson | undefined {
  const path = join('node_modules', name, 'package.json');
  return existsSync(path) ? (JSON.parse(readFileSync(path, 'utf8')) as PackageJson) : undefined;
}

function permitted(expression: string): boolean {
  return expression
    .replace(/[()]/gu, '')
    .split(/\s+OR\s+/u)
    .some((alternative) =>
      alternative.split(/\s+AND\s+/u).every((id) => PERMISSIVE.has(id.trim())),
    );
}

function runtimeTree(): Map<string, string> {
  const root = JSON.parse(readFileSync('package.json', 'utf8')) as PackageJson;
  const licenses = new Map<string, string>();
  const queue = Object.keys(root.dependencies ?? {});
  for (let name = queue.pop(); name !== undefined; name = queue.pop()) {
    if (licenses.has(name)) continue;
    const manifest = readPackage(name);
    if (manifest === undefined) continue;
    licenses.set(name, manifest.license ?? 'UNKNOWN');
    queue.push(
      ...Object.keys(manifest.dependencies ?? {}),
      ...Object.keys(manifest.optionalDependencies ?? {}),
    );
  }
  return licenses;
}

describe('runtime dependency licences', () => {
  it('are all permissive, with no copyleft-only package', () => {
    const tree = runtimeTree();
    expect(tree.has('playwright-core')).toBe(true);
    const refused = [...tree].filter(([, license]) => !permitted(license));
    expect(refused).toEqual([]);
  });

  it('judges dual and compound expressions correctly', () => {
    expect(permitted('(MIT OR GPL-3.0-or-later)')).toBe(true);
    expect(permitted('(MIT AND Zlib)')).toBe(true);
    expect(permitted('GPL-3.0-only')).toBe(false);
    expect(permitted('(MIT AND GPL-2.0)')).toBe(false);
    expect(permitted('UNKNOWN')).toBe(false);
  });
});
