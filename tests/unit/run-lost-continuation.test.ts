import { describe, expect, it } from 'vitest';

import { RuntimeHttpError } from '../../src/headless/runtime-http-error';
import { createAgent } from '../../src/sdk/create-agent';
import { CONTINUATION_PROMPT, RUN_LOST_PROMPT } from '../../src/sdk/server-budget.constants';
import { COMPLETED, readCall, scriptedRuns } from '../helpers/scripted-runs';

import type { RuntimeTransportPort } from '../../src/sdk/agent-sdk.types';
import type { AgentEvent, AgentRunCallOptions } from '../../src/sdk/create-agent.types';

const NOT_FOUND = '{"code":"RUNTIME_RUN_NOT_FOUND","message":"Runtime run was not found"}';

/** The first run's tool result is refused with `refusal`; every later run behaves as scripted. */
async function runLosing(refusal: RuntimeHttpError, options: AgentRunCallOptions) {
  const runtime = scriptedRuns([
    [readCall(1), readCall(2)],
    [readCall(3), COMPLETED],
  ]);
  let refused = 0;
  const transport: RuntimeTransportPort = {
    ...runtime.transport,
    submitResult: (token, run, epochs, result) => {
      if (run.runId === 'run-1') {
        refused += 1;
        return Promise.reject(refusal);
      }
      return runtime.transport.submitResult(token, run, epochs, result);
    },
  };
  const events: AgentEvent[] = [];
  const agent = createAgent({
    auth: { token: 'test-token-abc' },
    workspaceRoot: process.cwd(),
    transport,
  });
  const result = await agent.run('build it', {
    ...options,
    onEvent: (event) => events.push(event),
  });
  return { runtime, events, result, refused: () => refused };
}

describe('a run the runtime no longer knows', () => {
  it('continues on the same thread with the run-lost prompt and finishes', async () => {
    const { runtime, events, result } = await runLosing(
      new RuntimeHttpError('/results', 404, NOT_FOUND),
      { autoContinue: 2 },
    );

    expect(runtime.starts).toHaveLength(2);
    expect(runtime.starts[1]?.threadId).toBe(runtime.starts[0]?.threadId);
    expect(runtime.starts[1]?.prompt).toBe(RUN_LOST_PROMPT);
    expect(RUN_LOST_PROMPT).toContain('check the current state of the workspace (git status');
    expect(RUN_LOST_PROMPT).not.toBe(CONTINUATION_PROMPT);
    expect(events).toContainEqual({ type: 'run.continued', attempt: 1, reason: 'run-lost' });
    expect(result).toMatchObject({ outcome: 'completed', exitCode: 0, continuations: 1 });
    expect(result.runLost).toBeUndefined();
  });

  it.each([
    ['a terminal run', 'Runtime transition was denied: RUN_TERMINAL'],
    ['a stale claim', 'Runtime transition was denied: STALE_CLAIM'],
  ])('treats %s as lost', async (_name, body) => {
    const { runtime, result } = await runLosing(new RuntimeHttpError('/results', 409, body), {
      autoContinue: 1,
    });

    expect(runtime.starts).toHaveLength(2);
    expect(result.continuations).toBe(1);
    expect(result.outcome).toBe('completed');
  });

  it('does not continue with autoContinue 0, and says the run was lost', async () => {
    const { runtime, result } = await runLosing(
      new RuntimeHttpError('/results', 404, NOT_FOUND),
      {},
    );

    expect(runtime.starts).toHaveLength(1);
    expect(result).toMatchObject({ outcome: 'failed', exitCode: 1, runLost: true });
    expect(result.continuations).toBeUndefined();
  });

  it('stops when the continuations are used up and the run is still lost', async () => {
    const runtime = scriptedRuns([[readCall(1)], [readCall(2)], [readCall(3)]]);
    const transport: RuntimeTransportPort = {
      ...runtime.transport,
      submitResult: () => Promise.reject(new RuntimeHttpError('/results', 404, NOT_FOUND)),
    };
    const agent = createAgent({
      auth: { token: 'test-token-abc' },
      workspaceRoot: process.cwd(),
      transport,
    });

    const result = await agent.run('build it', { autoContinue: 2 });

    expect(runtime.starts).toHaveLength(3);
    expect(result).toMatchObject({
      outcome: 'failed',
      exitCode: 1,
      continuations: 2,
      runLost: true,
    });
  });

  it('does not treat a missing thread or a 400 as a lost run', async () => {
    for (const refusal of [
      new RuntimeHttpError('/results', 404, 'ChatThread not found'),
      new RuntimeHttpError('/results', 400, NOT_FOUND),
    ]) {
      const { runtime, result } = await runLosing(refusal, { autoContinue: 3 });
      expect(runtime.starts).toHaveLength(1);
      expect(result.outcome).toBe('failed');
      expect(result.runLost).toBeUndefined();
    }
  });
});
