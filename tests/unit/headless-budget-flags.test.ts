import { describe, expect, it } from 'vitest';

import { parseHeadlessArgs } from '../../src/headless/headless-args';
import { HEADLESS_USAGE } from '../../src/headless/headless-args.constants';

const parse = (...args: string[]) => parseHeadlessArgs(['-p', 'x', ...args], {}, process.cwd());

function invocation(...args: string[]) {
  const parsed = parse(...args);
  if (parsed.kind !== 'run') throw new Error(`expected a run, got ${parsed.kind}`);
  return parsed.invocation;
}

describe('--budget and --auto-continue flags', () => {
  it('defaults the CLI to the long profile and three continuations', () => {
    expect(invocation()).toMatchObject({ budgetProfile: 'long', autoContinue: 3 });
  });

  it('reads both flags', () => {
    expect(invocation('--budget', 'default', '--auto-continue', '0')).toMatchObject({
      budgetProfile: 'default',
      autoContinue: 0,
    });
    expect(invocation('--budget', 'long', '--auto-continue', '20')).toMatchObject({
      budgetProfile: 'long',
      autoContinue: 20,
    });
  });

  it.each([
    ['--budget', 'huge'],
    ['--budget', ''],
    ['--auto-continue', '21'],
    ['--auto-continue', '-1'],
    ['--auto-continue', '1.5'],
    ['--auto-continue', 'many'],
  ])('rejects %s %s as a usage error', (flag, value) => {
    const parsed = parse(flag, value);

    expect(parsed.kind).toBe('usage');
  });

  it('names the mistake', () => {
    const budget = parse('--budget', 'huge');
    const cont = parse('--auto-continue', '99');

    expect(budget.kind === 'usage' && budget.message).toContain('default, long');
    expect(cont.kind === 'usage' && cont.message).toContain('0 to 20');
  });

  it('lists both in --help, with the server budget as the ceiling', () => {
    expect(HEADLESS_USAGE).toContain('--budget <profile>');
    expect(HEADLESS_USAGE).toContain('--auto-continue <n>');
    expect(HEADLESS_USAGE).toContain('real limit');
  });
});
