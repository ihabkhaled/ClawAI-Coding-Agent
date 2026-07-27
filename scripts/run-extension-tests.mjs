import { dirname, join } from 'node:path';
import { env } from 'node:process';
import { fileURLToPath, pathToFileURL, URL } from 'node:url';

import { runTests } from '@vscode/test-electron';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const fixture = fileURLToPath(new URL('../tests/fixtures/workspace/', import.meta.url));

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
