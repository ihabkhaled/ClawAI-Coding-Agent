import { describe, expect, it } from 'vitest';

import { routineClient } from '../../src/backend/routine-client';
import { planRoutine, toggledRoutineStatus } from '../../src/core/routine';

import type { IntegrationRequester } from '../../src/backend/integration-contracts';

const valid = {
  deviceId: 'dev-1',
  name: ' Nightly tests ',
  command: ' npm test ',
  intervalMinutes: 60,
};

function requester(response: unknown): { request: IntegrationRequester; calls: unknown[] } {
  const calls: unknown[] = [];
  const request: IntegrationRequester = (path, schema, options) => {
    calls.push({ path, options });
    return Promise.resolve(schema.parse(response));
  };
  return { request, calls };
}

const routine = {
  id: 'r1',
  deviceId: 'dev-1',
  name: 'Nightly tests',
  command: 'npm test',
  intervalMinutes: 60,
  status: 'ENABLED',
  lastRunAt: null,
  nextRunAt: '2026-09-30T00:00:00.000Z',
  userId: 'ignored-extra-field',
};

describe('planRoutine', () => {
  it('trims and accepts a routine inside the bounds', () => {
    expect(planRoutine(valid)).toEqual({
      ok: true,
      request: {
        deviceId: 'dev-1',
        name: 'Nightly tests',
        command: 'npm test',
        intervalMinutes: 60,
      },
    });
  });

  it('names the field that is wrong', () => {
    expect(planRoutine({ ...valid, deviceId: ' ' })).toEqual({ ok: false, refusal: 'device' });
    expect(planRoutine({ ...valid, name: '' })).toEqual({ ok: false, refusal: 'name' });
    expect(planRoutine({ ...valid, command: 'x'.repeat(4_097) })).toEqual({
      ok: false,
      refusal: 'command',
    });
    expect(planRoutine({ ...valid, intervalMinutes: 4 })).toEqual({
      ok: false,
      refusal: 'interval',
    });
    expect(planRoutine({ ...valid, intervalMinutes: 10_081 })).toEqual({
      ok: false,
      refusal: 'interval',
    });
    expect(planRoutine({ ...valid, intervalMinutes: Number.NaN })).toEqual({
      ok: false,
      refusal: 'interval',
    });
  });

  it('pauses an enabled routine and resumes anything else', () => {
    expect(toggledRoutineStatus('ENABLED')).toBe('PAUSED');
    expect(toggledRoutineStatus('PAUSED')).toBe('ENABLED');
    expect(toggledRoutineStatus('DISABLED')).toBe('ENABLED');
  });
});

describe('routineClient', () => {
  it('lists routines from the agent-service scheduled-command contract', async () => {
    const { request, calls } = requester([routine]);

    const routines = await routineClient.list(request);

    expect(routines[0]).toMatchObject({ id: 'r1', status: 'ENABLED' });
    expect(routines[0]).not.toHaveProperty('userId');
    expect(calls).toEqual([{ path: '/agent/scheduled-commands', options: undefined }]);
  });

  it('asks only for active paired devices', async () => {
    const { request, calls } = requester({
      data: [{ id: 'dev-1', name: 'Laptop', hostname: 'lap', status: 'ACTIVE', lastSeenAt: null }],
    });

    const devices = await routineClient.devices(request);

    expect(devices.map((device) => device.id)).toEqual(['dev-1']);
    expect(calls[0]).toMatchObject({ path: '/agent/devices?status=ACTIVE&pageSize=100' });
  });

  it('creates, pauses and deletes through the documented verbs', async () => {
    const { request, calls } = requester(routine);

    await routineClient.create(request, valid);
    await routineClient.setStatus(request, 'r/1', 'PAUSED');
    await routineClient.remove(request, 'r1');

    expect(calls).toEqual([
      {
        path: '/agent/scheduled-commands',
        options: { method: 'POST', body: valid },
      },
      {
        path: '/agent/scheduled-commands/r%2F1/status',
        options: { method: 'PATCH', body: { status: 'PAUSED' } },
      },
      { path: '/agent/scheduled-commands/r1', options: { method: 'DELETE' } },
    ]);
  });
});
