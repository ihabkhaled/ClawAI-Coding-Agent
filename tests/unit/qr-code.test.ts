import { describe, expect, it } from 'vitest';

import { encodeQr } from '../../src/core/qr-code';
import { QR_BLOCKS_M, QR_ECC_PER_BLOCK_M } from '../../src/core/qr-code.constants';
import { rawDataModules } from '../../src/core/qr-codewords';
import { drawFunctionPatterns, formatBits, newGrid } from '../../src/core/qr-layout';
import { qrToSvg } from '../../src/core/qr-svg';

import type { QrMatrix } from '../../src/core/qr-code.types';

/** Format strings for level M, masks 0 to 7, from ISO/IEC 18004 table C.1. */
const SPEC_FORMAT_M = [
  0b101010000010010, 0b101000100100101, 0b101111001111100, 0b101101101001011, 0b100010111111001,
  0b100000011001110, 0b100111110010111, 0b100101010100000,
];

function at(matrix: QrMatrix, x: number, y: number): boolean {
  return matrix.modules[y]?.[x] === true;
}

function readFormat(matrix: QrMatrix): number {
  let bits = 0;
  for (let i = 0; i <= 5; i += 1) bits |= (at(matrix, 8, i) ? 1 : 0) << i;
  bits |= (at(matrix, 8, 7) ? 1 : 0) << 6;
  bits |= (at(matrix, 8, 8) ? 1 : 0) << 7;
  bits |= (at(matrix, 7, 8) ? 1 : 0) << 8;
  for (let i = 9; i < 15; i += 1) bits |= (at(matrix, 14 - i, 8) ? 1 : 0) << i;
  return bits;
}

function maskInverts(mask: number, x: number, y: number): boolean {
  const p = x * y;
  const table = [
    (x + y) % 2 === 0,
    y % 2 === 0,
    x % 3 === 0,
    (x + y) % 3 === 0,
    (Math.floor(x / 3) + Math.floor(y / 2)) % 2 === 0,
    (p % 2) + (p % 3) === 0,
    ((p % 2) + (p % 3)) % 2 === 0,
    (((x + y) % 2) + (p % 3)) % 2 === 0,
  ];
  return table[mask] === true;
}

/** Reads the data bits back in zigzag order with the mask removed. */
function readCodewords(matrix: QrMatrix): number[] {
  const functionGrid = newGrid(matrix.version);
  drawFunctionPatterns(functionGrid);
  const bits: number[] = [];
  let upward = true;
  for (let right = matrix.size - 1; right >= 1; right -= 2) {
    const column = right === 6 ? 5 : right;
    for (let step = 0; step < matrix.size; step += 1) {
      const y = upward ? matrix.size - 1 - step : step;
      for (const x of [column, column - 1]) {
        if (functionGrid.isFunction[y]?.[x] === true) continue;
        bits.push(at(matrix, x, y) !== maskInverts(matrix.mask, x, y) ? 1 : 0);
      }
    }
    upward = !upward;
    if (right === 6) right -= 1;
  }
  const bytes: number[] = [];
  for (let i = 0; i + 8 <= bits.length; i += 8) {
    bytes.push(bits.slice(i, i + 8).reduce((acc, bit) => (acc << 1) | bit, 0));
  }
  return bytes;
}

const EXP: number[] = [];
const LOG: number[] = [];
(() => {
  let value = 1;
  for (let i = 0; i < 255; i += 1) {
    EXP[i] = value;
    LOG[value] = i;
    value <<= 1;
    if (value & 0x100) value ^= 0x11d;
  }
})();

function gfMul(a: number, b: number): number {
  if (a === 0 || b === 0) return 0;
  return EXP[((LOG[a] ?? 0) + (LOG[b] ?? 0)) % 255] ?? 0;
}

/** A Reed-Solomon codeword is valid when it evaluates to zero at alpha^0..alpha^(n-1). */
function syndromesAreZero(block: readonly number[], eccLength: number): boolean {
  for (let root = 0; root < eccLength; root += 1) {
    const alpha = EXP[root] ?? 0;
    const sum = block.reduce((acc, coefficient) => gfMul(acc, alpha) ^ coefficient, 0);
    if (sum !== 0) return false;
  }
  return true;
}

