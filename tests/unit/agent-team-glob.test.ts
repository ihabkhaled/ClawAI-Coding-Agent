import { describe, expect, it } from 'vitest';

import {
  firstOutside,
  globInsideAny,
  globsDisjoint,
  rebaseGlobs,
  scopesOverlap,
  underFolder,
} from '../../src/sdk/agent-team-glob';

describe('a glob inside a parent scope', () => {
  it.each([
    ['src/a/**', ['src/**'], true],
    ['src/a/*.ts', ['src/**'], true],
    ['src/**', ['src/**'], true],
    ['src/**', ['src/a/**'], false],
    ['**', ['src/**'], false],
    ['docs/x.md', ['src/**'], false],
    ['src/*.ts', ['src/*.ts', 'lib/**'], true],
    ['src/**/*.ts', ['src/*.ts'], false],
    ['src/a?.ts', ['src/*.ts'], true],
    ['srcx/**', ['src/**'], false],
  ])('%s inside %j is %s', (child, parents, expected) => {
    expect(globInsideAny(child, parents)).toBe(expected);
  });

  it('does not accept a glob too complex to check', () => {
    expect(globInsideAny('a*/b*/c*/d*/e*/f*/g*', ['**'])).toBe(false);
  });

  it('names the first glob that is outside', () => {
    expect(firstOutside(['src/a/**', 'docs/**', 'x/**'], ['src/**'])).toBe('docs/**');
    expect(firstOutside(['src/a/**'], ['src/**'])).toBeUndefined();
  });
});

describe('two globs that cannot match the same path', () => {
  it.each([
    ['a/**', 'b/**', true],
    ['a/**', 'a/b/**', false],
    ['a/**', 'a/**', false],
    ['src/*.ts', 'src/*.md', true],
    ['src/a*', 'src/b*', true],
    ['src/a*', 'src/*b', false],
    ['*/x/a.ts', '*/y/b.ts', true],
    ['**/x', 'a/y', false],
    ['lib', 'lib/util', false],
    ['A/**', 'a/**', false],
  ])('%s and %s are disjoint: %s', (left, right, expected) => {
    expect(globsDisjoint(left, right)).toBe(expected);
  });

  it('treats "anywhere" as overlapping everything', () => {
    expect(scopesOverlap(undefined, ['a/**'])).toBe(true);
    expect(scopesOverlap(['a/**'], ['b/**'])).toBe(false);
    expect(scopesOverlap(['a/**', 'b/**'], ['b/x/**'])).toBe(true);
  });
});

describe('a folder as the root of a child', () => {
  it('reads the parent deny globs from inside the folder', () => {
    expect(rebaseGlobs(['a/secret/**', 'b/**', '**/*.env', '*/keys/**'], 'a')).toEqual([
      'secret/**',
      '**/*.env',
      'keys/**',
    ]);
  });

  it('leaves the globs alone for no folder and joins a folder to a glob', () => {
    expect(rebaseGlobs(['x/**'], '')).toEqual(['x/**']);
    expect(underFolder('a/b', 'src/**')).toBe('a/b/src/**');
    expect(underFolder('', 'src/**')).toBe('src/**');
  });
});
