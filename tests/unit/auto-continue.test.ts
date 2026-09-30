import { describe, expect, it } from 'vitest';

import { runHeadlessCli } from '../../src/headless/headless-cli';
import { createAgent } from '../../src/sdk/create-agent';
import { CONTINUATION_PROMPT } from '../../src/sdk/server-budget.constants';
import { BUDGET_FAILED, COMPLETED, readCall, scriptedRuns } from '../helpers/scripted-runs';

import type { RuntimeTransportPort } from '../../src/sdk/agent-sdk.types';
import type { AgentEvent, AgentRunCallOptions } from '../../src/sdk/create-agent.types';

const agentOn = (transport: RuntimeTransportPort) =>
  createAgent({ auth: { token: 't' }, workspaceRoot: process.cwd(), transport });

async function run(scripts: Parameters<typeof scriptedRuns>[0], options: AgentRunCallOptions) {
  const runtime = scriptedRuns(scripts);
  const events: AgentEvent[] = [];
  const agent = agentOn(runtime.transport);
  const result = await agent.run('build it', {
    ...options,
    onEvent: (event) => events.push(event),
  });
  return { runtime, events, result, agent };
}

describe('auto-continue in the SDK', () => {
  it('does not continue when autoContinue is 0, and reports budgetExhausted', async () => {
    const { runtime, result } = await run([[readCall(1), BUDGET_FAILED]], {});

    expect(runtime.starts).toHaveLength(1);
    expect(result.outcome).toBe('failed');
    expect(result.exitCode).toBe(1);
    expect(result.budgetExhausted).toBe(true);
    expect(result.continuations).toBeUndefined();
  });

  it('starts a new run on the same thread with the continuation prompt, and finishes', async () => {
    const { runtime, result, events } = await run(
      [
        [readCall(1), readCall(2), BUDGET_FAILED],
        [readCall(3), COMPLETED],
      ],
      { autoContinue: 3, budgetProfile: 'long' },
    );

    expect(runtime.starts).toHaveLength(2);
    expect(runtime.starts[1]?.threadId).toBe(runtime.starts[0]?.threadId);
    expect(runtime.starts[1]?.prompt).toBe(CONTINUATION_PROMPT);
    expect(runtime.starts[0]?.prompt).toContain('build it');
    expect(runtime.starts[1]?.budget.maxToolCalls).toBe(500);
    expect(result).toMatchObject({
      outcome: 'completed',
      exitCode: 0,
      toolCalls: 3,
      continuations: 1,
    });
    expect(result.budgetExhausted).toBeUndefined();
    const types = events.map((event) => event.type);
    expect(events).toContainEqual({
      type: 'run.continued',
      attempt: 1,
      reason: 'budget-exhausted',
    });
    expect(types.filter((type) => type === 'run.started')).toHaveLength(2);
    expect(types.filter((type) => type === 'run.finished')).toHaveLength(1);
    expect(types.at(-1)).toBe('run.finished');
  });

  it('continues after the 409 refusal of a tool result', async () => {
    const { runtime, result } = await run([['refuse-409'], [COMPLETED]], { autoContinue: 1 });

    expect(runtime.starts).toHaveLength(2);
    expect(result.outcome).toBe('completed');
    expect(result.continuations).toBe(1);
  });

  it('stops as exhausted (exit 5) when every continuation is used up', async () => {
    const { runtime, result } = await run(
      [
        [readCall(1), BUDGET_FAILED],
        [readCall(2), BUDGET_FAILED],
        [readCall(3), BUDGET_FAILED],
      ],
      { autoContinue: 2 },
    );

    expect(runtime.starts).toHaveLength(3);
    expect(result).toMatchObject({
      outcome: 'exhausted',
      exitCode: 5,
      toolCalls: 3,
      continuations: 2,
    });
    expect(result.error).toContain('every allowed continuation is used up');
  });

  it('never continues a failure that is not the server budget', async () => {
    const { runtime, result } = await run(
      [[readCall(1), { type: 'run.failed', payload: { code: 'CLOUD_PROVIDER_UNAVAILABLE' } }]],
      { autoContinue: 5 },
    );

    expect(runtime.starts).toHaveLength(1);
    expect(result.outcome).toBe('failed');
    expect(result.continuations).toBe(0);
    expect(result.budgetExhausted).toBeUndefined();
  });

  it('never continues a run that was cancelled', async () => {
    const controller = new AbortController();
    const runtime = scriptedRuns([[BUDGET_FAILED], [COMPLETED]]);
    const result = await agentOn(runtime.transport).run('x', {
      autoContinue: 3,
      signal: controller.signal,
      onEvent: (event) => {
        if (event.type === 'run.started') controller.abort();
      },
    });

    expect(runtime.starts).toHaveLength(1);
    expect(result.outcome).toBe('cancelled');
  });

  it('accumulates --max-tool-calls across runs: each run gets what is left', async () => {
    const { runtime, result, events } = await run(
      [
        [readCall(1), readCall(2), BUDGET_FAILED],
        [readCall(3), readCall(4), readCall(5), COMPLETED],
      ],
      { autoContinue: 3, maxToolCalls: 4 },
    );

    expect(runtime.starts).toHaveLength(2);
    expect(result.outcome).toBe('exhausted');
    expect(result.exitCode).toBe(5);
    expect(result.toolCalls).toBe(4);
    expect(events).toContainEqual({ type: 'budget.exhausted', budget: 'tool-calls', limit: 2 });
  });

  it('stops without a continuation once the tool-call guard has no room left', async () => {
    const { runtime, result } = await run(
      [[readCall(1), readCall(2), BUDGET_FAILED], [COMPLETED]],
      { autoContinue: 3, maxToolCalls: 2 },
    );

    expect(runtime.starts).toHaveLength(1);
    expect(result).toMatchObject({
      outcome: 'exhausted',
      exitCode: 5,
      toolCalls: 2,
      continuations: 0,
    });
    expect(result.error).toContain('no room left');
  });

  it('keeps the thread readable, and refuses an autoContinue out of range', async () => {
    const { agent } = await run([[COMPLETED]], { autoContinue: 1 });

    expect(agent.threadId).toBe('thread-1');
    await expect(agent.run('x', { autoContinue: 21 })).rejects.toThrow(RangeError);
    await expect(agent.run('x', { autoContinue: -1 })).rejects.toThrow(RangeError);
    await expect(agent.run('x', { autoContinue: 1.5 })).rejects.toThrow(RangeError);
  });
});

