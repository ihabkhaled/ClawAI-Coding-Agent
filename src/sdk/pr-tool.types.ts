import type { GitRunResult } from './git-tools.types';

/** Runs `gh` with fixed arguments in a directory; never rejects (see `runGitProcess`). */
export type GhRunner = (
  args: readonly string[],
  cwd: string,
  signal?: AbortSignal,
) => Promise<GitRunResult>;

/** What a pull request call is given besides its arguments. */
export interface PrToolContext {
  readonly workspace: string;
  readonly signal?: AbortSignal | undefined;
}

/** The tool's one entry point. */
export interface PrTool {
  readonly execute: (
    operation: string,
    args: Readonly<Record<string, unknown>>,
    context: PrToolContext,
  ) => Promise<Record<string, unknown>>;
}
