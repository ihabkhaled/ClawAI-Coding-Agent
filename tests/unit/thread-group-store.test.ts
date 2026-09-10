import { describe, expect, it, vi } from 'vitest';

import { THREAD_GROUPS_KEY, ThreadGroupStore } from '../../src/services/thread-group-store';

function store(initial: unknown) {
  const values = new Map<string, unknown>([[THREAD_GROUPS_KEY, initial]]);
  const update = vi.fn(async (key: string, value: unknown) => {
    values.set(key, value);
  });
  return { store: new ThreadGroupStore({ get: (key) => values.get(key), update }), update };
}

describe('ThreadGroupStore', () => {
  it('reads nothing from an empty workspace', () => {
    expect(store(undefined).store.read()).toEqual({});
  });

  it('reads stored assignments back', () => {
    expect(store({ 'thread-1': 'Billing' }).store.read()).toEqual({ 'thread-1': 'Billing' });
  });

  it('treats an unparseable value as empty rather than repairing it', () => {
    expect(store({ 'thread-1': 42 }).store.read()).toEqual({});
    expect(store('not an object').store.read()).toEqual({});
  });

  it('writes assignments to the workspace', async () => {
    const subject = store(undefined);

    await subject.store.write({ 'thread-1': 'Billing' });

    expect(subject.update).toHaveBeenCalledWith(THREAD_GROUPS_KEY, { 'thread-1': 'Billing' });
  });

  it('round-trips what it wrote', async () => {
    const subject = store(undefined);

    await subject.store.write({ 'thread-1': 'Support' });

    expect(subject.store.read()).toEqual({ 'thread-1': 'Support' });
  });
});
