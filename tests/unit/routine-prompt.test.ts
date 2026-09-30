import { describe, expect, it } from 'vitest';

import { agentRemoteClient } from '../../src/backend/agent-remote-client';
import { routineClient } from '../../src/backend/routine-client';
import { parseRunnerLabels, planPromptRoutine } from '../../src/core/routine';

import type { AgentKeyRequester } from '../../src/backend/agent-remote-client';
import type { IntegrationRequester } from '../../src/backend/integration-contracts';
import type { RemoteRequester } from '../../src/backend/remote-session-client';

const valid = {
  name: ' Nightly triage ',
  prompt: ' Summarise failing tests ',
  model: ' GEMINI/gemini-2.5-flash ',
  repoRef: ' claw ',
  runnerLabels: ['gpu', 'gpu'],
  intervalMinutes: 60,
};

const promptRoutine = {
  id: 'r2',
  deviceId: null,
  kind: 'PROMPT',
  name: 'Nightly triage',
  command: 'Summarise failing tests',
  model: 'GEMINI/gemini-2.5-flash',
  repoRef: 'claw',
  runnerLabels: ['gpu'],
  intervalMinutes: 60,
  status: 'ENABLED',
  lastRunAt: null,
  nextRunAt: '2026-09-30T00:00:00.000Z',
};

describe('planPromptRoutine', () => {
  it('trims, drops blanks and de-duplicates labels', () => {
    expect(planPromptRoutine(valid)).toEqual({
      ok: true,
      request: {
        name: 'Nightly triage',
        prompt: 'Summarise failing tests',
        model: 'GEMINI/gemini-2.5-flash',
        repoRef: 'claw',
        runnerLabels: ['gpu'],
        intervalMinutes: 60,
      },
    });
    const bare = planPromptRoutine({ ...valid, model: ' ', repoRef: '' });
    expect(bare.ok && bare.request.model).toBeUndefined();
    expect(bare.ok && bare.request.repoRef).toBeUndefined();
  });

  it('names the field that is wrong', () => {
    expect(planPromptRoutine({ ...valid, prompt: ' ' })).toEqual({ ok: false, refusal: 'prompt' });
    expect(planPromptRoutine({ ...valid, prompt: 'x'.repeat(8_001) })).toEqual({
      ok: false,
      refusal: 'prompt',
    });
    expect(planPromptRoutine({ ...valid, model: 'm'.repeat(129) })).toEqual({
      ok: false,
      refusal: 'model',
    });
    expect(planPromptRoutine({ ...valid, repoRef: '../etc' })).toEqual({
      ok: false,
      refusal: 'repo',
    });
    expect(planPromptRoutine({ ...valid, runnerLabels: ['Bad Label'] })).toEqual({
      ok: false,
      refusal: 'labels',
    });
    expect(planPromptRoutine({ ...valid, intervalMinutes: 4 })).toEqual({
      ok: false,
      refusal: 'interval',
    });
  });

  it('parses comma-separated runner labels and rejects malformed ones', () => {
    expect(parseRunnerLabels(' GPU, linux ,, gpu')).toEqual(['gpu', 'linux']);
    expect(parseRunnerLabels('')).toEqual([]);
    expect(parseRunnerLabels('has space')).toBeUndefined();
  });
});

describe('routineClient.createPrompt', () => {
  it('posts a PROMPT routine with no device and reads the reply', async () => {
    const calls: unknown[] = [];
    const request: IntegrationRequester = (path, schema, options) => {
      calls.push({ path, options });
      return Promise.resolve(schema.parse(promptRoutine));
    };
    const plan = planPromptRoutine(valid);
    if (!plan.ok) throw new Error('plan refused');
    const created = await routineClient.createPrompt(request, plan.request);
    expect(created.deviceId).toBeNull();
    expect(calls).toEqual([
      {
        path: '/agent/scheduled-commands',
        options: {
          method: 'POST',
          body: {
            kind: 'PROMPT',
            name: 'Nightly triage',
            prompt: 'Summarise failing tests',
            runnerLabels: ['gpu'],
            intervalMinutes: 60,
            model: 'GEMINI/gemini-2.5-flash',
            repoRef: 'claw',
          },
        },
      },
    ]);
  });

  it('lists a mix of command and prompt routines', async () => {
    const request: IntegrationRequester = (_path, schema) =>
      Promise.resolve(
        schema.parse([promptRoutine, { ...promptRoutine, id: 'r1', deviceId: 'd1' }]),
      );
    const routines = await routineClient.list(request);
    expect(routines.map((routine) => routine.deviceId)).toEqual([null, 'd1']);
  });
});

describe('agentRemoteClient runner routes (F100)', () => {
  it('registers with an approval policy and keeps the runner token, not a session key', async () => {
    const bodies: unknown[] = [];
    const request: RemoteRequester = (_path, schema, options) => {
      bodies.push(options?.body);
      return Promise.resolve(
        schema.parse({ runnerId: 'runner-1', runnerToken: 'clwr_abc', sessionKey: 'nope' }),
      );
    };
    const registration = await agentRemoteClient.registerRunner(
      request,
      { hostname: 'box', platform: 'linux', agentVersion: '1.0.0' },
      { name: 'Box', labels: ['gpu'], approvalPolicy: 'AUTO_APPROVE_READ_ONLY' },
    );
    expect(registration).toEqual({ sessionId: 'runner-1', sessionKey: 'clwr_abc' });
    expect(bodies[0]).toMatchObject({ approvalPolicy: 'AUTO_APPROVE_READ_ONLY', labels: ['gpu'] });
  });

  it('heartbeats, claims and reports on the runner routes with the runner token', async () => {
    const calls: { path: string; credential: string | null; method: string | undefined }[] = [];
    const request: AgentKeyRequester = (path, schema, credential, options) => {
      calls.push({ path, credential, method: options?.method });
      return Promise.resolve(schema.parse(path.endsWith('/claim') ? [] : {}));
    };
    await agentRemoteClient.runnerHeartbeat(request, 'clwr_abc');
    await agentRemoteClient.claim(request, 'clwr_abc');
    await agentRemoteClient.runnerComplete(request, 'clwr_abc', 'job/1', {
      exitCode: 0,
      stdout: '',
      stderr: '',
    });
    expect(calls).toEqual([
      { path: '/agent/runners/heartbeat', credential: 'clwr_abc', method: 'POST' },
      { path: '/agent/runners/claim', credential: 'clwr_abc', method: 'POST' },
      { path: '/agent/runners/jobs/job%2F1/complete', credential: 'clwr_abc', method: 'POST' },
    ]);
  });
});
