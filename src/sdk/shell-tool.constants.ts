import type { ShellKind } from './shell-tool.types';
import type { AgentToolCategory } from './workspace-toolkit.types';

export const SHELL_TOOL_NAME = 'workspace.shell';

export const SHELL_KINDS: readonly ShellKind[] = ['bash', 'sh', 'powershell', 'cmd'];

/** Running a script is the `shell` category, which only `--allow-tools shell` plus `--allow-shell` grants. */
export const SHELL_TOOL_OPERATIONS: Readonly<Record<string, AgentToolCategory>> = {
  run: 'shell',
};

export const SHELL_DEFAULT_TIMEOUT_MS = 120_000;
export const SHELL_MAX_TIMEOUT_MS = 1_800_000;
export const SHELL_OUTPUT_CHARS = 24_000;
export const SHELL_MAX_SCRIPT_CHARS = 20_000;
export const SHELL_MAX_DENY_RULES = 32;
export const SHELL_MAX_DENY_CHARS = 200;

/** The script is written to the log up to this many characters; the rest is counted. */
export const SHELL_LOG_SCRIPT_CHARS = 4_000;
export const SHELL_LOG_FILE = 'shell.log';

/** The log moves to shell.log.1 past this size, so it cannot grow without bound. */
export const SHELL_LOG_MAX_BYTES = 2_000_000;

/** Forced on top of the command environment: nothing in a script should wait for a person. */
export const SHELL_FIXED_ENVIRONMENT: Readonly<Record<string, string>> = {
  BASH_ENV: '',
  ENV: '',
  PAGER: 'cat',
  GIT_PAGER: 'cat',
  EDITOR: 'false',
  VISUAL: 'false',
};

export const SHELL_NO_SHELL_MESSAGE =
  'workspace.shell found no shell on this machine (looked for bash, sh, PowerShell and cmd). Install Git for Windows (Git Bash) or PowerShell 7, or use workspace.command, which needs no shell.';

/** What the model is told. It says what the tool is for, what is off limits, and that the screen is not a sandbox. */
export const SHELL_TOOL_DESCRIPTION =
  'Run a script in a real shell, for what workspace.command cannot: &&, pipes, redirects, globs, ' +
  'FOO=1 cmd, cd x && cmd, here-docs. Prefer workspace.command, file and git when one program is enough. ' +
  'The operator approves each script. Build, test, inspect and edit INSIDE the workspace only: scripts that ' +
  'touch outside it (home, ~/.ssh, credentials), dump the environment, download-and-run, force-push, change ' +
  'git config or hooks, or use --no-verify are refused with the reason (a best-effort screen, not a ' +
  'sandbox; do not work around it). run {script, shell?: bash|sh|powershell|cmd, cwd?, timeoutMs? ' +
  '(default 120000, max 1800000)} returns {exitCode, stdout, stderr, timedOut}. No stdin, filtered ' +
  'environment, long output keeps its start and END, a timeout kills the process tree.';

export const SHELL_TOOL_INPUT_SCHEMA = {
  type: 'object',
  additionalProperties: false,
  properties: {
    script: { type: 'string', maxLength: SHELL_MAX_SCRIPT_CHARS },
    shell: { type: 'string', enum: SHELL_KINDS },
    cwd: { type: 'string', maxLength: 4096, description: 'Directory inside the workspace.' },
    timeoutMs: { type: 'integer', minimum: 1, maximum: SHELL_MAX_TIMEOUT_MS },
  },
} as const;

/** Where Git for Windows keeps bash and sh, under each program-files root. */
export const SHELL_GIT_BASH_SUBPATHS: readonly string[] = [
  'Git\\bin\\bash.exe',
  'Git\\usr\\bin\\bash.exe',
];
export const SHELL_GIT_SH_SUBPATHS: readonly string[] = [
  'Git\\bin\\sh.exe',
  'Git\\usr\\bin\\sh.exe',
];
export const SHELL_POSIX_BASH: readonly string[] = [
  '/bin/bash',
  '/usr/bin/bash',
  '/usr/local/bin/bash',
];
export const SHELL_POSIX_SH: readonly string[] = ['/bin/sh', '/usr/bin/sh'];

/** The WSL launcher also answers to `bash`; it runs inside a VM, not in the workspace. */
export const SHELL_WSL_LAUNCHER = /[\\/]windows[\\/]system32[\\/]bash\.exe$/iu;
