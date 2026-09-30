import { describe, expect, it } from 'vitest';

import { createAgent } from '../../src/sdk/create-agent';
import { BUDGET_FAILED, COMPLETED, readCall, scriptedRuns } from '../helpers/scripted-runs';

import type { AgentEvent, AgentRunCallOptions } from '../../src/sdk/create-agent.types';

const loop = (count: number) => Array.from({ length: count }, (_, index) => readCall(index + 1));

async function run(scripts: Parameters<typeof scriptedRuns>[0], options: AgentRunCallOptions) {
  const runtime = scriptedRuns(scripts);
  const events: AgentEvent[] = [];
  const agent = createAgent({
    auth: { token: 't' },
    workspaceRoot: process.cwd(),
    transport: runtime.transport,
  });
  const result = await agent.run('build it', {
    ...options,
    onEvent: (event) => events.push(event),
  });
  return { runtime, events, result };
}

describe('a run that repeats one call', () => {
  it('sends the refusal as the tool result, and ends stuck at the eighth call', async () => {
    const { runtime, events, result } = await run([[...loop(12), COMPLETED]], {});

    expect(runtime.submitted).toHaveLength(8);
    const refused = runtime.submitted[2] as { structured: Record<string, unknown> };
    expect(refused.structured).toMatchObject({ repeatedCall: true, times: 3 });
    expect(String(refused.structured.previousResult)).toContain('"name"');
    expect(result).toMatchObject({
      outcome: 'failed',
      exitCode: 1,
      toolCalls: 8,
      stuck: { tool: 'workspace.file', operation: 'read', times: 8, target: 'package.json' },
    });
    expect(result.error).toMatch(/^STUCK: .*workspace\.file read on package\.json.* 8 times/u);
    expect(result.budgetExhausted).toBeUndefined();
    const stuck = events.filter((event) => event.type === 'run.stuck');
    expect(stuck).toEqual([
      { type: 'run.stuck', tool: 'workspace.file', operation: 'read', times: 8 },
    ]);
    expect(events.at(-1)).toMatchObject({ type: 'run.finished' });
  });

  it('does not stop a run that reads a file only twice', async () => {
    const { result } = await run([[...loop(2), COMPLETED]], {});

    expect(result).toMatchObject({ outcome: 'completed', exitCode: 0 });
    expect(result.stuck).toBeUndefined();
  });

  it('is continued by autoContinue with a prompt that names the loop, and counted', async () => {
    const { runtime, events, result } = await run(
      [
        [...loop(9), COMPLETED],
        [readCall(50), COMPLETED],
      ],
      { autoContinue: 2 },
    );

    expect(runtime.starts).toHaveLength(2);
    const prompt = runtime.starts[1]?.prompt ?? '';
    expect(prompt).toContain(
      'Your previous run got stuck repeating workspace.file read on package.json. Do something different',
    );
    expect(result).toMatchObject({ outcome: 'completed', exitCode: 0, continuations: 1 });
    expect(result.stuck).toBeUndefined();
    expect(events).toContainEqual({ type: 'run.continued', attempt: 1, reason: 'stuck' });
    expect(events.filter((event) => event.type === 'run.finished')).toHaveLength(1);
  });

  it('stays failed with the stuck report when every continuation loops again', async () => {
    const { runtime, result } = await run([[...loop(9)], [...loop(9)]], { autoContinue: 1 });

    expect(runtime.starts).toHaveLength(2);
    expect(result).toMatchObject({ outcome: 'failed', exitCode: 1, continuations: 1 });
    expect(result.stuck?.times).toBe(8);
    expect(result.error).toMatch(/^STUCK/u);
  });

  it('is not continued when autoContinue is 0, and a server budget end is not stuck', async () => {
    const stuck = await run([[...loop(9)]], {});
    expect(stuck.runtime.starts).toHaveLength(1);
    expect(stuck.result.continuations).toBeUndefined();

    const budget = await run([[readCall(1), BUDGET_FAILED]], {});
    expect(budget.result.budgetExhausted).toBe(true);
    expect(budget.result.stuck).toBeUndefined();
  });

  it("lets the caller's own guard win: exhausted, not stuck", async () => {
    const { result } = await run([[...loop(12)]], { maxToolCalls: 4 });

    expect(result.outcome).toBe('exhausted');
    expect(result.exitCode).toBe(5);
    expect(result.stuck).toBeUndefined();
  });
});
