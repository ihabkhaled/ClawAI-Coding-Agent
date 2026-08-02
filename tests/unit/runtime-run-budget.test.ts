import { describe, expect, it } from 'vitest';

import {
  consumeRuntimeBudget,
  createRuntimeBudgetState,
} from '../../src/core/runtime/runtime-run-budget';

const budget = {
  maxModelTurns: 2,
  maxToolCalls: 3,
  maxToolRounds: 2,
  maxRepairAttempts: 1,
  maxRuntimeMs: 10_000,
  maxOutputBytes: 4_096,
  maxToolResultBytes: 2_048,
};

describe('runtime run budget', () => {
  it('immutably accounts for every bounded dimension', () => {
    const initial = createRuntimeBudgetState(budget, 1_000);
    const next = consumeRuntimeBudget(
      initial,
      {
        modelTurns: 1,
        toolCalls: 1,
        toolRounds: 1,
        repairAttempts: 1,
        outputBytes: 1_024,
        toolResultBytes: 512,
      },
      2_000,
    );

    expect(initial.usage).toEqual({
      modelTurns: 0,
      toolCalls: 0,
      toolRounds: 0,
      repairAttempts: 0,
      outputBytes: 0,
      toolResultBytes: 0,
    });
    expect(next.usage).toMatchObject({ modelTurns: 1, toolCalls: 1, outputBytes: 1_024 });
  });

  it.each([
    ['modelTurns', { modelTurns: 3 }, /model turn/i],
    ['toolCalls', { toolCalls: 4 }, /tool call/i],
    ['toolRounds', { toolRounds: 3 }, /tool round/i],
    ['repairAttempts', { repairAttempts: 2 }, /repair/i],
    ['outputBytes', { outputBytes: 4_097 }, /output byte/i],
    ['toolResultBytes', { toolResultBytes: 2_049 }, /tool result byte/i],
  ])('fails closed when %s is exhausted', (_name, debit, message) => {
    const initial = createRuntimeBudgetState(budget, 1_000);
    expect(() => consumeRuntimeBudget(initial, debit, 1_001)).toThrow(message);
    expect(initial.usage.toolCalls).toBe(0);
  });

  it('fails closed after the wall-clock deadline', () => {
    const initial = createRuntimeBudgetState(budget, 1_000);
    expect(() => consumeRuntimeBudget(initial, {}, 11_001)).toThrow(/wall-clock/i);
  });

  it('rejects time reversal and invalid debit values', () => {
    const initial = createRuntimeBudgetState(budget, 1_000);
    expect(() => consumeRuntimeBudget(initial, {}, 999)).toThrow(/clock/i);
    expect(() => consumeRuntimeBudget(initial, { toolCalls: -1 }, 1_001)).toThrow(/nonnegative/i);
    expect(() => consumeRuntimeBudget(initial, { toolCalls: 0.5 }, 1_001)).toThrow(/integer/i);
  });

  it('accumulates across calls and accepts exact limits', () => {
    const initial = createRuntimeBudgetState(budget, 1_000);
    const first = consumeRuntimeBudget(initial, { toolCalls: 1, outputBytes: 1_000 }, 2_000);
    const final = consumeRuntimeBudget(
      first,
      { toolCalls: 2, outputBytes: 3_096, toolResultBytes: 2_048 },
      11_000,
    );
    expect(final.usage).toMatchObject({
      toolCalls: 3,
      outputBytes: 4_096,
      toolResultBytes: 2_048,
    });
  });
});
