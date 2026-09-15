import { describe, expect, it } from 'vitest';

import { declareGoal, goalPermitsEnd, openChecks, resolveCheck } from '../../src/core/run-goal';
import { MAX_GOAL_CHECKS } from '../../src/core/run-goal.constants';
import { GoalToolExecutor, goalToolDefinition } from '../../src/infrastructure/goal-tool-executor';

import type { RunGoal } from '../../src/core/run-goal.types';
import type { ToolInvocation } from '../../src/core/runtime/runtime-tool-contracts';

function goalWith(checks: string[]): RunGoal {
  const result = declareGoal(undefined, 'Ship the parser fix', checks);
  if (!result.declared) throw new Error(result.refusal);
  return result.goal;
}

function invocation(operation: string, args: Record<string, unknown>): ToolInvocation {
  return { toolName: goalToolDefinition.name, operation, arguments: args } as ToolInvocation;
}

describe('declareGoal', () => {
  it('records the checks a run will be held to', () => {
    const goal = goalWith(['tests pass', 'no new lint errors']);

    expect(goal.checks.map((check) => check.text)).toEqual(['tests pass', 'no new lint errors']);
    expect(goal.checks.every((check) => check.state === 'open')).toBe(true);
  });

  it('refuses a goal with no checks, which could not be held to anything', () => {
    expect(declareGoal(undefined, 'do the thing', [])).toMatchObject({ declared: false });
  });

  it('refuses more checks than a reader can hold at once', () => {
    const many = Array.from(
      { length: MAX_GOAL_CHECKS + 1 },
      (_, index) => `check ${String(index)}`,
    );

    expect(declareGoal(undefined, 'goal', many)).toMatchObject({ declared: false });
  });

  it('drops duplicate checks rather than counting one thing twice', () => {
    expect(goalWith(['tests pass', 'tests pass']).checks).toHaveLength(1);
  });

  it('refuses to replace a goal that still has open checks', () => {
    const existing = goalWith(['tests pass']);

    expect(declareGoal(existing, 'a smaller goal', ['nothing'])).toMatchObject({
      declared: false,
    });
  });

  it('allows a new goal once the previous one is settled', () => {
    const settled = resolveCheck(goalWith(['tests pass']), 'check-1', 'met', 'suite is green');
    if (!settled.resolved) throw new Error(settled.refusal);

    expect(declareGoal(settled.goal, 'next goal', ['ship it'])).toMatchObject({ declared: true });
  });
});

describe('resolveCheck', () => {
  it('settles a check with the evidence that proves it', () => {
    const result = resolveCheck(goalWith(['tests pass']), 'check-1', 'met', '2148 tests green');
    if (!result.resolved) throw new Error(result.refusal);

    expect(result.goal.checks[0]).toMatchObject({ state: 'met', evidence: '2148 tests green' });
  });

  it('refuses a waiver with no real reason, which is how a run deletes its own test', () => {
    expect(resolveCheck(goalWith(['tests pass']), 'check-1', 'waived', 'n/a')).toMatchObject({
      resolved: false,
    });
  });

  it('accepts a waiver that says why the check no longer applies', () => {
    const result = resolveCheck(
      goalWith(['the migration runs']),
      'check-1',
      'waived',
      'The schema change was reverted, so there is no migration to run.',
    );

    expect(result).toMatchObject({ resolved: true });
  });

  it('refuses a check that does not exist rather than inventing one', () => {
    expect(resolveCheck(goalWith(['a']), 'check-9', 'met', 'done')).toMatchObject({
      resolved: false,
    });
  });

  it('refuses when no goal was declared at all', () => {
    expect(resolveCheck(undefined, 'check-1', 'met', 'done')).toMatchObject({ resolved: false });
  });
});

describe('goalPermitsEnd', () => {
  it('lets a run with no goal end exactly as before', () => {
    expect(goalPermitsEnd(undefined, 'completed')).toEqual({ allowed: true });
  });

  it('refuses to complete while a check is open, and names it', () => {
    const decision = goalPermitsEnd(goalWith(['tests pass']), 'completed');

    expect(decision.allowed).toBe(false);
    if (!decision.allowed) expect(decision.refusal).toContain('tests pass');
  });

  it('always lets a run abandon, rather than trapping it against its own goal', () => {
    expect(goalPermitsEnd(goalWith(['tests pass']), 'abandoned')).toEqual({ allowed: true });
  });

  it('lets a run complete once every check is settled, met or waived', () => {
    const met = resolveCheck(goalWith(['tests pass']), 'check-1', 'met', 'green');
    if (!met.resolved) throw new Error(met.refusal);

    expect(openChecks(met.goal)).toHaveLength(0);
    expect(goalPermitsEnd(met.goal, 'completed')).toEqual({ allowed: true });
  });
});

describe('GoalToolExecutor', () => {
  function harness() {
    let goal: RunGoal | undefined;
    return {
      executor: new GoalToolExecutor({
        read: () => goal,
        write: (next) => {
          goal = next;
        },
      }),
      goal: () => goal,
    };
  }

  it('declares a goal and reports the check ids the run must resolve', async () => {
    const seat = harness();

    const output = await seat.executor.execute(
      invocation('declare', { statement: 'Fix the parser', checks: ['tests pass'] }),
    );

    expect(output.structured).toEqual({
      declared: true,
      checks: [{ id: 'check-1', text: 'tests pass' }],
    });
  });

  it('reports a refusal rather than ending the run over a bookkeeping call', async () => {
    const seat = harness();
    await seat.executor.execute(
      invocation('declare', { statement: 'Fix the parser', checks: ['tests pass'] }),
    );

    const output = await seat.executor.execute(
      invocation('declare', { statement: 'Something smaller', checks: ['nothing'] }),
    );

    expect(output.structured).toMatchObject({ declared: false });
  });

  it('reports what is still open after a resolve', async () => {
    const seat = harness();
    await seat.executor.execute(
      invocation('declare', { statement: 'Fix it', checks: ['tests pass', 'docs updated'] }),
    );

    const output = await seat.executor.execute(
      invocation('resolve', { checkId: 'check-1', state: 'met', evidence: 'green' }),
    );

    expect(output.structured).toEqual({ resolved: true, open: ['check-2'] });
  });

  it('reports nothing declared before a goal exists', async () => {
    const output = await harness().executor.execute(invocation('status', {}));

    expect(output.structured).toEqual({ declared: false, statement: '', checks: [] });
  });
});
