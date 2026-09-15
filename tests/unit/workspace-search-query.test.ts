import { describe, expect, it } from 'vitest';

import {
  compileSearchMatcher,
  findMultilineMatches,
  matchesFileTypes,
  resolveFileTypeExtensions,
} from '../../src/core/workspace-search-query';
import { MAX_MULTILINE_MATCHES_PER_FILE } from '../../src/core/workspace-search-query.constants';

describe('resolveFileTypeExtensions', () => {
  it('expands a language name to every extension it covers', () => {
    expect([...resolveFileTypeExtensions(['ts'])].sort()).toEqual(['cts', 'mts', 'ts', 'tsx']);
  });

  it('accepts a bare extension, with or without its dot', () => {
    expect([...resolveFileTypeExtensions(['.vue', 'svelte'])].sort()).toEqual(['svelte', 'vue']);
  });

  it('merges several types without repeating an extension', () => {
    const extensions = resolveFileTypeExtensions(['js', 'ts', 'ts']);

    expect(extensions.has('ts')).toBe(true);
    expect(extensions.has('jsx')).toBe(true);
    expect(extensions.size).toBe(8);
  });

  it('refuses a name that could not be an extension rather than searching nothing', () => {
    expect(() => resolveFileTypeExtensions(['type script'])).toThrow(/unknown search file type/u);
  });

  it('is empty when nothing was asked for', () => {
    expect(resolveFileTypeExtensions([]).size).toBe(0);
  });
});

describe('matchesFileTypes', () => {
  const types = resolveFileTypeExtensions(['ts']);

  it('lets every file through when the search was not scoped', () => {
    expect(matchesFileTypes('src/a.py', new Set())).toBe(true);
  });

  it('keeps a file whose extension is in scope', () => {
    expect(matchesFileTypes('src/a.tsx', types)).toBe(true);
  });

  it('drops a file whose extension is not', () => {
    expect(matchesFileTypes('src/a.js', types)).toBe(false);
  });

  it('does not treat a dotfile with no extension as a match', () => {
    expect(matchesFileTypes('src/.ts', types)).toBe(false);
  });

  it('is not fooled by a directory that looks like an extension', () => {
    expect(matchesFileTypes('vendor.ts/readme', types)).toBe(false);
  });
});

describe('compileSearchMatcher', () => {
  it('treats a literal query as characters, not as a pattern', () => {
    const matcher = compileSearchMatcher('config.get(', false, false);

    expect(matcher.test('config.get(key)')).toBe(true);
    expect(matcher.test('configXget(key)')).toBe(false);
  });

  it('folds case only when asked', () => {
    expect(compileSearchMatcher('TODO', false, true).test('todo')).toBe(true);
    expect(compileSearchMatcher('TODO', false, false).test('todo')).toBe(false);
  });

  it('refuses a pattern the engine cannot run', () => {
    expect(() => compileSearchMatcher('([a-z', true, false)).toThrow(/not valid/u);
  });

  it('lets a dot reach across a line break only in multiline mode', () => {
    expect(compileSearchMatcher('a.b', true, false, false).test('a\nb')).toBe(false);
    expect(compileSearchMatcher('a.b', true, false, true).test('a\nb')).toBe(true);
  });
});

describe('findMultilineMatches', () => {
  const source = ['function first(', '  value: string,', '): void {}', '', 'const other = 1;'].join(
    '\n',
  );

  it('reports the line the span starts on, not the line it ends on', () => {
    const matcher = compileSearchMatcher(String.raw`function first\([\s\S]*?\)`, true, false, true);

    expect(findMultilineMatches(source, matcher)).toEqual([
      { line: 1, preview: 'function first(\n  value: string,\n)' },
    ]);
  });

  it('finds every span in a file rather than stopping at the first', () => {
    const matcher = compileSearchMatcher(String.raw`^const`, true, false, true);
    const twice = `const a = 1;\nlet b;\nconst c = 2;`;

    expect(findMultilineMatches(twice, matcher).map((match) => match.line)).toEqual([1, 3]);
  });

  it('terminates on a pattern that can match nothing at all', () => {
    const matcher = compileSearchMatcher('x*', true, false, true);

    expect(findMultilineMatches('abc', matcher).length).toBeLessThanOrEqual(
      MAX_MULTILINE_MATCHES_PER_FILE,
    );
  });

  it('stops taking matches from one file once it has enough', () => {
    const matcher = compileSearchMatcher('a', false, false, true);
    const many = 'a\n'.repeat(MAX_MULTILINE_MATCHES_PER_FILE + 10);

    expect(findMultilineMatches(many, matcher)).toHaveLength(MAX_MULTILINE_MATCHES_PER_FILE);
  });

  it('does not carry a cursor over from a previous file', () => {
    const matcher = compileSearchMatcher('needle', false, false, true);
    findMultilineMatches('needle', matcher);

    expect(findMultilineMatches('needle', matcher)).toHaveLength(1);
  });
});
