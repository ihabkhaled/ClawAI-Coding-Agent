import {
  QR_FINDER_LIKE,
  QR_MASK_COUNT,
  QR_PENALTY_BALANCE,
  QR_PENALTY_BLOCK,
  QR_PENALTY_FINDER,
  QR_PENALTY_RUN,
} from './qr-code.constants';
import { drawFormat } from './qr-layout';

import type { QrGrid } from './qr-code.types';

function inverts(mask: number, x: number, y: number): boolean {
  const product = x * y;
  switch (mask) {
    case 0:
      return (x + y) % 2 === 0;
    case 1:
      return y % 2 === 0;
    case 2:
      return x % 3 === 0;
    case 3:
      return (x + y) % 3 === 0;
    case 4:
      return (Math.floor(x / 3) + Math.floor(y / 2)) % 2 === 0;
    case 5:
      return (product % 2) + (product % 3) === 0;
    case 6:
      return ((product % 2) + (product % 3)) % 2 === 0;
    default:
      return (((x + y) % 2) + (product % 3)) % 2 === 0;
  }
}

export function applyMask(grid: QrGrid, mask: number): void {
  for (let y = 0; y < grid.size; y += 1) {
    for (let x = 0; x < grid.size; x += 1) {
      const row = grid.modules[y];
      if (row === undefined || grid.isFunction[y]?.[x] === true) continue;
      if (inverts(mask, x, y)) row[x] = !row[x];
    }
  }
}

function runPenalty(line: readonly boolean[]): number {
  let penalty = 0;
  let run = 1;
  for (let i = 1; i <= line.length; i += 1) {
    if (i < line.length && line[i] === line[i - 1]) {
      run += 1;
      continue;
    }
    if (run >= 5) penalty += QR_PENALTY_RUN + (run - 5);
    run = 1;
  }
  return penalty;
}

function finderPenalty(line: readonly boolean[]): number {
  const width = QR_FINDER_LIKE.length;
  let penalty = 0;
  for (let i = 0; i + width <= line.length; i += 1) {
    const forward = QR_FINDER_LIKE.every((value, k) => line[i + k] === value);
    const backward = QR_FINDER_LIKE.every((value, k) => line[i + width - 1 - k] === value);
    if (forward || backward) penalty += QR_PENALTY_FINDER;
  }
  return penalty;
}

function blockPenalty(grid: QrGrid): number {
  let penalty = 0;
  for (let y = 0; y + 1 < grid.size; y += 1) {
    for (let x = 0; x + 1 < grid.size; x += 1) {
      const color = grid.modules[y]?.[x];
      if (
        color === grid.modules[y]?.[x + 1] &&
        color === grid.modules[y + 1]?.[x] &&
        color === grid.modules[y + 1]?.[x + 1]
      ) {
        penalty += QR_PENALTY_BLOCK;
      }
    }
  }
  return penalty;
}

function balancePenalty(grid: QrGrid): number {
  const total = grid.size * grid.size;
  const dark = grid.modules.reduce((sum, row) => sum + row.filter(Boolean).length, 0);
  const steps = Math.ceil(Math.abs(dark * 20 - total * 10) / total) - 1;
  return Math.max(0, steps) * QR_PENALTY_BALANCE;
}

export function penaltyScore(grid: QrGrid): number {
  let penalty = blockPenalty(grid) + balancePenalty(grid);
  for (let i = 0; i < grid.size; i += 1) {
    const row = grid.modules[i] ?? [];
    const column = grid.modules.map((cells) => cells[i] === true);
    penalty += runPenalty(row) + finderPenalty(row) + runPenalty(column) + finderPenalty(column);
  }
  return penalty;
}

/** Tries all eight masks and leaves the lowest-penalty one applied. */
export function applyBestMask(grid: QrGrid): number {
  let best = 0;
  let bestScore = Number.POSITIVE_INFINITY;
  for (let mask = 0; mask < QR_MASK_COUNT; mask += 1) {
    applyMask(grid, mask);
    drawFormat(grid, mask);
    const score = penaltyScore(grid);
    if (score < bestScore) {
      best = mask;
      bestScore = score;
    }
    applyMask(grid, mask);
  }
  applyMask(grid, best);
  drawFormat(grid, best);
  return best;
}
