import spawn from 'cross-spawn';

import { terminationSteps, treeKillArguments } from '../core/process-termination';

import type { ProcessTerminationHandle } from './process-terminator.types';
import type { ChildProcess } from 'node:child_process';

/**
 * Runs a platform's termination sequence against a live child process.
 *
 * Every step is scheduled up front from the moment termination starts, rather
 * than each one arming the next when it fails. A process that exits normally
 * clears the remaining timers through `settle`, and a process that does not
 * gets the next step on time even if the previous one produced no event at all
 * — which is exactly the case that hangs: no exit, no error, nothing to react
 * to.
 *
 * `forced` is what the receipt reports. It answers "did this process have to be
 * killed", which is worth knowing because a command that ignores termination
 * usually leaves something behind — a lock, a port, a half-written file — that
 * the next command will trip over.
 */
export function terminateProcess(child: ChildProcess): ProcessTerminationHandle {
  const timers: NodeJS.Timeout[] = [];
  let forced = false;
  for (const step of terminationSteps(process.platform)) {
    const run = (): void => {
      if (child.exitCode !== null || child.signalCode !== null) return;
      if (step.forceful) forced = true;
      if (step.kind === 'tree-kill') killTree(child);
      else child.kill(step.signal);
    };
    if (step.afterMs === 0) run();
    else timers.push(setTimeout(run, step.afterMs));
  }
  return {
    settle: (): void => {
      for (const timer of timers.splice(0)) clearTimeout(timer);
    },
    wasForced: (): boolean => forced,
  };
}

/**
 * Kills the process and its descendants on Windows.
 *
 * A failure here is deliberately swallowed. `taskkill` exits non-zero when the
 * process is already gone, which is the common case in a race against a process
 * that was exiting anyway, and turning that into an error would replace a
 * successful command with a spurious failure. If it genuinely could not kill
 * the tree, the caller finds out the way it would have anyway: the command does
 * not finish and its own timeout still applies.
 */
function killTree(child: ChildProcess): void {
  if (child.pid === undefined) return;
  try {
    const killer = spawn('taskkill', [...treeKillArguments(child.pid)], { windowsHide: true });
    killer.on('error', () => undefined);
  } catch {
    child.kill();
  }
}
