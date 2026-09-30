import { describe, expect, it } from 'vitest';

import { remoteJobClient } from '../../src/backend/remote-job-client';

import type { IntegrationRequester } from '../../src/backend/integration-contracts';

const job = {
  id: 'j1',
  deviceId: 'd1',
  name: 'Nightly',
  command: 'make',
  intervalMinutes: 60,
  status: 'ACTIVE',
  nextRunAt: '2026-01-01T00:00:00Z',
};

/** A requester that answers by path and really validates with the caller's schema. */
function requester(answers: Record<string, unknown>) {
  const calls: { path: string; method: string | undefined; body: unknown }[] = [];
  const request: IntegrationRequester = async (path, schema, options) => {
    calls.push({ path, method: options?.method, body: options?.body });
    if (!(path in answers)) throw new Error(`unexpected ${path}`);
    return schema.parse(answers[path]);
  };
  return { request, calls };
}

describe('remoteJobClient', () => {
  it('lists jobs and active devices together', async () => {
    const { request, calls } = requester({
      '/agent/scheduled-commands': [job],
      '/agent/devices?status=ACTIVE&page=1&pageSize=50': {
        data: [{ id: 'd1', name: 'Laptop', status: 'ACTIVE' }],
      },
    });
    const listed = await remoteJobClient(request).list();
    expect(listed.jobs.map((entry) => entry.id)).toEqual(['j1']);
    expect(listed.devices.map((device) => device.name)).toEqual(['Laptop']);
    expect(calls).toHaveLength(2);
  });

  it('fails the whole listing when either half fails, and rejects a malformed job', async () => {
    const half = requester({ '/agent/scheduled-commands': [job] });
    await expect(remoteJobClient(half.request).list()).rejects.toThrow('unexpected');
    const bad = requester({
      '/agent/scheduled-commands': [{ ...job, id: '' }],
      '/agent/devices?status=ACTIVE&page=1&pageSize=50': { data: [] },
    });
    await expect(remoteJobClient(bad.request).list()).rejects.toThrow();
  });

  it('creates a job, sending workingDir only when given', async () => {
    const { request, calls } = requester({ '/agent/scheduled-commands': job });
    const client = remoteJobClient(request);
    const base = { deviceId: 'd1', name: 'Nightly', command: 'make', intervalMinutes: 60 };
    await client.create(base);
    await client.create({ ...base, workingDir: '/srv' });
    expect(calls[0]).toEqual({ path: '/agent/scheduled-commands', method: 'POST', body: base });
    expect(calls[1]?.body).toEqual({ ...base, workingDir: '/srv' });
  });

  it('triggers with the idempotency key and an encoded id', async () => {
    const path = `/agent/scheduled-commands/${encodeURIComponent('a/b c')}/trigger`;
    const { request, calls } = requester({
      [path]: { command: { id: 'c1', status: 'QUEUED', command: 'make' }, replayed: true },
    });
    const fired = await remoteJobClient(request).trigger('a/b c', 'key-1');
    expect(fired.replayed).toBe(true);
    expect(calls[0]).toEqual({ path, method: 'POST', body: { idempotencyKey: 'key-1' } });
  });

  it('reads a command status and refuses a reply without an id', async () => {
    const path = '/agent/commands/c1';
    const ok = requester({ [path]: { id: 'c1', status: 'DONE', command: 'make', exitCode: 0 } });
    expect((await remoteJobClient(ok.request).status('c1')).exitCode).toBe(0);
    const bad = requester({ [path]: { status: 'DONE', command: 'make' } });
    await expect(remoteJobClient(bad.request).status('c1')).rejects.toThrow();
  });
});
