import { describe, expect, it } from 'vitest';

import {
  sameBudgetLimits,
  usageDoesNotRegress,
  usageWithinLimits,
} from '../../src/core/runtime/runtime-event-reducer-budget';

const limits = {
  maxModelTurns: 2,
  maxOutputBytes: 4_096,
  maxRepairAttempts: 1,
  maxRuntimeMs: 10_000,
  maxToolCalls: 3,
  maxToolResultBytes: 2_048,
  maxToolRounds: 2,
};

const usage = {
  modelTurns: 1,
  outputBytes: 100,
  repairAttempts: 0,
  toolCalls: 1,
  toolResultBytes: 100,
  toolRounds: 1,
};

describe('runtime event reducer budget guards', () => {
  it.each([
    ['modelTurns', 'maxModelTurns'],
    ['outputBytes', 'maxOutputBytes'],
    ['repairAttempts', 'maxRepairAttempts'],
    ['toolCalls', 'maxToolCalls'],
    ['toolResultBytes', 'maxToolResultBytes'],
    ['toolRounds', 'maxToolRounds'],
  ] as const)('rejects %s usage above its corresponding limit', (usageKey, limitKey) => {
    expect(usageWithinLimits({ ...usage, [usageKey]: limits[limitKey] + 1 }, limits)).toBe(false);
  });

  it.each([
    'maxModelTurns',
    'maxOutputBytes',
    'maxRepairAttempts',
    'maxRuntimeMs',
    'maxToolCalls',
    'maxToolResultBytes',
    'maxToolRounds',
  ] as const)('detects a changed %s limit', (key) => {
    expect(sameBudgetLimits(limits, { ...limits, [key]: limits[key] + 1 })).toBe(false);
  });

  it.each([
    'modelTurns',
    'outputBytes',
    'repairAttempts',
    'toolCalls',
    'toolResultBytes',
    'toolRounds',
  ] as const)('detects regressing %s usage', (key) => {
    expect(usageDoesNotRegress(usage, { ...usage, [key]: usage[key] - 1 })).toBe(false);
  });

  it('accepts usage at every limit, unchanged limits, and non-regressing usage', () => {
    const atLimits = {
      modelTurns: limits.maxModelTurns,
      outputBytes: limits.maxOutputBytes,
      repairAttempts: limits.maxRepairAttempts,
      toolCalls: limits.maxToolCalls,
      toolResultBytes: limits.maxToolResultBytes,
      toolRounds: limits.maxToolRounds,
    };
    expect(usageWithinLimits(atLimits, limits)).toBe(true);
    expect(sameBudgetLimits(limits, limits)).toBe(true);
    expect(usageDoesNotRegress(usage, atLimits)).toBe(true);
  });
});
