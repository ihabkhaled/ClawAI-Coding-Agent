import assert from 'node:assert/strict';
import { Buffer } from 'node:buffer';
import { mkdtemp, readFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import test from 'node:test';

import { bootstrapLab } from '../../scripts/labs/bootstrap-lab.mjs';

test('creates an idempotent sanitized lab baseline', async () => {
  const root = await mkdtemp(join(tmpdir(), 'clawai-bootstrap-'));
  const rawRoot = join(root, '.clawai-lab');
  const commands = new Map([
    ['git rev-parse HEAD', 'a'.repeat(40)],
    ['git rev-parse --show-superproject-working-tree', 'D:/parent'],
    ['git -C D:/parent rev-parse HEAD', 'b'.repeat(40)],
    ['code --version', '1.134.0\ncommit\nx64'],
    ['code --list-extensions --show-versions', 'clawai.clawai-coding-agent@0.64.2'],
  ]);
  const commandRunner = async (command, args) => {
    const key = [command, ...args].join(' ');
    if (!commands.has(key)) throw new Error(`Unexpected command: ${key}`);
    return commands.get(key);
  };
  const options = {
    root,
    rawRoot,
    commandRunner,
    vscodeCommand: 'code',
    packageVersion: '0.64.2',
    vsixBytes: Buffer.from('fixture-vsix'),
  };

  const first = await bootstrapLab(options);
  const second = await bootstrapLab(options);

  assert.deepEqual(second, first);
  for (const directory of ['runs', 'profiles', 'workspaces', 'artifacts']) {
    const stat = await import('node:fs/promises').then(({ stat }) =>
      stat(join(rawRoot, directory)),
    );
    assert.equal(stat.isDirectory(), true);
  }
  const serialized = await readFile(join(rawRoot, 'baseline.json'), 'utf8');
  assert.doesNotMatch(serialized, /D:\/|C:\\Users|SECRET|TOKEN/iu);
  assert.match(serialized, /"vscodeVersion": "1\.134\.0"/u);
});
