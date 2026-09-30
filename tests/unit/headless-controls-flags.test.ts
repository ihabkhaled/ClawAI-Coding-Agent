import { describe, expect, it } from 'vitest';

import { parseHeadlessArgs } from '../../src/headless/headless-args';

const parse = (...args: string[]) => parseHeadlessArgs(['-p', 'x', ...args], {}, process.cwd());

function invocation(...args: string[]) {
  const parsed = parse(...args);
  if (parsed.kind !== 'run') throw new Error(`expected a run, got ${parsed.kind}`);
  return parsed.invocation;
}

describe('composer control flags', () => {
  it.each([
    ['--effort', 'turbo'],
    ['--effort', ' '],
    ['--speed', '3X'],
    ['--speed', 'fast'],
    ['--research', 'crawl'],
    ['--research', 'everything'],
    ['--context-mode', 'repo'],
    ['--permission-mode', 'yolo'],
  ])('%s %s is a usage error', (flag, value) => {
    const parsed = parse(flag, value);

    expect(parsed.kind).toBe('usage');
  });

  it('reads every effort level, in either case', () => {
    for (const level of ['LOW', 'MEDIUM', 'HIGH', 'MAX', 'XHIGH', 'ULTRA']) {
      expect(invocation('--effort', level).effort).toBe(level);
      expect(invocation('--effort', level.toLowerCase()).effort).toBe(level);
    }
  });

  it('reads every speed', () => {
    expect(invocation('--speed', '1X').speed).toBe('1X');
    expect(invocation('--speed', '1.5x').speed).toBe('1.5X');
    expect(invocation('--speed', '2X').speed).toBe('2X');
  });

  it.each([
    ['none', 'NONE'],
    ['search', 'SEARCH'],
    ['search-fetch', 'SEARCH_FETCH'],
    ['search-extract', 'SEARCH_EXTRACT'],
  ])('maps --research %s to %s', (flag, mode) => {
    expect(invocation('--research', flag).research).toBe(mode);
  });

  it.each(['plan', 'ask', 'accept-edits', 'autonomous-scoped', 'strict'])(
    'accepts --permission-mode %s',
    (mode) => {
      expect(invocation('--permission-mode', mode).permissionMode).toBe(mode);
    },
  );

  it('leaves every control unset when none is given', () => {
    const plain = invocation();

    expect(plain.effort).toBeUndefined();
    expect(plain.speed).toBeUndefined();
    expect(plain.research).toBeUndefined();
    expect(plain.context).toBeUndefined();
    expect(plain.budgetProfile).toBe('long');
  });

  it('drops the default budget profile when an effort is named, and refuses both', () => {
    expect(invocation('--effort', 'LOW').budgetProfile).toBeUndefined();
    expect(parse('--effort', 'LOW', '--budget', 'long').kind).toBe('usage');
  });

  it('builds a context setting from the mode and the file or selection', () => {
    expect(invocation('--context-mode', 'file', '--context-file', 'a.ts').context).toEqual({
      mode: 'file',
      file: 'a.ts',
      selection: undefined,
    });
    expect(
      invocation('--context-mode', 'selection', '--context-selection', 'a.ts:3-9').context,
    ).toMatchObject({ mode: 'selection', selection: 'a.ts:3-9' });
    expect(
      invocation(
        '--context-mode',
        'smart',
        '--context-file',
        'a.ts',
        '--context-selection',
        'a.ts:1-2',
      ).context,
    ).toMatchObject({ mode: 'smart', file: 'a.ts', selection: 'a.ts:1-2' });
    expect(invocation('--context-mode', 'none').context).toMatchObject({ mode: 'none' });
  });

  it.each([
    [['--context-mode', 'file']],
    [['--context-mode', 'selection']],
    [['--context-mode', 'selection', '--context-selection', 'a.ts']],
    [['--context-mode', 'selection', '--context-selection', 'a.ts:9-2']],
    [['--context-mode', 'workspace', '--context-file', 'a.ts']],
    [['--context-mode', 'none', '--context-selection', 'a.ts:1-2']],
    [['--context-mode', 'file', '--context-file', 'a.ts', '--context-selection', 'a.ts:1-2']],
    [['--context-file', 'a.ts']],
  ])('refuses the context setting %j', (args) => {
    expect(parse(...args).kind).toBe('usage');
  });
});