describe('auto-continue through the CLI', () => {
  const io = (lines: string[]) => ({
    stdout: (text: string) => lines.push(text),
    stderr: () => undefined,
  });
  const context = (transport: RuntimeTransportPort) => ({
    cwd: process.cwd(),
    transport,
    sessions: { latest: () => Promise.resolve(undefined), remember: () => Promise.resolve() },
  });
  const environment = { CLAW_TOKEN: 'token', CLAW_STATE_DIR: process.cwd() };

  it('continues by default, asks for the long budget, and writes run.continued in stream-json', async () => {
    const runtime = scriptedRuns([[readCall(1), BUDGET_FAILED], [COMPLETED]]);
    const lines: string[] = [];

    const code = await runHeadlessCli(
      ['-p', 'x', '--output-format', 'stream-json'],
      environment,
      io(lines),
      context(runtime.transport),
    );

    const parsed = lines.map((line) => JSON.parse(line) as { type: string; result?: unknown });
    expect(code).toBe(0);
    expect(runtime.starts[0]?.budget.maxToolResultBytes).toBe(1_048_576);
    expect(parsed.filter((event) => event.type === 'run.continued')).toEqual([
      { type: 'run.continued', attempt: 1, reason: 'budget-exhausted' },
    ]);
    expect(parsed.filter((event) => event.type === 'run.finished')).toHaveLength(1);
    expect(parsed.at(-1)?.result).toMatchObject({
      outcome: 'completed',
      continuations: 1,
      toolCalls: 1,
    });
  });

  it('runs once with --auto-continue 0: exit 1 and budgetExhausted in json', async () => {
    const runtime = scriptedRuns([[BUDGET_FAILED], [COMPLETED]]);
    const lines: string[] = [];

    const code = await runHeadlessCli(
      ['-p', 'x', '--output-format', 'json', '--auto-continue', '0', '--budget', 'default'],
      environment,
      io(lines),
      context(runtime.transport),
    );

    expect(code).toBe(1);
    expect(runtime.starts).toHaveLength(1);
    expect(runtime.starts[0]?.budget.maxToolResultBytes).toBe(262_144);
    expect(JSON.parse(lines.join('')) as unknown).toMatchObject({ budgetExhausted: true });
  });

  it('exits 5 when the continuations are used up', async () => {
    const runtime = scriptedRuns([[BUDGET_FAILED], [BUDGET_FAILED]]);

    const code = await runHeadlessCli(
      ['-p', 'x', '--auto-continue', '1'],
      environment,
      io([]),
      context(runtime.transport),
    );

    expect(code).toBe(5);
    expect(runtime.starts).toHaveLength(2);
  });
});
