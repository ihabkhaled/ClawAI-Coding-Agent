import { cpSync, mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { env } from 'node:process';
import { fileURLToPath, pathToFileURL, URL } from 'node:url';

import { runTests } from '@vscode/test-electron';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const source = fileURLToPath(new URL('../tests/fixtures/workspace/', import.meta.url));
// A copy, not the committed fixture. The host suite drives real tools that
// write files and make commits, and running them against a tracked folder
// would dirty the repository on every run.
const fixture = mkdtempSync(join(tmpdir(), 'claw-host-ws-'));
cpSync(source, fixture, { recursive: true });

delete env.ELECTRON_RUN_AS_NODE;

await runTests({
  extensionDevelopmentPath: root,
  extensionTestsPath: join(root, 'tests', 'extension-host', 'index.cjs'),
  launchArgs: [
    '--disable-extensions',
    '--disable-workspace-trust',
    `--folder-uri=${pathToFileURL(fixture).toString()}`,
  ],
});
