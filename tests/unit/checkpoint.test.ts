import { describe, expect, it } from 'vitest';

import {
  MAX_CHECKPOINTS,
  checkpointBytes,
  checkpointLabelSchema,
  checkpointSchema,
  dedupeCheckpointFiles,
  retainCheckpoints,
} from '../../src/core/checkpoint';

import type { Checkpoint } from '../../src/core/checkpoint.types';

function checkpoint(id: string, createdAt = 1): Checkpoint {
  return { id, label: `label ${id}`, createdAt, files: [] };
}

describe('checkpointLabelSchema', () => {
  it('trims a label a person typed', () => {
    expect(checkpointLabelSchema.parse('  before refactor  ')).toBe('before refactor');
  });

  it('refuses a label that is only whitespace', () => {
    expect(checkpointLabelSchema.safeParse('   ').success).toBe(false);
  });
});

describe('checkpointSchema', () => {
  it('accepts a checkpoint', () => {
    expect(checkpointSchema.safeParse(checkpoint('c1')).success).toBe(true);
  });

  it('refuses fields it does not advertise', () => {
    expect(checkpointSchema.safeParse({ ...checkpoint('c1'), extra: 1 }).success).toBe(false);
  });
});

describe('dedupeCheckpointFiles', () => {
  it('keeps one entry per file, the newest', () => {
    const files = dedupeCheckpointFiles([
      { rootKey: 'workspace', path: 'a.ts', content: 'first' },
      { rootKey: 'workspace', path: 'a.ts', content: 'second' },
    ]);

    expect(files).toEqual([{ rootKey: 'workspace', path: 'a.ts', content: 'second' }]);
  });

  it('treats the same path under different roots as different files', () => {
    const files = dedupeCheckpointFiles([
      { rootKey: 'workspace', path: 'a.ts', content: 'one' },
      { rootKey: 'workspace-1', path: 'a.ts', content: 'two' },
    ]);

    expect(files).toHaveLength(2);
  });
});

describe('checkpointBytes', () => {
  it('adds up the contents', () => {
    expect(
      checkpointBytes([
        { rootKey: 'w', path: 'a', content: 'abc' },
        { rootKey: 'w', path: 'b', content: 'de' },
      ]),
    ).toBe(5);
  });

  it('is nothing for nothing', () => {
    expect(checkpointBytes([])).toBe(0);
  });
});

describe('retainCheckpoints', () => {
  it('puts the newest first', () => {
    const kept = retainCheckpoints([checkpoint('old')], checkpoint('new'));

    expect(kept.map(({ id }) => id)).toEqual(['new', 'old']);
  });

  it('drops the oldest rather than growing without bound', () => {
    let kept: Checkpoint[] = [];
    for (let index = 0; index < MAX_CHECKPOINTS + 3; index += 1) {
      kept = retainCheckpoints(kept, checkpoint(`c${String(index)}`));
    }

    expect(kept).toHaveLength(MAX_CHECKPOINTS);
    expect(kept[0]?.id).toBe(`c${String(MAX_CHECKPOINTS + 2)}`);
  });
});
