import { spawnSync } from 'node:child_process';

import { treeKillArguments } from '../core/process-termination';

import type { ChildProcess } from 'node:child_process';

/**
 * Kills a process and everything it started, now, and does not return until
 * the signal is sent.
 *
 * The graceful path (`killCommandTree`) schedules its forced step on a timer,
 * which a host that is about to exit never runs. Anything that must be gone
 * when this call returns, the end of a run or the host exiting, comes here:
 * the process group gets SIGKILL on POSIX, and `taskkill /T /F` takes the tree
 * on Windows.
 */
export function killTreeNow(child: ChildProcess, platform: NodeJS.Platform): void {
  const pid = child.pid;
  if (pid === undefined) return;
  if (platform === 'win32') {
    try {
      spawnSync('taskkill', [...treeKillArguments(pid)], { windowsHide: true, timeout: 5_000 });
    } catch {
      child.kill();
    }
    return;
  }
  signalGroupNow(pid);
  try {
    child.kill('SIGKILL');
  } catch {
    // Already gone.
  }
}

/** SIGKILL to a process group whose leader has just exited, so stragglers die with it. */
export function reapGroup(pid: number | undefined, platform: NodeJS.Platform): void {
  if (pid === undefined || platform === 'win32') return;
  signalGroupNow(pid);
}

function signalGroupNow(pid: number): void {
  try {
    process.kill(-pid, 'SIGKILL');
  } catch {
    // The group is already gone, which is the outcome being asked for.
  }
}
