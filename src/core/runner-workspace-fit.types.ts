/** Whether a runner's reported repositories include the folder open here. */
export type RunnerWorkspaceFit = 'match' | 'mismatch' | 'unknown';

export interface RunnerWorkspaceFitInput {
  /** Repository names and paths a runner reported through `agent/repos`. */
  readonly runnerRepos: readonly { readonly name: string; readonly repoPath: string }[];
  /** Names of the folders open in this window. */
  readonly workspaceNames: readonly string[];
}
