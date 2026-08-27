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
    dirtyPaths: [],
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

test('names every uncommitted path so the failure is readable', async () => {
  // The gate that blocked release used to say only "requires a clean source
  // tree", with no indication of which file it meant.
  const outputs = ['c'.repeat(40), ' M src/extension.ts\n?? scripts/new-thing.mjs\n'];
  const identity = await readReleaseIdentity({
    root: 'D:/fixture',
    commandRunner: async () => outputs.shift(),
  });

  assert.deepEqual(identity.dirtyPaths, ['M src/extension.ts', '?? scripts/new-thing.mjs']);
});

test('excludes the builds/ release output from the source-dirtiness check', async () => {
  // `builds/<version>.vsix` is TRACKED because release.yml requires it to be
  // committed, and `npm run package` rewrites it moments before this runs. A
  // rebuilt VSIX is never byte-identical to the committed one — release.yml
  // compares extracted content for exactly that reason — so without this
  // exclusion every push to main reports a dirty tree and no release can build.
  const calls = [];
  const outputs = ['d'.repeat(40), ''];
  await readReleaseIdentity({
    root: 'D:/fixture',
    commandRunner: async (command, args) => {
      calls.push({ command, args });
      return outputs.shift();
    },
  });

  const statusCall = calls.find((call) => call.args.includes('status'));
  assert.ok(statusCall, 'release identity must ask git for the working-tree status');
  assert.deepEqual(statusCall.args, ['status', '--porcelain', '--', '.', ':(exclude)builds']);
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
