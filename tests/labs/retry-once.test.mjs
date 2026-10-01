import assert from 'node:assert/strict';
import test from 'node:test';

import { retryOnce } from '../../scripts/retry-once.mjs';

test('returns the first result without retrying when the lane passes', async () => {
  const attempts = [];
  const result = await retryOnce((n) => {
    attempts.push(n);
    return Promise.resolve('ok');
  });
  assert.equal(result, 'ok');
  assert.deepEqual(attempts, [1]);
});

test('retries exactly once and returns the second result after a flake', async () => {
  const attempts = [];
  const logs = [];
  const result = await retryOnce(
    (n) => {
      attempts.push(n);
      return n === 1 ? Promise.reject(new Error('window unresponsive')) : Promise.resolve('ok');
    },
    { label: 'host', log: (line) => logs.push(line) },
  );
  assert.equal(result, 'ok');
  assert.deepEqual(attempts, [1, 2]);
  assert.match(logs[0] ?? '', /host failed once \(window unresponsive\); retrying once/u);
});

test('a genuine failure still fails: two attempts, then the second error surfaces', async () => {
  const attempts = [];
  await assert.rejects(
    retryOnce((n) => {
      attempts.push(n);
      return Promise.reject(new Error(`boom ${String(n)}`));
    }),
    /boom 2/u,
  );
  assert.deepEqual(attempts, [1, 2]);
});
