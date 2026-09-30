/** What a caller asks for: globs, workspace-relative, forward-slash. */
export interface WriteScopeConfig {
  /** Every mutation must match one of these. Unset or empty means "anywhere", unless `deny` is set. */
  readonly scope?: readonly string[] | undefined;
  /** No mutation may match one of these. Wins over `scope`. */
  readonly deny?: readonly string[] | undefined;
}

/** A write the scope stopped, or undid. */
export interface WriteScopeViolation {
  /** The tool that was refused, or that made the change: `workspace.file`, `workspace.git`, `workspace.command`. */
  readonly tool: string;
  /** Workspace-relative, forward-slash. */
  readonly paths: readonly string[];
}

/** Reads the violation as it happens; the SDK turns it into a `write-scope.violation` event. */
export type WriteScopeListener = (violation: WriteScopeViolation) => void;

export interface WriteScopeOptions {
  /** Decides case sensitivity; defaults to this machine's platform. */
  readonly platform?: NodeJS.Platform | undefined;
  readonly onViolation?: WriteScopeListener | undefined;
}

/** A compiled scope. Build it with `createWriteScope`. */
export interface WriteScope {
  /** The globs the operator named, normalized, for messages. */
  readonly scopeGlobs: readonly string[];
  readonly denyGlobs: readonly string[];
  readonly allow: readonly RegExp[];
  readonly deny: readonly RegExp[];
  readonly onViolation?: WriteScopeListener | undefined;
}

/** What `git status --porcelain` says about one path, reduced to what reverting needs. */
export interface DirtyEntry {
  /** Workspace-relative, forward-slash; `../x` when the path is outside the workspace. */
  readonly path: string;
  /** `untracked` is deleted, `added` leaves the index and is deleted, `tracked` is restored from HEAD. */
  readonly kind: 'untracked' | 'added' | 'tracked';
}

/** What reverting did. */
export interface RevertReport {
  readonly reverted: readonly string[];
  readonly failed: readonly string[];
  /** Paths past the revert bound, left as they are. */
  readonly skipped: number;
}
