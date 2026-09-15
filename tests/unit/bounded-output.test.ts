import { Buffer } from 'node:buffer';

import { describe, expect, it } from 'vitest';

import { BoundedOutputBuffer } from '../../src/core/bounded-output';

function feed(buffer: BoundedOutputBuffer, ...parts: string[]): void {
  for (const part of parts) buffer.append(Buffer.from(part, 'utf8'));
}

describe('BoundedOutputBuffer', () => {
  it('keeps everything and reports no truncation while inside the budget', () => {
    const buffer = new BoundedOutputBuffer(1_000);
    feed(buffer, 'first line\n', 'second line\n');

    expect(buffer.result()).toEqual({
      text: 'first line\nsecond line\n',
      truncated: false,
      omittedBytes: 0,
    });
  });

  // Compilers, test runners and package managers all put the answer last. Head-
  // only truncation dropped precisely the part the reader needed.
  it('keeps the end of an over-budget stream, not only the beginning', () => {
    const buffer = new BoundedOutputBuffer(100);
    feed(buffer, 'START', 'x'.repeat(5_000), 'ERROR: the assertion failed');

    const { text, truncated, omittedBytes } = buffer.result();

    expect(truncated).toBe(true);
    expect(omittedBytes).toBeGreaterThan(4_000);
    expect(text).toContain('START');
    expect(text).toContain('ERROR: the assertion failed');
  });

  it('says how much it dropped, between the two halves', () => {
    const buffer = new BoundedOutputBuffer(100);
    feed(buffer, 'A'.repeat(500), 'B'.repeat(500));

    const { text } = buffer.result();

    expect(text).toMatch(/… \d+ bytes omitted/u);
    expect(text.indexOf('…')).toBeGreaterThan(0);
    expect(text.indexOf('…')).toBeLessThan(text.length - 1);
  });

  it('stays inside its budget apart from the marker it adds', () => {
    const buffer = new BoundedOutputBuffer(200);
    feed(buffer, 'z'.repeat(100_000));

    const { text } = buffer.result();
    const marker = /\n… \d+ bytes omitted[^\n]*\n/u.exec(text)?.[0] ?? '';

    expect(Buffer.byteLength(text, 'utf8') - Buffer.byteLength(marker, 'utf8')).toBeLessThanOrEqual(
      200,
    );
  });

  it('holds a bounded amount of memory however many chunks arrive', () => {
    const buffer = new BoundedOutputBuffer(64);
    for (let index = 0; index < 5_000; index += 1) feed(buffer, `line ${String(index)}\n`);

    const { text, truncated } = buffer.result();

    expect(truncated).toBe(true);
    expect(text).toContain('line 4999');
    expect(Buffer.byteLength(text, 'utf8')).toBeLessThan(300);
  });

  // A byte budget cuts wherever it lands, including through a multi-byte
  // sequence. A replacement character is a better answer than a throw.
  it('decodes a cut multi-byte sequence instead of failing', () => {
    const buffer = new BoundedOutputBuffer(8);
    feed(buffer, '日本語のログ出力です');

    expect(() => buffer.result()).not.toThrow();
    expect(buffer.result().truncated).toBe(true);
  });

  it('handles a budget too small to split evenly', () => {
    const buffer = new BoundedOutputBuffer(1);
    feed(buffer, 'abcdef');

    const { truncated, text } = buffer.result();

    expect(truncated).toBe(true);
    expect(text).toContain('a');
    expect(text).toContain('f');
  });
});
