/** A secret name becomes an environment variable: upper case, digits and underscores. */
export const JOB_SECRET_NAME_PATTERN = /^[A-Z][A-Z0-9_]{0,63}$/u;

/** Mirrors the server: a value is 1 to 8192 UTF-8 bytes with no NUL. */
export const JOB_SECRET_MAX_VALUE_BYTES = 8_192;

/** At most this many secrets are exported for one job. */
export const JOB_SECRET_MAX_COUNT = 20;

/** Shorter values are not scrubbed from output: they would mangle ordinary text. */
export const JOB_SECRET_MIN_REDACTED_LENGTH = 4;

/** Names that would change how a process loads code, never exported even if sent. */
export const JOB_SECRET_FORBIDDEN_NAMES: ReadonlySet<string> = new Set([
  'PATH',
  'HOME',
  'NODE_OPTIONS',
  'BASH_ENV',
  'ENV',
  'SHELL',
  'IFS',
  'PWD',
  'TMPDIR',
  'PYTHONPATH',
  'PYTHONSTARTUP',
  'RUBYOPT',
  'PERL5OPT',
  'GIT_SSH_COMMAND',
  'GIT_EXEC_PATH',
]);

/** Name prefixes refused for the same reason. */
export const JOB_SECRET_FORBIDDEN_PREFIXES: readonly string[] = [
  'CLAW_',
  'LD_',
  'DYLD_',
  'NPM_CONFIG_',
];

export const JOB_SECRET_REDACTION = '[REDACTED]';
