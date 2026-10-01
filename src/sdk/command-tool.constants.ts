/** How long a foreground command may run unless the model asks for more. */
export const COMMAND_DEFAULT_TIMEOUT_MS = 120_000;

/** The longest a foreground command may be given. */
export const COMMAND_MAX_TIMEOUT_MS = 1_800_000;

/** The longest one `wait` call blocks; the model polls again for more. */
export const COMMAND_MAX_WAIT_MS = 600_000;

/** Characters of each stream handed back unless the model asks for more. */
export const COMMAND_DEFAULT_OUTPUT_CHARS = 24_000;

/** The most characters of one stream a call may return. */
export const COMMAND_MAX_OUTPUT_CHARS = 48_000;

/** The head kept from each stream; the rest of the budget is the tail, where errors are. */
export const COMMAND_HEAD_CHARS = 4_000;

/** The most arguments one command may carry. */
export const COMMAND_MAX_ARGUMENTS = 50;

/** The longest single argument, matching the tool definition. */
export const COMMAND_MAX_ARGUMENT_CHARS = 4_096;

/** Background processes alive at once, per toolkit. */
export const COMMAND_MAX_BACKGROUND = 4;

/** Background entries kept for reading after they finish; the oldest finished go first. */
export const COMMAND_RETAINED_PROCESSES = 16;

/** Characters of output a background process keeps; older output is dropped. */
export const COMMAND_BACKGROUND_BUFFER_CHARS = 1_048_576;

/** The wait for a stopped process to finish dying before `stop` reports. */
export const COMMAND_STOP_SETTLE_MS = 2_000;

/** How long after `exit` a command may still hold its pipes open before its result is returned. */
export const COMMAND_EXIT_SETTLE_MS = 1_000;

/** Extra time after the termination grace period before the group is force-killed. */
export const COMMAND_GROUP_KILL_MARGIN_MS = 250;

/**
 * Variables added to the base allowlist for a command.
 *
 * npm, git and node on Windows need the shell and program locations to resolve
 * anything (`ComSpec` for `.cmd` shims, `PATHEXT` for extension search,
 * `ProgramFiles` for git's own tools). None of these hold a credential. Proxy
 * variables are left out because their URLs commonly embed one.
 */
export const COMMAND_EXTRA_ENVIRONMENT_KEYS: readonly string[] = [
  'ComSpec',
  'COMSPEC',
  'PATHEXT',
  'SystemDrive',
  'ProgramFiles',
  'ProgramFiles(x86)',
  'ProgramW6432',
  'ProgramData',
  'ALLUSERSPROFILE',
  'HOMEDRIVE',
  'HOMEPATH',
  'USERNAME',
  'USER',
  'LOGNAME',
  'SHELL',
  'TMPDIR',
  'TERM',
  'OS',
  'NUMBER_OF_PROCESSORS',
  'PROCESSOR_ARCHITECTURE',
  'LC_CTYPE',
  'TZ',
  'NODE_EXTRA_CA_CERTS',
];

/** Forced on every command: no colour, no prompts, no update checks, CI behaviour. */
export const COMMAND_FIXED_ENVIRONMENT: Readonly<Record<string, string>> = {
  CI: 'true',
  FORCE_COLOR: '0',
  NO_COLOR: '1',
  GIT_TERMINAL_PROMPT: '0',
  GCM_INTERACTIVE: 'never',
  NPM_CONFIG_UPDATE_NOTIFIER: 'false',
  NPM_CONFIG_FUND: 'false',
  NPM_CONFIG_AUDIT: 'false',
};

/** What the model needs to know when it reaches for a shell that is not there. */
export const COMMAND_NO_SHELL_HINT =
  'Commands run WITHOUT a shell: no pipes, redirects, globbing or &&. Use workspace.file list/glob/search to inspect files, and run one program per call.';

/** An argument that is nothing but shell syntax: `|`, `||`, `&&`, `&`, `;`, `<`, `>`, `>>`, `2>&1`, `2>`, `&>`. */
export const COMMAND_SHELL_TOKEN_PATTERN = /^(?:\|\|?|&&?|;|<|>>?|[0-9]?>&[0-9]|[0-9]>>?|&>>?)$/u;

/**
 * cmd.exe syntax: NUL, line breaks, `%VAR%`, the double quote that ends cross-spawn's
 * quoting so the rest runs as a new command, and the operators `& | < > ^ ( ) !`.
 * A trailing backslash (checked separately) would escape the closing quote.
 */
export const UNSAFE_SHIM_ARGUMENT = /[\0\r\n%"&|<>^()!]/u;
