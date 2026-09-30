import { describe, expect, it, vi } from 'vitest';

import { RuntimeHttpError } from '../../src/headless/runtime-http-error';
import { createAgent } from '../../src/sdk/create-agent';
import { SESSION_EXPIRED_PROMPT } from '../../src/sdk/server-budget.constants';
import { COMPLETED, readCall, scriptedRuns } from '../helpers/scripted-runs';

import type { RuntimeTransportPort } from '../../src/sdk/agent-sdk.types';
import type { AgentConfig, AgentEvent } from '../../src/sdk/create-agent.types';

const EXPIRED = '{"statusCode":401,"message":"Unauthorized"}';

async function runExpiring(auth: AgentConfig['auth'], autoContinue: number) {
  const runtime = scriptedRuns([
    [readCall(1), readCall(2)],
    [readCall(3), COMPLETED],
  ]);
  const signIn = vi.fn(async () => Promise.resolve('fresh-token'));
  const transport: RuntimeTransportPort = {
    ...runtime.transport,
    signIn,
    submitResult: (token, run, epochs, result) =>
      run.runId === 'run-1'
        ? Promise.reject(new RuntimeHttpError('/results', 401, EXPIRED))
        : runtime.transport.submitResult(token, run, epochs, result),
  };
  const events: AgentEvent[] = [];
  const result = await createAgent({ auth, workspaceRoot: process.cwd(), transport }).run('go', {
    autoContinue,
    onEvent: (event) => events.push(event),
  });
  return { runtime, events, result, signIn };
}

describe('an access token that expires during a long run', () => {
  it('signs in again and continues on the same thread', async () => {
    const { runtime, events, result, signIn } = await runExpiring(
      { email: 'a@b.c', password: 'pw-secret' },
      2,
    );

    expect(signIn).toHaveBeenCalledTimes(2);
    expect(runtime.starts[1]?.threadId).toBe(runtime.starts[0]?.threadId);
    expect(runtime.starts[1]?.prompt).toBe(SESSION_EXPIRED_PROMPT);
    expect(events).toContainEqual({ type: 'run.continued', attempt: 1, reason: 'session-expired' });
    expect(result).toMatchObject({ outcome: 'completed', continuations: 1 });
  });

  it('cannot renew a static token, so it stays unauthenticated', async () => {
    const { runtime, result } = await runExpiring({ token: 'static' }, 2);

    expect(runtime.starts).toHaveLength(1);
    expect(result.outcome).toBe('unauthenticated');
    expect(result.exitCode).toBe(3);
  });

  it('does not continue with autoContinue 0', async () => {
    const { runtime, result } = await runExpiring({ email: 'a@b.c', password: 'pw-secret' }, 0);

    expect(runtime.starts).toHaveLength(1);
    expect(result.outcome).toBe('unauthenticated');
  });
});
