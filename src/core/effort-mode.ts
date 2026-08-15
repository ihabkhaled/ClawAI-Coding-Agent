import { z } from 'zod';

import { parseRunBudget, type RunBudget } from './runtime/runtime-tool-contracts';

/**
 * How hard a run is allowed to work.
 *
 * Until now every run received one hardcoded budget, so a one-line edit and a
 * cross-service feature were given the same forty model turns and two-hour
 * wall clock. The names below are ordered weakest to strongest and each one
 * maps to a genuinely different budget — a label that resolved to the same
 * numbers as its neighbour would be worse than no label at all, and
 * `effort-mode.test.ts` fails if any two profiles are equal or if the ladder
 * stops being monotonic.
 *
 * `ULTRA` is the default and is never smaller in any dimension than the budget
 * that used to be hardcoded, so nobody's existing run starts failing a limit
 * it never had to respect. It used to be byte-identical to that legacy budget
 * — 40 model turns — and a feature-scale mission died of it: a live run spent
 * every turn on legitimate discovery reads of a large monorepo and was ended
 * by the budget before writing a single file. The protocol schema allows 100
 * turns and 500 tool calls; the top rung now buys that ceiling instead of
 * stopping at less than half of it.
 */
export const EFFORT_MODES = ['LOW', 'MEDIUM', 'HIGH', 'MAX', 'XHIGH', 'ULTRA'] as const;

export type EffortMode = (typeof EFFORT_MODES)[number];

export const DEFAULT_EFFORT_MODE: EffortMode = 'ULTRA';

export const effortModeSchema = z.enum(EFFORT_MODES);

/**
 * What each mode is for, in the words a reviewer needs to judge whether the
 * budget underneath it is the right shape. Pack §13 requires every mode to
 * carry a documented orchestration contract rather than a bare number.
 */
export const EFFORT_MODE_CONTRACTS: Readonly<Record<EffortMode, string>> = {
  LOW: 'A targeted edit with a focused check. Shallow planning, few evidence reads, no tool-call repair — a malformed call ends the turn instead of being retried.',
  MEDIUM:
    'An ordinary feature edit. Enough turns to read the surrounding code, change it, and run the affected tests once.',
  HIGH: 'Cross-file reasoning with integration tests and one explicit review pass.',
  MAX: 'Broad feature reasoning with an architecture check and a regression sweep.',
  XHIGH:
    'Deep repository reasoning, multiple verification passes, wider tests, more room to recover from a failed tool.',
  ULTRA:
    'The highest bounded mode, sized for an entire feature in one run: discovery, implementation, migration, tests, gates and E2E. Buys the whole protocol ceiling for model turns.',
};

/**
 * The ladder. Every dimension is non-decreasing from LOW to ULTRA, and the
 * three that were already pinned to the schema ceiling before effort modes
 * existed — wall clock, output bytes, tool-result bytes — reach that ceiling
 * again at ULTRA rather than exceeding today's behaviour.
 *
 * `maxRepairAttempts` is bounded to 0..1 by `runBudgetSchema`, so it is the one
 * dimension that cannot form a six-step ladder. LOW spends it; everything else
 * keeps its single repair.
 */
const effortBudgets: Readonly<Record<EffortMode, RunBudget>> = {
  LOW: {
    maxModelTurns: 6,
    maxToolCalls: 10,
    maxToolRounds: 8,
    maxRepairAttempts: 0,
    maxRuntimeMs: 300_000,
    maxOutputBytes: 1_048_576,
    maxToolResultBytes: 131_072,
  },
  // MEDIUM and HIGH were calibrated on DISCOVERY runs, where a turn reads one
  // file and reasons about it. Edit-heavy work spends turns differently: every
  // read, every verification command and every retry is a turn, and a single
  // "fix this stylesheet" task spent twenty of them reading a 60 KB file in
  // pieces before it could write anything. Three supervised sessions in a row
  // ended in "Runtime run exceeded its model turn budget" with the work half
  // done — the budget, not the model, was the thing that failed. Doubling both
  // keeps the ladder's shape and its ordering against MAX.
  MEDIUM: {
    maxModelTurns: 24,
    maxToolCalls: 50,
    maxToolRounds: 40,
    maxRepairAttempts: 1,
    maxRuntimeMs: 900_000,
    maxOutputBytes: 2_097_152,
    maxToolResultBytes: 262_144,
  },
  HIGH: {
    maxModelTurns: 40,
    maxToolCalls: 90,
    maxToolRounds: 80,
    maxRepairAttempts: 1,
    maxRuntimeMs: 1_800_000,
    maxOutputBytes: 4_194_304,
    maxToolResultBytes: 524_288,
  },
  MAX: {
    maxModelTurns: 56,
    maxToolCalls: 130,
    maxToolRounds: 88,
    maxRepairAttempts: 1,
    maxRuntimeMs: 3_600_000,
    maxOutputBytes: 8_388_608,
    maxToolResultBytes: 1_048_576,
  },
  XHIGH: {
    maxModelTurns: 60,
    maxToolCalls: 160,
    maxToolRounds: 90,
    maxRepairAttempts: 1,
    maxRuntimeMs: 5_400_000,
    maxOutputBytes: 12_582_912,
    maxToolResultBytes: 1_048_576,
  },
  ULTRA: {
    maxModelTurns: 100,
    maxToolCalls: 250,
    maxToolRounds: 100,
    maxRepairAttempts: 1,
    maxRuntimeMs: 7_200_000,
    maxOutputBytes: 16_777_216,
    maxToolResultBytes: 1_048_576,
  },
};

/**
 * The budget every run used before effort modes existed. Exported so a test
 * can assert the default never buys LESS of anything than runs historically
 * had — a bigger ceiling cannot fail a run that used to pass, a smaller one
 * can.
 */
export const LEGACY_FIXED_BUDGET: RunBudget = {
  maxModelTurns: 40,
  maxToolCalls: 100,
  maxToolRounds: 100,
  maxRepairAttempts: 1,
  maxRuntimeMs: 7_200_000,
  maxOutputBytes: 16_777_216,
  maxToolResultBytes: 1_048_576,
};

/**
 * An unknown, misspelled or absent value resolves to the default rather than
 * throwing. A settings file is user-editable and a bad effort string must not
 * stop the extension from starting a run.
 */
export function normalizeEffortMode(value: unknown): EffortMode {
  return effortModeSchema.catch(DEFAULT_EFFORT_MODE).parse(value);
}

/**
 * Validates on the way out. The profiles are hand-written constants, so parsing
 * them through the same schema the transport uses is what stops a typo here
 * from becoming a rejected run at the backend boundary.
 */
export function effortBudget(mode: EffortMode): RunBudget {
  return parseRunBudget(effortBudgets[mode]);
}
