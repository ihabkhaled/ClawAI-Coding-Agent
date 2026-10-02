import { COMMAND_MAX_ARGUMENTS, COMMAND_MAX_ARGUMENT_CHARS } from './command-tool.constants';

import type { AgentToolCategory } from './workspace-toolkit.types';

/** The tool name the model calls. */
export const PROCESS_WATCH_TOOL_NAME = 'process.watch';

/** Every operation is the `command` category: the same grant as `workspace.command`. */
export const PROCESS_WATCH_OPERATIONS: Readonly<Record<string, AgentToolCategory>> = {
  start: 'command',
  status: 'command',
  output: 'command',
  wait: 'command',
  stop: 'command',
  list: 'command',
};

/** Processes alive at once, per run. */
export const PROCESS_WATCH_MAX_CONCURRENT = 4;

/** The most a caller may raise the concurrency to. */
export const PROCESS_WATCH_MAX_CONCURRENT_CEILING = 16;

/** Finished entries kept so their output can still be read; the oldest finished go first. */
export const PROCESS_WATCH_RETAINED = 16;

/** Characters of output kept in memory per process for reading. */
export const PROCESS_WATCH_MEMORY_CHARS = 1_048_576;

/** Bytes one log file may reach before it rotates (so disk use is at most twice this). */
export const PROCESS_WATCH_FILE_BYTES = 8_388_608;

/** A partial line is committed after this much quiet, so a prompt without a newline is visible. */
export const PROCESS_WATCH_FLUSH_MS = 80;

/** A partial line is committed once it reaches this length, newline or not. */
export const PROCESS_WATCH_MAX_LINE_CHARS = 8_192;

/** Longest line the `untilMatch` pattern is tested against. */
export const PROCESS_WATCH_MATCH_LINE_CHARS = 4_096;

/** Longest `untilMatch` pattern. */
export const PROCESS_WATCH_MAX_PATTERN_CHARS = 200;

export const PROCESS_WATCH_NAME_PATTERN = /^[A-Za-z0-9][A-Za-z0-9._-]{0,39}$/u;

export const PROCESS_WATCH_DEFAULT_OUTPUT_CHARS = 8_000;
export const PROCESS_WATCH_WAIT_OUTPUT_CHARS = 2_500;
export const PROCESS_WATCH_MAX_OUTPUT_CHARS = 32_000;
export const PROCESS_WATCH_MIN_OUTPUT_CHARS = 200;

export const PROCESS_WATCH_DEFAULT_WAIT_MS = 30_000;
export const PROCESS_WATCH_MAX_WAIT_MS = 600_000;

/** How long `stop` waits for a killed tree to be reported dead (grace period plus margin). */
export const PROCESS_WATCH_STOP_SETTLE_MS = 7_500;

/** How long after `exit` the pipes may stay open before the process is reported finished. */
export const PROCESS_WATCH_EXIT_SETTLE_MS = 500;

/** Consecutive waits that ended with no new output before the result suggests another plan. */
export const PROCESS_WATCH_IDLE_WAITS_NOTE = 4;

/** What the model is told; short, because every definition is paid for on every turn. */
export const PROCESS_WATCH_DESCRIPTION =
  'Long-lived programs (push hook, dev server, watch tests) watched across calls; no shell, command allowlist. ' +
  'start {name, executable, arguments, cwd?} returns at once (max 4 alive). ' +
  'wait {name, untilExit | untilMatch: regex, timeoutMs<=600000}: returns on exit, a matching line or timeout. ' +
  'output {name, sinceCursor?, maxChars?}: pass back nextCursor for new output; none = latest, 0 = from the start. ' +
  'status {name?}, list, stop {name} (kills the tree). All die at run end.';

export const PROCESS_WATCH_INPUT_SCHEMA = {
  type: 'object',
  additionalProperties: false,
  properties: {
    name: { type: 'string' },
    executable: { type: 'string' },
    arguments: { type: 'array', items: { type: 'string' } },
    cwd: { type: 'string' },
    sinceCursor: { type: 'integer' },
    maxChars: { type: 'integer' },
    untilExit: { type: 'boolean' },
    untilMatch: { type: 'string' },
    timeoutMs: { type: 'integer' },
  },
} as const;

export const PROCESS_WATCH_MAX_ARGUMENTS = COMMAND_MAX_ARGUMENTS;
export const PROCESS_WATCH_MAX_ARGUMENT_CHARS = COMMAND_MAX_ARGUMENT_CHARS;

/** A nested quantifier such as `(a+)+` or `(.*)*`, the shape that backtracks without end. */
export const PROCESS_WATCH_NESTED_QUANTIFIER = /\((?:[^()\\]|\\.)*[+*](?:[^()\\]|\\.)*\)[+*{]/u;

/** The most one line may take to test against `untilMatch`; past it the pattern is dropped. */
export const PROCESS_WATCH_MATCH_BUDGET_MS = 100;
