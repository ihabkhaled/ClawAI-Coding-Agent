import { describe, expect, it } from 'vitest';

import { asRecord, guardToolResult } from '../../src/sdk/tool-result-guard';

describe('guardToolResult', () => {
  it('wraps a string result in an object, because the protocol demands a record', () => {
    expect(guardToolResult('a plain string')).toEqual({ value: 'a plain string' });
  });

  it('wraps numbers, arrays, null and undefined too', () => {
    expect(guardToolResult(42)).toEqual({ value: 42 });
    expect(guardToolResult([1, 2])).toEqual({ value: [1, 2] });
    expect(guardToolResult(null)).toEqual({ value: null });
    expect(guardToolResult(undefined)).toEqual({ value: null });
  });

  it('leaves an object result as it is', () => {
    expect(guardToolResult({ ok: true, items: [1] })).toEqual({ ok: true, items: [1] });
  });

  it('still cuts an oversized string field and marks the result truncated', () => {
    const guarded = guardToolResult({ content: 'x'.repeat(200_000) }) as {
      content: string;
      truncated?: boolean;
    };
    expect(guarded.truncated).toBe(true);
    expect(guarded.content.length).toBeLessThan(200_000);
  });

  it('bounds a big string returned bare, after wrapping it', () => {
    const guarded = guardToolResult('y'.repeat(200_000)) as { value: string; truncated?: boolean };
    expect(guarded.truncated).toBe(true);
    expect(guarded.value.length).toBeLessThan(200_000);
  });
});

describe('asRecord', () => {
  it('returns an object result as it is', () => {
    const original = { a: 1 };
    const copy = asRecord(original);
    expect(copy).toBe(original);
  });
});
