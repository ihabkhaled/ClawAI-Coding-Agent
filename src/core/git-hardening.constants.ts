/**
 * Config keys that make git run a program named by the repository, not by us.
 * Every one is pinned on the command line, where `-c` outranks repo config.
 * `core.hooksPath` is added at run time because the null device is per-OS.
 */
export const GIT_NEUTRALISING_CONFIG: readonly string[] = [
  'core.fsmonitor=false',
  'core.pager=cat',
  'core.editor=true',
  'diff.external=',
  'protocol.ext.allow=never',
  'core.sshCommand=',
];

/** Environment git always gets: no prompt, no pager, no system config. */
export const GIT_HARDENED_ENVIRONMENT: Readonly<Record<string, string>> = {
  GIT_TERMINAL_PROMPT: '0',
  GIT_PAGER: 'cat',
  GIT_CONFIG_NOSYSTEM: '1',
};

/** Inherited variables that would name a program for git to run. */
export const GIT_STRIPPED_ENVIRONMENT: readonly string[] = [
  'GIT_EXTERNAL_DIFF',
  'GIT_SSH_COMMAND',
  'GIT_SSH',
  'GIT_ASKPASS',
  'GIT_EDITOR',
  'GIT_SEQUENCE_EDITOR',
  'GIT_PROXY_COMMAND',
  'GIT_CONFIG_GLOBAL',
  'GIT_CONFIG_COUNT',
  'GIT_CONFIG_PARAMETERS',
  'GIT_EXEC_PATH',
];

/** Flags that let a read run a diff or textconv program from the repo. */
export const GIT_READ_SAFETY_FLAGS: Readonly<Record<string, readonly string[]>> = {
  diff: ['--no-ext-diff', '--no-textconv'],
  show: ['--no-ext-diff', '--no-textconv'],
  log: ['--no-ext-diff', '--no-textconv'],
  blame: ['--no-textconv'],
};

/**
 * Repo-local config keys (lower case) whose value is a program git would run
 * and that a `-c` override cannot pin. The pinned ones (fsmonitor, pager,
 * editor, hooksPath, diff.external, sshCommand) are neutralised, not refused.
 */
export const PROGRAM_CONFIG_KEYS: readonly RegExp[] = [
  /^core\.(?:gitproxy|askpass)$/u,
  /^diff\..+\.(?:textconv|command)$/u,
  /^filter\..+\.(?:clean|smudge|process)$/u,
  /^merge\..+\.driver$/u,
  /^credential\..*helper$/u,
  /^gpg\.(?:.+\.)?program$/u,
  /^(?:uploadpack|receivepack)\.(?:packobjectshook|uploadpack|receivepack)$/u,
  /^remote\..+\.(?:uploadpack|receivepack|vcs)$/u,
];

/**
 * The neutralising config for git that is allowed to run the repository's own
 * hooks. Everything that names another program stays pinned; `core.hooksPath` is
 * left alone, and `core.sshCommand` is pinned to plain `ssh` because an empty
 * value would break every push over ssh.
 */
export const GIT_WRITE_NEUTRALISING_CONFIG: readonly string[] = [
  ...GIT_NEUTRALISING_CONFIG.filter((pair) => pair !== 'core.sshCommand='),
  'core.sshCommand=ssh',
];

/**
 * Long flags a command-tool git call may not carry: each one names a program git
 * runs, a file it writes, or a repository outside the workspace. Matched as
 * `--flag` or `--flag=value`.
 */
export const GIT_REFUSED_LONG_FLAGS: readonly string[] = [
  '--output',
  '--upload-pack',
  '--receive-pack',
  '--exec',
  '--exec-path',
  '--config-env',
  '--config',
  '--git-dir',
  '--work-tree',
  '--force',
  '--force-with-lease',
  '--force-if-includes',
];

/** Short flags with the same effect: `-c key=value`, the attached `-ckey=value`, and `-f` (force). */
export const GIT_REFUSED_SHORT_FLAG = /^-(?:c|f$)/u;
