import { describe, expect, it } from 'vitest';

import { createAgent } from '../../src/sdk/create-agent';
import { COMPLETED, scriptedRuns } from '../helpers/scripted-runs';

import type { HeadlessStreamEvent } from '../../src/headless/headless-session.types';
import type { AgentEvent } from '../../src/sdk/create-agent.types';

/** A read of a different file each time, so the repetition guard has nothing to object to. */
const readCall = (index: number): HeadlessStreamEvent => ({
  type: 'tool.requested',
  payload: {
    invocationId: `i-${String(index)}`,
    toolName: 'workspace.file',
    operation: 'read',
    invocation: { arguments: { path: `file-${String(index)}.txt` } },
  },
});

const tenReads = Array.from({ length: 10 }, (_, index) => readCall(index + 1));

async function runLow(scripts: Parameters<typeof scriptedRuns>[0], autoContinue: number) {
  const runtime = scriptedRuns(scripts);
  const events: AgentEvent[] = [];
  const agent = createAgent({
    auth: { token: 't' },
    workspaceRoot: process.cwd(),
    transport: runtime.transport,
    effort: 'LOW',
  });
  const result = await agent.run('read ten files', {
    autoContinue,
    onEvent: (e) => events.push(e),
  });
  return { runtime, events, result };
}

describe('a run that ends having spent its whole effort allowance of tool calls', () => {
  it('is reported as exhausted (exit 5) with a budget event, not as completed', async () => {
    const { result, events } = await runLow([[...tenReads, COMPLETED]], 0);

    expect(result.outcome).toBe('exhausted');
    expect(result.exitCode).toBe(5);
    expect(result.budgetExhausted).toBe(true);
    expect(result.error).toContain('10');
    expect(events).toContainEqual({ type: 'budget.exhausted', budget: 'tool-calls', limit: 10 });
  });

  it('is continued on the same thread when auto-continue allows it', async () => {
    const { runtime, result } = await runLow(
      [
        [...tenReads, COMPLETED],
        [readCall(11), COMPLETED],
      ],
      2,
    );

    expect(runtime.starts).toHaveLength(2);
    expect(result).toMatchObject({ outcome: 'completed', exitCode: 0, continuations: 1 });
  });

  it('stays completed when the run finished under its allowance', async () => {
    const { result, events } = await runLow([[readCall(1), COMPLETED]], 0);

    expect(result.outcome).toBe('completed');
    expect(result.exitCode).toBe(0);
    expect(result.budgetExhausted).toBeUndefined();
    expect(events.some((event) => event.type === 'budget.exhausted')).toBe(false);
  });
});
