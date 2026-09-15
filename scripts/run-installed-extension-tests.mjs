import { existsSync, readFileSync } from 'node:fs';
import { EOL } from 'node:os';
import { dirname, join } from 'node:path';
import { argv, env, exit, stderr, stdout } from 'node:process';
import { fileURLToPath, pathToFileURL, URL } from 'node:url';

import { runTests } from '@vscode/test-electron';

/**
 * Runs the extension-host assertions against an installed VSIX.
 *
 * `run-extension-tests.mjs` points VS Code at the working tree, which proves
 * the source activates and says nothing about the artifact a user installs. The
 * two differ in exactly the ways that bite: what `.vscodeignore` dropped,
 * whether `dist/` was rebuilt, and whether the packaged `package.json` still
 * contributes every command. Pointing `extensionDevelopmentPath` at the copy
 * inside a disposable extensions directory runs the same assertions against
 * what was actually shipped.
 *
 * Usage: node scripts/run-installed-extension-tests.mjs <extensions-dir>
 */
const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const fixture = fileURLToPath(new URL('../tests/fixtures/workspace/', import.meta.url));
const extensionsDirectory = argv[2];

if (extensionsDirectory === undefined) {
  stderr.write(`Pass the extensions directory holding the installed VSIX.${EOL}`);
  exit(1);
}

const { version } = JSON.parse(readFileSync(join(root, 'package.json'), 'utf8'));
const installed = join(extensionsDirectory, `clawai.clawai-coding-agent-${version}`);

if (!existsSync(installed)) {
  stderr.write(`No installed clawai-coding-agent ${version} in ${extensionsDirectory}.${EOL}`);
  stderr.write(`Install the packaged VSIX into that directory first.${EOL}`);
  exit(1);
}

// The dev-tree runner disables every other extension. Here the installed copy
// IS an extension in that directory, so it must stay enabled.
delete env.ELECTRON_RUN_AS_NODE;

await runTests({
  extensionDevelopmentPath: installed,
  extensionTestsPath: join(root, 'tests', 'extension-host', 'index.cjs'),
  launchArgs: ['--disable-workspace-trust', `--folder-uri=${pathToFileURL(fixture).toString()}`],
});

stdout.write(`Installed-artifact host tests passed for ${installed}${EOL}`);
