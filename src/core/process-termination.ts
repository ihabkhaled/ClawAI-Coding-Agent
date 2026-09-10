import { PROCESS_TERMINATION_GRACE_MS } from './process-termination.constants';

import type { TerminationStep } from './process-termination.types';

/**
 * How to stop a spawned process, per platform.
 *
 * Asking a process to stop and assuming it did is the difference between a
 * command that overran and a run that never ends. `SIGTERM` is a request, and a
 * test runner that traps it to print a summary, or one wedged in an
 * uninterruptible read, simply does not go away. The runner then waits on a
 * `close` event that will never fire, and the agent stops mid-task with no
 * error to report.
 *
 * The two platforms need genuinely different answers rather than one answer
 * with a branch:
 *
 * - POSIX has a real graceful signal, so it gets a grace period and then
 *   `SIGKILL`, which cannot be trapped.
 * - Windows has no graceful signal at all. `child.kill()` maps to
 *   `TerminateProcess`, which is already unconditional, so a grace period would
 *   be theatre. What Windows does need is the tree: `TerminateProcess` kills the
 *   one process it names, leaving `npm test`'s actual test runner orphaned and
 *   still holding the port or the lock. `taskkill /T` is the only way to take
 *   the children with it.
 */
export function terminationSteps(platform: NodeJS.Platform): readonly TerminationStep[] {
  if (platform === 'win32') return [{ kind: 'tree-kill', afterMs: 0, forceful: true }];
  return [
    { kind: 'signal', signal: 'SIGTERM', afterMs: 0, forceful: false },
    { kind: 'signal', signal: 'SIGKILL', afterMs: PROCESS_TERMINATION_GRACE_MS, forceful: true },
  ];
}

/**
 * The `taskkill` invocation that takes a process and its descendants.
 *
 * `/T` is the reason this exists — without it Windows kills the wrapper and
 * leaves the work running. `/F` is required alongside it, because the polite
 * form only posts a window message, which a console process never receives.
 */
export function treeKillArguments(pid: number): readonly string[] {
  return ['/pid', String(pid), '/T', '/F'];
}
