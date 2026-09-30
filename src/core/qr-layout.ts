import {
  QR_FORMAT_GENERATOR,
  QR_FORMAT_LEVEL_BITS_M,
  QR_FORMAT_XOR,
  QR_VERSION_GENERATOR,
} from './qr-code.constants';

import type { QrGrid } from './qr-code.types';

function bit(value: number, index: number): boolean {
  return ((value >>> index) & 1) !== 0;
}

export function newGrid(version: number): QrGrid {
  const size = version * 4 + 17;
  const blank = (): boolean[][] =>
    Array.from({ length: size }, () => new Array<boolean>(size).fill(false));
  return { version, size, modules: blank(), isFunction: blank() };
}

function setFunction(grid: QrGrid, x: number, y: number, dark: boolean): void {
  const row = grid.modules[y];
  const marks = grid.isFunction[y];
  if (row === undefined || marks === undefined || x < 0 || x >= grid.size) return;
  row[x] = dark;
  marks[x] = true;
}

function drawFinder(grid: QrGrid, cx: number, cy: number): void {
  for (let dy = -4; dy <= 4; dy += 1) {
    for (let dx = -4; dx <= 4; dx += 1) {
      const distance = Math.max(Math.abs(dx), Math.abs(dy));
      setFunction(grid, cx + dx, cy + dy, distance !== 2 && distance !== 4);
    }
  }
}

function drawAlignment(grid: QrGrid, cx: number, cy: number): void {
  for (let dy = -2; dy <= 2; dy += 1) {
    for (let dx = -2; dx <= 2; dx += 1) {
      setFunction(grid, cx + dx, cy + dy, Math.max(Math.abs(dx), Math.abs(dy)) !== 1);
    }
  }
}

/** Alignment-pattern centres along one axis. */
export function alignmentPositions(version: number, size: number): number[] {
  if (version === 1) return [];
  const count = Math.floor(version / 7) + 2;
  const step = Math.floor((version * 8 + count * 3 + 5) / (count * 4 - 4)) * 2;
  const result = [6];
  for (let position = size - 7; result.length < count; position -= step) {
    result.splice(1, 0, position);
  }
  return result;
}

function drawVersion(grid: QrGrid): void {
  if (grid.version < 7) return;
  let remainder = grid.version;
  for (let i = 0; i < 12; i += 1) {
    remainder = (remainder << 1) ^ ((remainder >>> 11) * QR_VERSION_GENERATOR);
  }
  const bits = (grid.version << 12) | remainder;
  for (let i = 0; i < 18; i += 1) {
    const a = grid.size - 11 + (i % 3);
    const b = Math.floor(i / 3);
    setFunction(grid, a, b, bit(bits, i));
    setFunction(grid, b, a, bit(bits, i));
  }
}

/** The 15 format bits for level M and the given mask. */
export function formatBits(mask: number): number {
  const data = (QR_FORMAT_LEVEL_BITS_M << 3) | mask;
  let remainder = data;
  for (let i = 0; i < 10; i += 1) {
    remainder = (remainder << 1) ^ ((remainder >>> 9) * QR_FORMAT_GENERATOR);
  }
  return ((data << 10) | remainder) ^ QR_FORMAT_XOR;
}

export function drawFormat(grid: QrGrid, mask: number): void {
  const bits = formatBits(mask);
  const { size } = grid;
  for (let i = 0; i <= 5; i += 1) setFunction(grid, 8, i, bit(bits, i));
  setFunction(grid, 8, 7, bit(bits, 6));
  setFunction(grid, 8, 8, bit(bits, 7));
  setFunction(grid, 7, 8, bit(bits, 8));
  for (let i = 9; i < 15; i += 1) setFunction(grid, 14 - i, 8, bit(bits, i));
  for (let i = 0; i < 8; i += 1) setFunction(grid, size - 1 - i, 8, bit(bits, i));
  for (let i = 8; i < 15; i += 1) setFunction(grid, 8, size - 15 + i, bit(bits, i));
  setFunction(grid, 8, size - 8, true);
}

/** Timing, finder, alignment, version and placeholder format patterns. */
export function drawFunctionPatterns(grid: QrGrid): void {
  const { size } = grid;
  for (let i = 0; i < size; i += 1) {
    setFunction(grid, 6, i, i % 2 === 0);
    setFunction(grid, i, 6, i % 2 === 0);
  }
  drawFinder(grid, 3, 3);
  drawFinder(grid, size - 4, 3);
  drawFinder(grid, 3, size - 4);
  const positions = alignmentPositions(grid.version, size);
  const last = positions.length - 1;
  positions.forEach((cx, i) => {
    positions.forEach((cy, j) => {
      const overlapsFinder =
        (i === 0 && j === 0) || (i === 0 && j === last) || (i === last && j === 0);
      if (!overlapsFinder) drawAlignment(grid, cx, cy);
    });
  });
  drawFormat(grid, 0);
  drawVersion(grid);
}

/** Places codeword bits in the zigzag order, skipping function modules. */
export function placeCodewords(grid: QrGrid, data: readonly number[]): void {
  const { size } = grid;
  let index = 0;
  for (let right = size - 1; right >= 1; right -= 2) {
    if (right === 6) right = 5;
    for (let vertical = 0; vertical < size; vertical += 1) {
      for (let j = 0; j < 2; j += 1) {
        const x = right - j;
        const upward = ((right + 1) & 2) === 0;
        const y = upward ? size - 1 - vertical : vertical;
        if (grid.isFunction[y]?.[x] === true || index >= data.length * 8) continue;
        const row = grid.modules[y];
        if (row !== undefined) row[x] = bit(data[index >>> 3] ?? 0, 7 - (index & 7));
        index += 1;
      }
    }
  }
}
