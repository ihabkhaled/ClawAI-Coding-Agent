import { argv, cwd, env, exit, stderr, stdin, stdout } from 'node:process';
import { createInterface } from 'node:readline/promises';

import { headlessExitCode } from '../core/headless-outcome';

import { runHeadlessCli } from './headless-cli';

/**
 * The process entry point: `clawai -p "<task>"`, or `node dist/headless.mjs`.
 *
 * Only the process lives here — argv, env, the streams, and Ctrl-C. SIGINT
 * aborts the run, which the SDK reports as cancelled (exit 130); a second one
 * exits at once. Everything else is `runHeadlessCli`, which is tested without
 * a process. The exit codes are the contract in `core/headless-outcome.ts`.
 */
const controller = new AbortController();
process.on('SIGINT', () => {
  if (controller.signal.aborted) exit(headlessExitCode('cancelled'));
  controller.abort();
});

async function confirmOnTerminal(question: string): Promise<boolean> {
  const lines = createInterface({ input: stdin, output: stderr });
  try {
    return /^y(?:es)?$/iu.test((await lines.question(question)).trim());
  } finally {
    lines.close();
  }
}

try {
  exit(
    await runHeadlessCli(
      argv.slice(2),
      env,
      {
        stdout: (text) => stdout.write(text),
        stderr: (text) => stderr.write(text),
        // Only a person at a terminal can approve; a pipe cannot, so it is denied.
        ...(stdin.isTTY ? { confirm: confirmOnTerminal } : {}),
      },
      { cwd: cwd(), signal: controller.signal },
    ),
  );
} catch (error) {
  // Anything thrown past the SDK is a failed attempt, not a usage error.
  stderr.write(`${error instanceof Error ? error.message : 'Headless run failed'}\n`);
  exit(headlessExitCode('failed'));
}
