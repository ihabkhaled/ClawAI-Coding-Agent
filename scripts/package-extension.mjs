import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { existsSync, mkdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { cwd, execPath, stdout } from 'node:process';

const root = cwd();
const manifest = JSON.parse(readFileSync(join(root, 'package.json'), 'utf8'));
const builds = join(root, 'builds');
const artifact = join(builds, `clawai-coding-agent-${manifest.version}.vsix`);
const executable = join(root, 'node_modules', '@vscode', 'vsce', 'vsce');

mkdirSync(builds, { recursive: true });
const result = spawnSync(
  execPath,
  [executable, 'package', '--no-dependencies', '--out', artifact],
  {
    cwd: root,
    stdio: 'inherit',
  },
);
assert.equal(result.status, 0, 'VSIX packaging failed');
assert.equal(existsSync(artifact), true, `Missing packaged extension: ${artifact}`);
stdout.write(`Created ${artifact}\n`);
