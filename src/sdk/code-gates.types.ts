/** The five checks an engineer runs before calling code done. */
export type GateName = 'lint' | 'typecheck' | 'test' | 'build' | 'format';

/** Tools that accept a file list, so a gate can be narrowed to the files that changed. */
export type GateFileMode = 'eslint' | 'prettier' | 'vitest' | 'jest';

export type GateEcosystem = 'node' | 'python' | 'rust' | 'go';

/** One program invocation, without a shell. */
export interface GateCommand {
  readonly executable: string;
  readonly args: readonly string[];
  /** True when the tool exits 0 but prints offending files (`gofmt -l`): any output is a failure. */
  readonly failOnOutput?: boolean | undefined;
  /** Set when the same tool can take files: the arguments before the file list. */
  readonly fileMode?: GateFileMode | undefined;
  /** Human-readable form, e.g. `npm run lint`. */
  readonly display: string;
}

/** What detection learned about one project folder. */
export interface GateProject {
  /** Folder relative to the workspace, `/` separated; `.` for the root. */
  readonly dir: string;
  readonly ecosystem: GateEcosystem;
  readonly packageManager?: string | undefined;
  readonly tools: readonly string[];
  readonly gates: Readonly<Partial<Record<GateName, GateCommand>>>;
  /** The same gates by direct tool, taking a file list after `args`; for narrowing and re-runs. */
  readonly fileGates: Readonly<Partial<Record<GateName, GateCommand>>>;
}

/** The monorepo workspace folders declared by the root manifest. */
export interface GateWorkspaces {
  readonly kind: string;
  readonly dirs: readonly string[];
}

/** One failing test, kept short. */
export interface FailedTest {
  readonly name: string;
  readonly file: string;
  readonly message: string;
}

/** What a parser reads out of a command's output. */
export interface GateSummary {
  readonly errors: number;
  readonly warnings: number;
  readonly failedTests: readonly FailedTest[];
  /** The first problems as `file:line:col message`; at most a handful. */
  readonly issues: readonly string[];
}

/** The structured result of one gate run. */
export interface GateResult {
  readonly gate: GateName;
  readonly dir: string;
  readonly command: string;
  readonly status: 'pass' | 'fail' | 'unavailable' | 'timeout';
  readonly ok: boolean;
  readonly exitCode: number;
  readonly durationMs: number;
  readonly summary: GateSummary;
  readonly tail: string;
  readonly reason?: string | undefined;
  readonly flaky?: boolean | undefined;
  readonly note?: string | undefined;
}
