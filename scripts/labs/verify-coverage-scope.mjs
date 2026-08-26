import { execFile } from 'node:child_process';
import { readFile } from 'node:fs/promises';
import { dirname, join } from 'node:path';
import process from 'node:process';
import { fileURLToPath } from 'node:url';
import { promisify } from 'node:util';

const execFileAsync = promisify(execFile);

export const NAMED_CRITICAL_FILES = Object.freeze([
  'src/backend/backend-client.ts',
  'src/backend/backend-runtime-client.ts',
  'src/core/durable-run-journal.ts',
  'src/core/permission-policy.ts',
  'src/core/redaction.ts',
  'src/core/session-lock.ts',
  'src/core/session-vault.ts',
  'src/core/workspace-mutation-gate.ts',
  'src/core/workspace-path-policy.ts',
  'src/infrastructure/backend-runtime-transport.ts',
  'src/infrastructure/vscode-runtime-binding-store.ts',
  'src/services/runtime-event-stream-service.ts',
  'src/services/runtime-recovery-launcher.ts',
  'src/services/runtime-run-recovery.ts',
  'src/services/runtime-run-service.ts',
  'src/services/runtime-startup-recovery.ts',
  'src/services/safe-edit-service.ts',
  'src/services/vscode-runtime-recovery.ts',
  'src/webview/chat-inbound-message.ts',
]);

export function verifyCoverageScope({ sourceFiles, includedFiles, criticalFiles }) {
  const source = new Set(sourceFiles);
  const included = new Set(includedFiles);
  const required = new Set([
    ...criticalFiles,
    ...sourceFiles.filter((path) => path.startsWith('src/core/runtime/')),
  ]);
  const missing = [...required]
    .filter((path) => source.has(path) && !included.has(path))
    .sort((left, right) => left.localeCompare(right));
  return Object.freeze({ missing: Object.freeze(missing), checked: required.size });
}

function coverageIncludes(configSource) {
  return [...configSource.matchAll(/['"](src\/[A-Za-z0-9./-]+\.ts)['"]/gu)].map(
    (match) => match[1],
  );
}

async function runCli() {
  const root = dirname(dirname(dirname(fileURLToPath(import.meta.url))));
  const tracked = await execFileAsync('git', ['ls-files', 'src/**/*.ts'], {
    cwd: root,
    windowsHide: true,
  });
  const sourceFiles = tracked.stdout.split(/\r?\n/u).filter(Boolean);
  const configSource = await readFile(join(root, 'vitest.config.ts'), 'utf8');
  const result = verifyCoverageScope({
    sourceFiles,
    includedFiles: coverageIncludes(configSource),
    criticalFiles: NAMED_CRITICAL_FILES,
  });
  process.stdout.write(`${JSON.stringify(result, null, 2)}\n`);
  if (result.missing.length > 0) process.exitCode = 1;
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  await runCli();
}
