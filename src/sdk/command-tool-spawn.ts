import spawn from 'cross-spawn';

import { executableCandidates } from '../core/executable-candidates';
import { inheritedEnvironment } from '../core/inherited-environment';
import { PROCESS_TERMINATION_GRACE_MS } from '../core/process-termination.constants';
import { prepareGitSpawn } from '../infrastructure/hardened-git';
import { terminateProcess } from '../infrastructure/process-terminator';

import {
  COMMAND_EXTRA_ENVIRONMENT_KEYS,
  COMMAND_FIXED_ENVIRONMENT,
  COMMAND_GROUP_KILL_MARGIN_MS,
} from './command-tool.constants';

import type { CommandRequest, CommandRuntime } from './command-tool.types';
import type { ChildProcess } from 'node:child_process';

/**
 * The environment a command sees: the shared allowlist, the extra locations
 * npm, git and node need on each platform, and the fixed non-interactive
 * settings. Anything else in the parent, secrets included, is left behind.
 *
 * Windows names are case-insensitive, so `Path` and `PATH` collapse to the
 * first one seen rather than reaching the child as two competing values.
 */
export function commandEnvironment(
  source: Readonly<Record<string, string | undefined>>,
  platform: NodeJS.Platform,
): Record<string, string> {
  const extra: Record<string, string> = {};
  for (const key of COMMAND_EXTRA_ENVIRONMENT_KEYS) {
    const value = source[key];
    if (value !== undefined) extra[key] = value;
  }
  const merged = { ...inheritedEnvironment(source), ...extra };
  const environment = platform === 'win32' ? withoutCaseDuplicates(merged) : merged;
  return { ...environment, ...COMMAND_FIXED_ENVIRONMENT };
}

function withoutCaseDuplicates(values: Record<string, string>): Record<string, string> {
  const seen = new Set<string>();
  const result: Record<string, string> = {};
  for (const [key, value] of Object.entries(values)) {
    if (seen.has(key.toLowerCase())) continue;
    seen.add(key.toLowerCase());
    result[key] = value;
  }
  return result;
}

/**
 * The file an executable name means on this machine, or undefined.
 *
 * Windows resolves `npm` to `npm.cmd` and `git` to `git.exe` through PATHEXT,
 * and an empty PATH entry is skipped so a hostile repository cannot supply its
 * own `git` by being the working directory.
 */
export function resolveCommandExecutable(
  executable: string,
  runtime: CommandRuntime,
  environment: Readonly<Record<string, string | undefined>>,
): string | undefined {
  return executableCandidates(executable, environment, runtime.platform).find((candidate) =>
    runtime.exists(candidate),
  );
}

/** Arguments a `.cmd` shim would hand to the Windows command interpreter as syntax. */
export function isUnsafeShimArgument(argument: string): boolean {
  return /[\0\r\n%]/u.test(argument);
}

/**
 * Starts the process with no shell and stdin closed.
 *
 * cross-spawn is what lets `npm.cmd` run without `shell: true`: it quotes each
 * argument for the interpreter instead of concatenating a command line. On
 * POSIX the child leads its own process group so the whole tree can be signalled.
 */
export function startCommand(
  executable: string,
  argumentList: readonly string[],
  options: { cwd: string; environment: Record<string, string>; platform: NodeJS.Platform },
): ChildProcess {
  const prepared = prepareGitSpawn(executable, argumentList, options.cwd, options.environment);
  return spawn(executable, prepared.arguments, {
    cwd: options.cwd,
    env: prepared.environment,
    shell: false,
    stdio: ['ignore', 'pipe', 'pipe'],
    windowsHide: true,
    detached: options.platform !== 'win32',
  });
}

/**
 * Stops the process and everything it started.
 *
 * The shared terminator is `taskkill /T /F` on Windows and SIGTERM then SIGKILL
 * on the process alone elsewhere. A test runner's workers are grandchildren, so
 * on POSIX the group gets the same two signals; without that a timed-out
 * `npm test` leaves its workers holding the port.
 */
export function killCommandTree(child: ChildProcess, platform: NodeJS.Platform): void {
  const handle = terminateProcess(child);
  child.once('exit', () => {
    handle.settle();
  });
  if (platform === 'win32' || child.pid === undefined) return;
  const pid = child.pid;
  signalGroup(pid, 'SIGTERM');
  setTimeout(() => {
    signalGroup(pid, 'SIGKILL');
  }, PROCESS_TERMINATION_GRACE_MS + COMMAND_GROUP_KILL_MARGIN_MS).unref();
}

function signalGroup(pid: number, signal: NodeJS.Signals): void {
  try {
    process.kill(-pid, signal);
  } catch {
    // The group is already gone, which is the outcome being asked for.
  }
}

/**
 * Resolves and starts one request. A missing executable and an argument a
 * Windows shim would read as syntax are refused here, with a message that
 * names the problem, rather than surfacing as a bare spawn error.
 */
export function launchCommand(request: CommandRequest, runtime: CommandRuntime): ChildProcess {
  const environment = commandEnvironment(runtime.environment, runtime.platform);
  const resolved = resolveCommandExecutable(request.executable, runtime, environment);
  if (resolved === undefined) {
    throw new Error(`Executable ${request.executable} was not found on PATH.`);
  }
  const shim = runtime.platform === 'win32' && /\.(?:cmd|bat)$/iu.test(resolved);
  if (shim && request.arguments.some(isUnsafeShimArgument)) {
    throw new Error(
      `${request.executable} is a Windows script shim; arguments may not contain %, newlines or NUL.`,
    );
  }
  return startCommand(resolved, request.arguments, {
    cwd: request.cwd,
    environment,
    platform: runtime.platform,
  });
}
