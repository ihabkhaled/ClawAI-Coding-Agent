/** The shells `workspace.shell` can run a script in. */
export type ShellKind = 'bash' | 'sh' | 'powershell' | 'cmd';

/**
 * What the operator switched on with `--allow-shell` (the second of the two
 * switches; `shell` in `--allow-tools` is the first). Its presence is the grant.
 */
export interface ShellOptions {
  /** Extra refusal rules, as regular expression sources (`--shell-deny`). */
  readonly deny?: readonly string[] | undefined;
  /** Where `shell.log` is written; absent means no log is kept. */
  readonly logDirectory?: string | undefined;
}

/** A shell found on this machine. */
export interface ResolvedShell {
  readonly kind: ShellKind;
  readonly file: string;
  /** Arguments that make the shell run `script` and exit, with no profile and no prompt. */
  readonly argumentsFor: (script: string) => readonly string[];
  /** cmd.exe parses its own command line; the arguments must not be re-quoted. */
  readonly verbatim: boolean;
}

/** The arguments of `workspace.shell.run`, after validation and clamping. */
export interface ShellRequest {
  readonly script: string;
  readonly shell: ShellKind | undefined;
  readonly cwd: string;
  readonly timeoutMs: number;
}

/** What a finished script reports. */
export interface ShellResult {
  readonly shell: ShellKind;
  readonly exitCode: number;
  readonly signal: string | null;
  readonly timedOut: boolean;
  readonly aborted: boolean;
  readonly durationMs: number;
  readonly stdout: string;
  readonly stderr: string;
  readonly truncated: boolean;
  readonly error?: string;
}

/** A rule that is one pattern over the plain view. */
export interface ShellPatternRule {
  readonly id: string;
  readonly reason: string;
  readonly pattern: RegExp;
}

/** One screening rule that needs more than a pattern: a stable id, the reason, and the test. */
export interface ShellScreenRule {
  readonly id: string;
  readonly reason: string;
  readonly test: (view: ScreenView, context: ScreenContext) => boolean;
}

/** The script as the rules read it. */
export interface ScreenView {
  /** Line breaks normalised, line continuations joined; quotes kept. */
  readonly text: string;
  /** Lower case, quotes and escapes removed, so `r''m` and `"su"do` read as `rm` and `sudo`. */
  readonly plain: string;
}

/** Where the script will run, for rules that ask "is this path inside the workspace". */
export interface ScreenContext {
  readonly workspace: string;
  readonly cwd: string;
  readonly platform: NodeJS.Platform;
  readonly temporary: readonly string[];
}

/** A refusal: which rule, and the sentence the model reads. */
export interface ShellRefusal {
  readonly rule: string;
  readonly message: string;
}

/** What the shell tool holds for `workspace.shell`. */
export interface ShellTool {
  readonly execute: (
    operation: string,
    args: Readonly<Record<string, unknown>>,
    workspace: string,
    signal?: AbortSignal,
  ) => unknown;
  /** The refusal the screen would give this call, or undefined; asked before approval. */
  readonly screen: (
    args: Readonly<Record<string, unknown>>,
    workspace: string,
  ) => string | undefined;
}

/** One line of `shell.log`. */
export interface ShellLogEntry {
  readonly shell: string | undefined;
  readonly cwd: string;
  readonly script: string;
  /** Set when the script ran. */
  readonly exitCode?: number;
  readonly timedOut?: boolean;
  readonly durationMs?: number;
  /** Set when the screen refused it, and nothing ran. */
  readonly refusedBy?: string;
  /** Set when the call failed for another reason (a write-scope violation, no shell found). */
  readonly error?: string;
}
