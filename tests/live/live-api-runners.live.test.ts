/**
 * The live API lane, part: runners, routines, sessions. Excluded from `npm test`; run with
 * `npm run test:live-api`.
 *
 * Calls real routes through the extension's own clients and parses every
 * answer with the extension's own zod schemas, so a backend shape change fails
 * here rather than in a user's editor. Everything created is deleted at the
 * end, and the route table (status and shape per route) is printed and written
 * to `test-results/`.
 */
import { randomUUID } from 'node:crypto';

import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { z } from 'zod';

import { agentRemoteClient } from '../../src/backend/agent-remote-client';
import { remoteJobClient } from '../../src/backend/remote-job-client';
import { remoteSessionClient } from '../../src/backend/remote-session-client';
import { routineClient } from '../../src/backend/routine-client';

import {
  accessToken,
  defects,
  finishLane,
  liveAgentKeyRequester,
  rawCall,
  refusedStatus,
  request,
  signIn,
  suffix,
  until,
  onCleanup,
} from './live-api.helpers';

beforeAll(async () => {
  await signIn();
}, 120_000);

afterAll(async () => {
  const outcome = await finishLane('runners');
  expect(outcome.shapeFailures).toEqual([]);
  expect(outcome.cleanupFailures).toEqual([]);
}, 300_000);

