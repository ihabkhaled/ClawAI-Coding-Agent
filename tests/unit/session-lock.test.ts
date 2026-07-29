import { randomUUID } from 'node:crypto';

import { describe, expect, it } from 'vitest';

import { FileSessionLock } from '../../src/core/session-lock';

describe('FileSessionLock', () => {
  it('serializes a burst of contenders without deleting a newly acquired lock', async () => {
    const scope = `session-lock-test-${randomUUID()}`;
    let active = 0;
    let maximumActive = 0;
    let completed = 0;

    await Promise.all(
      Array.from({ length: 40 }, async () => {
        const lock = new FileSessionLock();
        await lock.run(scope, undefined, async () => {
          active += 1;
          maximumActive = Math.max(maximumActive, active);
          await new Promise((resolve) => {
            setTimeout(resolve, 1);
          });
          completed += 1;
          active -= 1;
        });
      }),
    );

    expect(completed).toBe(40);
    expect(maximumActive).toBe(1);
  });
});
