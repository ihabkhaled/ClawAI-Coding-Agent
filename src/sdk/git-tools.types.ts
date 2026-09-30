/** A stream kept as its first and last characters, with a count of what was dropped between. */
export interface BoundedText {
  head: string;
  tail: string;
  dropped: number;
}

/** How to run one git process. */
export interface GitRunOptions {
  readonly cwd: string;
  readonly environment: Readonly<Record<string, string>>;
  readonly timeoutMs: number;
  readonly signal?: AbortSignal | undefined;
}

/** What one git process did. */
export interface GitRunResult {
  readonly exitCode: number;
  readonly stdout: string;
  readonly stderr: string;
  readonly timedOut: boolean;
  readonly aborted: boolean;
}

/** The workspace and the run's abort signal, handed to every operation. */
export interface GitToolContext {
  readonly workspace: string;
  readonly signal?: AbortSignal | undefined;
  readonly args: Readonly<Record<string, unknown>>;
}

/** One remote as `git remote -v` reports it, credentials removed. */
export interface GitRemoteEntry {
  readonly name: string;
  readonly fetchUrl?: string;
  readonly pushUrl?: string;
}

/** A commit message split into the parts the model may set. */
export interface GitCommitMessage {
  readonly header: string;
  readonly body: string;
  readonly trailers: readonly string[];
}

/** What `runGit` needs beyond the arguments. */
export interface GitInvocation {
  /** A write the caller granted: repository hooks run. Reads use the hardened, hook-free form. */
  readonly write: boolean;
  readonly timeoutMs: number;
  /** Talks to a remote: use the `gh` credential helper when the GitHub CLI is installed. */
  readonly credentials?: boolean;
  /** Extra `-c key=value` pairs, placed before the subcommand. */
  readonly config?: readonly string[];
}
