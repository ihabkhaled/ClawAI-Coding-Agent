import { describe, expect, it } from 'vitest';

import { createIgnoreStack } from '../../src/sdk/knowledge-ignore';

function stack(text: string) {
  const rules = createIgnoreStack();
  rules.add('', text);
  return rules;
}

describe('knowledge ignore matcher', () => {
  it('matches gitignore shapes', () => {
    const rules = stack('*.log\n/build\ndocs/**/tmp\n!keep.log\nfile?.md\n[ab].txt\n');
    expect(rules.ignored('x/y.log', false)).toBe(true);
    expect(rules.ignored('keep.log', false)).toBe(false);
    expect(rules.ignored('build', true)).toBe(true);
    expect(rules.ignored('sub/build', true)).toBe(false);
    expect(rules.ignored('docs/tmp', true)).toBe(true);
    expect(rules.ignored('docs/a/b/tmp', true)).toBe(true);
    expect(rules.ignored('file1.md', false)).toBe(true);
    expect(rules.ignored('a.txt', false)).toBe(true);
    expect(rules.ignored('c.txt', false)).toBe(false);
  });

  it('runs in linear time on a catastrophic pattern', () => {
    const rules = stack(`${'*a'.repeat(30)}*b\n`);
    const started = Date.now();
    expect(rules.ignored('a'.repeat(1000), false)).toBe(false);
    expect(Date.now() - started).toBeLessThan(1_000);
  });

  it('survives malformed classes and an oversized file', () => {
    const rules = stack(`[z-a]\n[\\n${'x\n'.repeat(20_000)}`);
    expect(rules.ignored('q', false)).toBe(false);
  });
});