function decode(matrix: QrMatrix): string {
  const codewords = readCodewords(matrix);
  const blocks = QR_BLOCKS_M[matrix.version] ?? 1;
  const eccLength = QR_ECC_PER_BLOCK_M[matrix.version] ?? 0;
  const raw = Math.floor(rawDataModules(matrix.version) / 8);
  const shortBlocks = blocks - (raw % blocks);
  const shortLength = Math.floor(raw / blocks);
  const lengths = Array.from({ length: blocks }, (_, i) => shortLength + (i < shortBlocks ? 0 : 1));
  const built: number[][] = lengths.map(() => []);
  let cursor = 0;
  const dataLengths = lengths.map((length) => length - eccLength);
  for (let i = 0; i < (dataLengths[blocks - 1] ?? 0); i += 1) {
    dataLengths.forEach((length, j) => {
      if (i < length) built[j]?.push(codewords[cursor++] ?? 0);
    });
  }
  for (let i = 0; i < eccLength; i += 1) {
    built.forEach((block) => block.push(codewords[cursor++] ?? 0));
  }
  built.forEach((block) => {
    expect(syndromesAreZero(block, eccLength)).toBe(true);
  });
  const data = built.flatMap((block) => block.slice(0, block.length - eccLength));
  const bits = data.flatMap((byte) => Array.from({ length: 8 }, (_, i) => (byte >>> (7 - i)) & 1));
  const read = (start: number, length: number): number =>
    bits.slice(start, start + length).reduce((acc, bit) => (acc << 1) | bit, 0);
  expect(read(0, 4)).toBe(0b0100);
  const countBits = matrix.version <= 9 ? 8 : 16;
  const count = read(4, countBits);
  const bytes = Uint8Array.from({ length: count }, (_, i) => read(4 + countBits + i * 8, 8));
  return new TextDecoder().decode(bytes);
}

describe('QR encoder', () => {
  it('picks the smallest version for the byte length', () => {
    expect(encodeQr('a'.repeat(14)).version).toBe(1);
    expect(encodeQr('a'.repeat(15)).version).toBe(2);
    expect(encodeQr('a'.repeat(213)).version).toBe(10);
    expect(encodeQr('a').size).toBe(21);
  });

  it('refuses text longer than version 10 holds', () => {
    expect(() => encodeQr('a'.repeat(214))).toThrow(RangeError);
  });

  it('draws finder, separator and timing patterns', () => {
    const matrix = encodeQr('https://claw.local/pair?code=ABCD-EFGH');
    const last = matrix.size - 7;
    for (const [ox, oy] of [
      [0, 0],
      [last, 0],
      [0, last],
    ] as const) {
      for (let d = 0; d < 7; d += 1) {
        expect(at(matrix, ox + d, oy)).toBe(true);
        expect(at(matrix, ox + d, oy + 6)).toBe(true);
        expect(at(matrix, ox, oy + d)).toBe(true);
        expect(at(matrix, ox + 6, oy + d)).toBe(true);
      }
      expect(at(matrix, ox + 3, oy + 3)).toBe(true);
      expect(at(matrix, ox + 1, oy + 1)).toBe(false);
    }
    for (let i = 8; i < matrix.size - 8; i += 1) {
      expect(at(matrix, i, 6)).toBe(i % 2 === 0);
      expect(at(matrix, 6, i)).toBe(i % 2 === 0);
    }
    expect(at(matrix, 8, matrix.size - 8)).toBe(true);
  });

  it('writes format bits that match the specification table', () => {
    SPEC_FORMAT_M.forEach((expected, mask) => {
      expect(formatBits(mask)).toBe(expected);
    });
    const matrix = encodeQr('https://claw.local/pair?code=ABCD-EFGH');
    expect(readFormat(matrix)).toBe(SPEC_FORMAT_M[matrix.mask]);
  });

  it.each([
    ['version 1', 'https://a.io/p?c=1'.slice(0, 14)],
    ['version 3', 'https://claw.local/pair?code=ABCD-EFGH'],
    ['version 5', `https://claw.local/pair?code=${'Z'.repeat(60)}`],
    ['version 7', `https://claw.local/pair?code=${'Q'.repeat(90)}`],
    ['version 9', `https://claw.local/pair?code=${'k'.repeat(150)}`],
    ['version 10', `https://claw.local/pair?code=${'m'.repeat(180)}`],
    ['unicode', 'ClawAI ✓ الاقتران 配对'],
  ])('round-trips %s through an independent decoder with valid error correction', (_, text) => {
    const matrix = encodeQr(text);
    expect(decode(matrix)).toBe(text);
  });
});

describe('QR SVG', () => {
  it('is one self-contained inline SVG with a quiet zone and an escaped label', () => {
    const matrix = encodeQr('https://claw.local/pair?code=1');
    const svg = qrToSvg(matrix, { label: 'Scan "me" <now>' });
    expect(svg.startsWith('<svg')).toBe(true);
    expect(svg).toContain(`viewBox="0 0 ${String(matrix.size + 8)} ${String(matrix.size + 8)}"`);
    expect(svg).toContain('aria-label="Scan &quot;me&quot; &lt;now&gt;"');
    expect(svg).not.toMatch(/href|<script|<image|url\(/u);
  });
});
