/** Platforms whose file systems compare names without regard to case. */
export const WRITE_SCOPE_CASE_INSENSITIVE_PLATFORMS: readonly NodeJS.Platform[] = [
  'win32',
  'darwin',
];

/** Denied whatever the operator names: a write into `.git` is a hook, a config or a rewritten history. */
export const WRITE_SCOPE_ALWAYS_DENY: readonly string[] = [
  '**/.git/**',
  '**/.git',
  '**/git~1/**',
  '**/git~1',
];

export const WRITE_SCOPE_MAX_GLOBS = 64;
export const WRITE_SCOPE_MAX_GLOB_CHARS = 200;

/** How many scope globs a refusal names. */
export const WRITE_SCOPE_MESSAGE_GLOBS = 8;

/** The most paths one command audit reverts; the rest are reported, not touched. */
export const WRITE_SCOPE_MAX_REVERTS = 50;

/** The most paths one violation report lists. */
export const WRITE_SCOPE_MAX_REPORTED = 50;

/** The longest note a violation adds to a command result. */
export const WRITE_SCOPE_NOTE_CHARS = 2000;

export const WRITE_SCOPE_GIT_TIMEOUT_MS = 30_000;
export const WRITE_SCOPE_GIT_MAX_BUFFER = 64 * 1024 * 1024;

/** The `workspace.file` arguments that name a path the operation changes. */
export const WRITE_SCOPE_FILE_FIELDS: Readonly<Record<string, readonly string[]>> = {
  create: ['path'],
  update: ['path'],
  delete: ['path'],
  rename: ['path', 'to'],
};

/** The `workspace.git` operations that change the paths they name. */
export const WRITE_SCOPE_GIT_PATH_OPERATIONS: readonly string[] = ['add', 'unstage', 'restore'];

/** Programs whose whole job is to change files; refused when run directly. */
export const WRITE_SCOPE_REFUSED_PROGRAMS: readonly string[] = [
  'rm',
  'mv',
  'del',
  'erase',
  'rmdir',
  'rd',
  'move',
  'cp',
  'copy',
  'xcopy',
  'robocopy',
  'tee',
];

/** Programs that edit in place when given `-i` or `--in-place`. */
export const WRITE_SCOPE_IN_PLACE_PROGRAMS: readonly string[] = ['sed', 'perl'];

/** Git subcommands a command may run when a scope is set; everything else goes through `workspace.git`. */
export const WRITE_SCOPE_GIT_COMMAND_SUBCOMMANDS: readonly string[] = [
  'status',
  'diff',
  'log',
  'show',
  'rev-parse',
  'fetch',
  'pull',
  'push',
];

/** `git branch` may only list. */
export const WRITE_SCOPE_GIT_BRANCH_FLAGS: readonly string[] = [
  '--list',
  '-l',
  '-a',
  '--all',
  '-r',
  '--remotes',
  '-v',
  '-vv',
  '--verbose',
  '--show-current',
  '--no-color',
];

/** `git remote` may only list. */
export const WRITE_SCOPE_GIT_REMOTE_FLAGS: readonly string[] = ['-v', '--verbose'];

/** Files under .git whose change runs code or alters what git trusts: hooks, config, exclude, attributes. */
export const WRITE_SCOPE_GIT_GUARDED_FILES: readonly string[] = [
  'config',
  'info/exclude',
  'info/attributes',
];
export const WRITE_SCOPE_GIT_GUARDED_DIRECTORIES: readonly string[] = ['hooks'];

/** Most files and bytes per file the .git snapshot keeps; past them a file is compared by size and time only. */
export const WRITE_SCOPE_GUARD_MAX_FILES = 200;
export const WRITE_SCOPE_GUARD_MAX_BYTES = 1024 * 1024;

/** Most entries of the workspace parent folder one snapshot lists. */
export const WRITE_SCOPE_PARENT_MAX_ENTRIES = 5000;
