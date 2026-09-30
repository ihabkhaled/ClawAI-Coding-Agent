import type { RunnerWorkspaceFit, RunnerWorkspaceFitInput } from './runner-workspace-fit.types';

function lastSegment(path: string): string {
  const parts = path.split(/[\\/]+/u).filter((part) => part.length > 0);
  return parts[parts.length - 1] ?? '';
}

/**
 * F095: reconciles a runner session with this window on resume. Continuing a
 * runner's work in a chat here only makes sense when the runner's checkout is a
 * folder this window has open; otherwise the thread would edit nothing it can
 * see. Unknown (no runner data or no open folder) never warns: silence on
 * missing evidence beats a false alarm.
 */
export function runnerWorkspaceFit(input: RunnerWorkspaceFitInput): RunnerWorkspaceFit {
  if (input.runnerRepos.length === 0 || input.workspaceNames.length === 0) return 'unknown';
  const open = new Set(input.workspaceNames.map((name) => name.toLowerCase()));
  const matches = input.runnerRepos.some(
    (repo) =>
      open.has(repo.name.toLowerCase()) || open.has(lastSegment(repo.repoPath).toLowerCase()),
  );
  return matches ? 'match' : 'mismatch';
}
