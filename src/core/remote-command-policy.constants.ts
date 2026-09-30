/**
 * F096 / F100 — what a remote command may be without a local prompt.
 *
 * Only an exact executable plus a known read-only first argument qualifies.
 * Everything else is R2 or higher and needs the person at this machine.
 */
export const REMOTE_READ_ONLY_COMMANDS: Readonly<Record<string, readonly string[] | null>> = {
  git: ['status', 'log', 'diff', 'show', 'branch', 'remote', 'rev-parse'],
  ls: null,
  dir: null,
  pwd: null,
  whoami: null,
  node: ['--version', '-v'],
  npm: ['--version', '-v', 'ls', 'view'],
};

/**
 * Characters that mean a shell would do something beyond running one program.
 * Remote commands run with `shell: false`, so these would be passed literally
 * and silently change meaning; they are refused instead.
 */
export const REMOTE_SHELL_OPERATOR_PATTERN = /[|&;<>`$(){}\n\r]/u;

export const REMOTE_COMMAND_MAX_LENGTH = 4_096;
export const REMOTE_COMMAND_MAX_ARGUMENTS = 64;

/** Arguments that turn an otherwise read-only git or npm call into a write. */
export const REMOTE_WRITE_FLAGS: readonly string[] = [
  '--output',
  '-o',
  '--delete',
  '-d',
  '-D',
  '--set-url',
  'add',
  'remove',
  'rename',
];

/**
 * Flags that write, or read outside the tree, whatever follows them. Matched by
 * prefix so `--output=/tmp/x` is caught as well as `--output /tmp/x`.
 */
export const REMOTE_UNSAFE_FLAG_PREFIXES: readonly string[] = [
  '--output',
  '--no-index',
  '--ext-diff',
  '--textconv',
  '--exec',
  '--config',
  '--upload-pack',
  '--receive-pack',
];

/**
 * Arguments a read-only subcommand may take after its name. `git branch x`
 * creates a branch and `git remote set-url` rewrites one, so these two are
 * read-only only in their listing forms; anything else needs a local approval.
 */
export const REMOTE_SUBCOMMAND_ALLOWED_ARGUMENTS: Readonly<Record<string, readonly string[]>> = {
  'git branch': [
    '-a',
    '-r',
    '-v',
    '-vv',
    '--list',
    '--all',
    '--remotes',
    '--verbose',
    '--show-current',
  ],
  'git remote': ['-v', '--verbose'],
};