describe('live API lane: runners', () => {
  it('runners: register, heartbeat, claim, complete, prompt routine, trigger idempotency, rotate, revoke', async () => {
    const host = {
      hostname: `live-lane-${suffix}`,
      platform: process.platform,
      agentVersion: '0.0.0',
    };
    const label = `live-${suffix}`;
    const registration = await agentRemoteClient.registerRunner(request, host, {
      name: `Live lane ${suffix}`,
      labels: [label],
      approvalPolicy: 'ASK',
    });
    const runnerId = registration.sessionId;
    onCleanup(`runner ${runnerId}`, () => rawCall('DELETE', `/agent/runners/${runnerId}`));
    let token = registration.sessionKey;

    await agentRemoteClient.runnerHeartbeat(liveAgentKeyRequester, token);
    expect(await agentRemoteClient.claim(liveAgentKeyRequester, token)).toEqual([]);
    expect(
      await refusedStatus(
        agentRemoteClient.runnerHeartbeat(liveAgentKeyRequester, 'not-a-runner-token'),
      ),
    ).toBe(401);
    // A user JWT is not a runner credential.
    expect(
      await refusedStatus(
        agentRemoteClient.runnerHeartbeat(liveAgentKeyRequester, await accessToken()),
      ),
    ).toBe(401);

    const connected = await remoteSessionClient.connectedRunners(request);
    const all = await remoteSessionClient.allRunners(request);
    expect(all.map((entry) => entry.id)).toContain(runnerId);
    expect(connected.length).toBeLessThanOrEqual(all.length);
    await remoteSessionClient.runnerRepos(request, runnerId);
    await remoteSessionClient.sessionCommands(request, runnerId);

    // Owner dispatch of a shell job to the runner.
    const job = await request(
      `/agent/runners/${runnerId}/jobs`,
      z
        .object({
          id: z.string(),
          status: z.string(),
          riskReasons: z.string().nullable().optional(),
        })
        .loose(),
      { method: 'POST', body: { command: 'echo live-lane', labels: [label] } },
    );
    if (job.status === 'REJECTED') {
      defects.push(
        `POST /agent/runners/:id/jobs REJECTED a plain "echo live-lane": ${job.riskReasons ?? 'no reason'}`,
      );
    }
    // A rejected or unapproved job is never handed to a runner.
    expect(await agentRemoteClient.claim(liveAgentKeyRequester, token)).toEqual([]);

    // Prompt routine (F099) on this runner, paused, triggered, and removed.
    const routine = await routineClient.createPrompt(request, {
      name: `Live lane ${suffix}`,
      prompt: 'Say pong.',
      runnerLabels: [label],
      intervalMinutes: 1_440,
    });
    onCleanup(`routine ${routine.id}`, () => routineClient.remove(request, routine.id));
    expect(routine.deviceId).toBeNull();
    expect(routine.kind).toBe('PROMPT');
    expect((await routineClient.list(request)).map((entry) => entry.id)).toContain(routine.id);
    expect((await routineClient.setStatus(request, routine.id, 'PAUSED')).status).toBe('PAUSED');
    expect((await routineClient.setStatus(request, routine.id, 'ENABLED')).status).toBe('ENABLED');
    await routineClient.devices(request);

    const remote = remoteJobClient(request);
    const listed = await remote.list();
    expect(listed.jobs.map((entry) => entry.id)).toContain(routine.id);
    const key = `live.${suffix}.${randomUUID().slice(0, 8)}`;
    const first = await remote.trigger(routine.id, key);
    const second = await remote.trigger(routine.id, key);
    expect(first.replayed).toBe(false);
    expect(second.replayed).toBe(true);
    expect(second.command.id).toBe(first.command.id);
    const other = await remote.trigger(routine.id, `${key}-2`);
    expect(other.command.id).not.toBe(first.command.id);
    expect(await refusedStatus(remote.trigger(routine.id, 'short'))).toBe(400);
    expect(await refusedStatus(remote.trigger('no-such-routine-000000000', key))).toBe(404);
    await remote.status(first.command.id);

    if (/PENDING|APPROVAL/iu.test(first.command.status)) {
      expect((await rawCall('POST', `/agent/commands/${first.command.id}/approve`)).status).toBe(
        200,
      );
    }
    const claimedPrompt = await until(
      () => agentRemoteClient.claim(liveAgentKeyRequester, token),
      (list) => list.length > 0,
      20_000,
      2_000,
    );
    expect(
      claimedPrompt.map((entry) => entry.id),
      `the runner claimed nothing for a triggered prompt routine (status ${first.command.status})`,
    ).toContain(first.command.id);
    expect(claimedPrompt.find((entry) => entry.id === first.command.id)?.kind).toBe('PROMPT');
    expect(
      await refusedStatus(
        agentRemoteClient.runnerComplete(
          liveAgentKeyRequester,
          'clwr_not_a_real_token',
          first.command.id,
          {
            exitCode: 0,
            stdout: '',
            stderr: '',
          },
        ),
      ),
    ).toBe(401);
    await agentRemoteClient.runnerComplete(liveAgentKeyRequester, token, first.command.id, {
      exitCode: 0,
      stdout: 'pong',
      stderr: '',
    });
    expect((await remote.status(first.command.id)).status).toMatch(
      /EXECUTED|COMPLETED|SUCCEEDED|DONE/iu,
    );

    // Rotation: the old token dies at once, the new one works, revocation kills that too.
    const rotated = await request(
      `/agent/runners/${runnerId}/credential/rotate`,
      z.object({ runnerId: z.string(), runnerToken: z.string().min(1) }).loose(),
      { method: 'POST' },
    );
    expect(rotated.runnerToken).not.toBe(token);
    expect(
      await refusedStatus(agentRemoteClient.runnerHeartbeat(liveAgentKeyRequester, token)),
    ).toBe(401);
    token = rotated.runnerToken;
    await agentRemoteClient.runnerHeartbeat(liveAgentKeyRequester, token);
    expect((await rawCall('DELETE', `/agent/runners/${runnerId}`)).status).toBe(204);
    expect(
      await refusedStatus(agentRemoteClient.runnerHeartbeat(liveAgentKeyRequester, token)),
    ).toBe(401);
    expect(await refusedStatus(agentRemoteClient.claim(liveAgentKeyRequester, token))).toBe(401);
  }, 120_000);

  it('editor session: register, heartbeat, pending, delete', async () => {
    const registration = await agentRemoteClient.registerSession(request, {
      hostname: `live-lane-${suffix}`,
      platform: process.platform,
      agentVersion: '0.0.0',
    });
    onCleanup(`session ${registration.sessionId}`, () =>
      rawCall('DELETE', `/agent/sessions/${registration.sessionId}`),
    );
    await agentRemoteClient.heartbeat(liveAgentKeyRequester, registration);
    expect(await agentRemoteClient.pending(liveAgentKeyRequester, registration.sessionKey)).toEqual(
      [],
    );
  });
});
