import { describe, expect, it, vi } from 'vitest';

import { MAX_CHECKPOINTS } from '../../src/core/checkpoint';
import { CHECKPOINTS_KEY, CheckpointStore } from '../../src/services/checkpoint-store';

import type { Checkpoint } from '../../src/core/checkpoint.types';

function checkpoint(id: string): Checkpoint {
  return { id, label: id, createdAt: 1, files: [{ rootKey: 'w', path: 'a.ts', content: 'x' }] };
}

function store(initial?: unknown) {
  const values = new Map<string, unknown>([[CHECKPOINTS_KEY, initial]]);
  const update = vi.fn(async (key: string, value: unknown) => {
    values.set(key, value);
  });
  return { store: new CheckpointStore({ get: (key) => values.get(key), update }), update };
}

describe('CheckpointStore', () => {
  it('reads nothing from an empty workspace', () => {
    expect(store().store.read()).toEqual([]);
  });

  it('round-trips a checkpoint', async () => {
    const subject = store();

    await subject.store.add(checkpoint('c1'));

    expect(subject.store.read()).toEqual([checkpoint('c1')]);
  });

  it('drops an entry that no longer parses rather than restoring from it', () => {
    expect(
      store([checkpoint('good'), { id: 'bad' }])
        .store.read()
        .map(({ id }) => id),
    ).toEqual(['good']);
  });

  it('treats a stored value that is not a list as empty', () => {
    expect(store('nonsense').store.read()).toEqual([]);
  });

  it('keeps only the most recent checkpoints', async () => {
    const subject = store();

    for (let index = 0; index < MAX_CHECKPOINTS + 2; index += 1) {
      await subject.store.add(checkpoint(`c${String(index)}`));
    }

    expect(subject.store.read()).toHaveLength(MAX_CHECKPOINTS);
  });

  it('clears everything when asked', async () => {
    const subject = store();

    await subject.store.add(checkpoint('c1'));
    await subject.store.clear();

    expect(subject.store.read()).toEqual([]);
  });
});
