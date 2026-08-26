import assert from 'node:assert/strict';
import test from 'node:test';

import { readReleaseIdentity } from '../../scripts/labs/release-identity.mjs';

test('reads a clean source identity on a branch or detached HEAD', async () => {
  const outputs = ['a'.repeat(40), ''];
  const identity = await readReleaseIdentity({
    root: 'D:/fixture',
    commandRunner: async () => outputs.shift(),
  });

  assert.deepEqual(identity, {
    repositoryUri: 'git+https://github.com/ihabkhaled/ClawAI-Coding-Agent.git',
    commitSha: 'a'.repeat(40),
    dirty: false,
  });
});

test('records a dirty source tree', async () => {
  const outputs = ['b'.repeat(40), ' M src/extension.ts'];
  const identity = await readReleaseIdentity({
    root: 'D:/fixture',
    commandRunner: async () => outputs.shift(),
  });

  assert.equal(identity.dirty, true);
});

test('rejects malformed commit identity', async () => {
  await assert.rejects(
    readReleaseIdentity({ root: 'D:/fixture', commandRunner: async () => 'main' }),
    /40-character lowercase Git SHA/u,
  );
});

test('preserves a missing Git command failure', async () => {
  const expected = new Error('spawn git ENOENT');
  await assert.rejects(
    readReleaseIdentity({
      root: 'D:/fixture',
      commandRunner: async () => {
        throw expected;
      },
    }),
    expected,
  );
});
