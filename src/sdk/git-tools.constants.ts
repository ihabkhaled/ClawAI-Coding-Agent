import type { AgentToolCategory } from './workspace-toolkit.types';

/** Read operations this module adds to `workspace.git` (status, diff and log stay in the executor). */
export const GIT_EXTRA_READ_OPERATIONS: readonly string[] = ['show', 'remote', 'branch'];

/** Operations that change the repository or talk to a remote. Category `git-write`. */
export const GIT_WRITE_OPERATIONS: readonly string[] = [
  'add',
  'unstage',
  'commit',
  'fetch',
  'pull',
  'push',
  'switch',
  'restore',
];

/** The category of each operation this module owns. */
export const GIT_TOOL_OPERATION_CATEGORIES: Readonly<Record<string, AgentToolCategory>> = {
  show: 'git',
  remote: 'git',
  branch: 'git',
  add: 'git-write',
  unstage: 'git-write',
  commit: 'git-write',
  fetch: 'git-write',
  pull: 'git-write',
  push: 'git-write',
  switch: 'git-write',
  restore: 'git-write',
};

/** The only remote the write operations talk to. */
export const GIT_REMOTE_NAME = 'origin';

/** Quick local operations. */
export const GIT_QUICK_TIMEOUT_MS = 30_000;

/** Commit, fetch, pull and push run hooks or the network: 30 minutes by default. */
export const GIT_SLOW_TIMEOUT_MS = 30 * 60_000;

/** The longest a caller may ask a slow operation to run: 60 minutes. */
export const GIT_MAX_TIMEOUT_SECONDS = 3600;

/** After a kill, how long to wait for the pipes to close before answering anyway. */
export const GIT_KILL_GRACE_MS = 2000;

/** Each output stream keeps its first and last characters; the middle is dropped. */
export const GIT_OUTPUT_HEAD_CHARS = 4000;
export const GIT_OUTPUT_TAIL_CHARS = 8000;

/** Nothing this module returns is larger than this many characters of JSON. */
export const GIT_RESULT_CEILING = 60_000;

/** The most paths one add, unstage or restore call may name. */
export const GIT_MAX_PATHS = 100;

/** Commit message limits. */
export const GIT_MAX_HEADER_CHARS = 100;
export const GIT_MAX_BODY_CHARS = 20_000;
export const GIT_MAX_TRAILERS = 10;
export const GIT_MAX_TRAILER_CHARS = 300;

/** The longest branch or ref name accepted. */
export const GIT_MAX_REF_CHARS = 200;

/** Conflicts listed back after a refused pull. */
export const GIT_MAX_CONFLICTS = 50;

/** A branch name that cannot be read as a flag or a refspec. */
export const GIT_BRANCH_PATTERN = /^[A-Za-z0-9_][A-Za-z0-9._/-]*$/u;

/** A revision for `show`: names, `~`, `^` and reflog braces; no ranges, no `rev:path`. */
export const GIT_REF_PATTERN = /^[A-Za-z0-9_][A-Za-z0-9._/@^~{}-]*$/u;

/** `Co-Authored-By: Name <address>`; the only trailer a commit may carry. */
export const GIT_TRAILER_PATTERN = /^Co-Authored-By: [^<>\r\n]+ <[^<>\s@]+@[^<>\s@]+>$/iu;

/** A path made only of wildcard and dot characters names everything under it. */
export const GIT_MATCH_EVERYTHING_PATTERN = /^[*?./\\]*$/u;

/** Prefix of the temp directory a commit message is written into. */
export const GIT_MESSAGE_DIRECTORY_PREFIX = 'claw-git-message-';

/** Credential helper arguments when the GitHub CLI is installed. */
export const GIT_GH_CREDENTIAL_ARGUMENTS: readonly string[] = [
  '-c',
  'credential.helper=',
  '-c',
  'credential.helper=!gh auth git-credential',
];

/** Config a push pins so nothing but the named branch is sent. */
export const GIT_PUSH_CONFIG: readonly string[] = ['push.followTags=false'];

/** The most commits a `log` call returns, whatever the model asks for. */
export const GIT_LOG_MAX_COUNT = 50;

/** Every `workspace.git` operation and the category it falls in. */
export const GIT_TOOL_OPERATIONS: Readonly<Record<string, AgentToolCategory>> = {
  status: 'git',
  diff: 'git',
  log: 'git',
  ...GIT_TOOL_OPERATION_CATEGORIES,
};

export const GIT_TOOL_DESCRIPTION =
  'Git in the workspace repo. Read: status, diff {staged?, path?}, log {maxCount<=50}, show {ref}, branch, remote (URLs redacted). ' +
  'Write (granted separately): add/unstage/restore take explicit "paths" (never "." or a wildcard); ' +
  'commit {message (one line, <=100 chars), body?, trailers?[Co-Authored-By]} runs the hooks; fetch; ' +
  'pull (rebase only, no autostash; a conflict is reported and the rebase aborted); ' +
  'push (HEAD to origin, current or named "branch", never forced); switch {branch, create?}. ' +
  'Hooks can take minutes: timeoutSeconds (default 1800, max 3600).';

export const GIT_TOOL_INPUT_SCHEMA = {
  type: 'object',
  additionalProperties: false,
  properties: {
    path: { type: 'string' },
    staged: { type: 'boolean' },
    maxCount: { type: 'integer' },
    ref: { type: 'string' },
    paths: { type: 'array', items: { type: 'string' } },
    message: { type: 'string' },
    body: { type: 'string' },
    trailers: { type: 'array', items: { type: 'string' } },
    branch: { type: 'string' },
    create: { type: 'boolean' },
    timeoutSeconds: { type: 'integer' },
  },
} as const;
