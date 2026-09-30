import { describe, expect, it } from 'vitest';

import { RuntimeHttpError } from '../../src/headless/runtime-http-error';
import { runAgent } from '../../src/sdk/agent-sdk';
import { AGENT_SDK_DEFAULTS } from '../../src/sdk/agent-sdk.constants';
import {
  profileDeadlineMs,
  resolveRunBudget,
  resultByteLimit,
} from '../../src/sdk/budget-profiles';
import { AGENT_BUDGET_PROFILES } from '../../src/sdk/budget-profiles.constants';
import {
  isServerBudgetError,
  isServerBudgetEvent,
  withResultBudgetNotes,
} from '../../src/sdk/server-budget';
import { BUDGET_FAILED, COMPLETED, scriptedRuns } from '../helpers/scripted-runs';

import type { AgentToolkit } from '../../src/sdk/agent-sdk.types';

const noTools: AgentToolkit = { definitions: [], execute: () => ({}) };

describe('budget profiles', () => {
  it('keeps the SDK default profile equal to the documented defaults', () => {
    expect(AGENT_BUDGET_PROFILES.default).toEqual(AGENT_SDK_DEFAULTS.budget);
    expect(profileDeadlineMs(undefined)).toBe(AGENT_SDK_DEFAULTS.deadlineMs);
  });

  it('makes long the runtime maxima', () => {
    expect(AGENT_BUDGET_PROFILES.long).toMatchObject({
      maxModelTurns: 100,
      maxToolCalls: 500,
      maxToolRounds: 100,
      maxRuntimeMs: 7_200_000,
      maxToolResultBytes: 1_048_576,
    });
    expect(profileDeadlineMs('long')).toBe(7_200_000);
    expect(resultByteLimit('long')).toBe(1_048_576);
    expect(resultByteLimit(undefined)).toBe(262_144);
  });

  it('lets explicit fields win over the profile, and the deadline set the runtime limit', () => {
    const budget = resolveRunBudget('long', 60_000, { maxToolCalls: 7 });

    expect(budget.maxToolCalls).toBe(7);
    expect(budget.maxModelTurns).toBe(100);
    expect(budget.maxRuntimeMs).toBe(60_000);
  });

  it('sends the default budget when no profile is given, and long when asked', async () => {
    const plain = scriptedRuns([[COMPLETED]]);
    const long = scriptedRuns([[COMPLETED]]);

    await runAgent({ prompt: 'x', toolkit: noTools, token: 't', transport: plain.transport });
    await runAgent({
      prompt: 'x',
      toolkit: noTools,
      token: 't',
      transport: long.transport,
      budgetProfile: 'long',
      budget: { maxModelTurns: 30 },
    });

    expect(plain.starts[0]?.budget).toEqual(AGENT_SDK_DEFAULTS.budget);
    expect(long.starts[0]?.budget).toMatchObject({
      maxToolCalls: 500,
      maxToolResultBytes: 1_048_576,
      maxRuntimeMs: 7_200_000,
      maxModelTurns: 30,
    });
  });
});

describe('server budget detection', () => {
  it('reads a run.failed carrying the budget code, and nothing else', () => {
    expect(isServerBudgetEvent(BUDGET_FAILED)).toBe(true);
    expect(isServerBudgetEvent({ type: 'run.failed', payload: { code: 'OTHER' } })).toBe(false);
    expect(isServerBudgetEvent({ type: 'run.failed' })).toBe(false);
    expect(
      isServerBudgetEvent({ type: 'run.completed', payload: { code: 'RUNTIME_BUDGET_EXHAUSTED' } }),
    ).toBe(false);
  });

  it('reads the 409 refusal by its code or its text, and no other status', () => {
    expect(isServerBudgetError(new RuntimeHttpError('/r', 409, 'RUNTIME_BUDGET_EXHAUSTED'))).toBe(
      true,
    );
    expect(
      isServerBudgetError(new RuntimeHttpError('/r', 409, 'used all of its allowed tool calls')),
    ).toBe(true);
    expect(isServerBudgetError(new RuntimeHttpError('/r', 409, 'STALE_CLAIM'))).toBe(false);
    expect(isServerBudgetError(new RuntimeHttpError('/r', 500, 'RUNTIME_BUDGET_EXHAUSTED'))).toBe(
      false,
    );
    expect(isServerBudgetError(new Error('RUNTIME_BUDGET_EXHAUSTED'))).toBe(false);
  });
});

describe('result budget notes', () => {
  const call = { toolName: 'workspace.file', operation: 'read', arguments: {} };
  const big = (bytes: number): AgentToolkit => ({
    definitions: [],
    execute: () => ({ content: 'x'.repeat(bytes) }),
  });

  it('adds no note while under 75% of the result budget', async () => {
    const toolkit = withResultBudgetNotes(big(100), 1_000);

    expect(await toolkit.execute(call)).not.toHaveProperty('budgetNote');
    expect(await toolkit.execute(call)).not.toHaveProperty('budgetNote');
  });

  it('adds a note to the result after 75% is used, then again after 90%, once each', async () => {
    const toolkit = withResultBudgetNotes(big(400), 1_000);

    const first = await toolkit.execute(call);
    const second = await toolkit.execute(call);
    const third = await toolkit.execute(call);
    const fourth = await toolkit.execute(call);
    const fifth = await toolkit.execute(call);

    expect(first).not.toHaveProperty('budgetNote');
    expect(second).not.toHaveProperty('budgetNote');
    expect(third).toMatchObject({
      budgetNote: "82% of this run's result budget is used; prefer search and small ranges",
    });
    expect(fourth).toMatchObject({ budgetNote: expect.stringContaining('% of this run') });
    expect(fifth).not.toHaveProperty('budgetNote');
  });

  it('keeps a note pending across a result that is not an object', async () => {
    const results: unknown[] = [{ content: 'x'.repeat(800) }, 'plain text', { ok: true }];
    const toolkit = withResultBudgetNotes(
      { definitions: [], execute: () => results.shift() },
      1_000,
    );

    await toolkit.execute(call);
    const text = await toolkit.execute(call);
    const object = await toolkit.execute(call);

    expect(text).toBe('plain text');
    expect(object).toMatchObject({
      ok: true,
      budgetNote: expect.stringContaining('prefer search'),
    });
  });
});
