import {
  COMMAND_DEFAULT_OUTPUT_CHARS,
  COMMAND_DEFAULT_TIMEOUT_MS,
  COMMAND_MAX_ARGUMENTS,
  COMMAND_MAX_ARGUMENT_CHARS,
  COMMAND_MAX_BACKGROUND,
  COMMAND_MAX_OUTPUT_CHARS,
  COMMAND_MAX_TIMEOUT_MS,
  COMMAND_MAX_WAIT_MS,
} from './command-tool.constants';

import type { AgentToolCategory } from './workspace-toolkit.types';

/** Every command operation is the `command` category: a grant covers starting, reading and stopping. */
export const COMMAND_TOOL_OPERATIONS: Readonly<Record<string, AgentToolCategory>> = {
  run: 'command',
  output: 'command',
  wait: 'command',
  stop: 'command',
};

/** What the model is told; it teaches tail-first output, the timeout and background runs. */
export const COMMAND_TOOL_DESCRIPTION =
  'Run a program in the workspace (no shell; pass arguments as an array). ' +
  'run: waits up to timeoutMs (default 120000, max 1800000) and returns exitCode, stdout, stderr, ' +
  'timedOut, durationMs. Long output keeps its first 4000 characters and its END, where errors are, ' +
  'with the middle marked omitted; raise maxOutputChars (max 48000) or pipe the run to a narrower ' +
  'command if you need more. A timeout kills the whole process tree. ' +
  'For anything slower than the timeout (a push hook, a dev server) use run with background: true, ' +
  'which returns { processId } at once; then output {processId, sinceOffset} reads what it printed ' +
  '(pass the returned nextOffset), wait {processId, timeoutMs} blocks up to 600000 ms for it to ' +
  'finish, and stop {processId} kills it. At most 4 background processes; all die when the run ends.';

/** One schema for all four operations: `executable` for run, `processId` for the rest. */
export const COMMAND_TOOL_INPUT_SCHEMA = {
  type: 'object',
  additionalProperties: false,
  properties: {
    executable: { type: 'string', maxLength: 200, description: 'run: program name, e.g. npm.' },
    arguments: {
      type: 'array',
      items: { type: 'string', maxLength: COMMAND_MAX_ARGUMENT_CHARS },
      maxItems: COMMAND_MAX_ARGUMENTS,
    },
    cwd: {
      type: 'string',
      maxLength: 4096,
      description: 'run: directory inside the workspace, relative to its root.',
    },
    timeoutMs: {
      type: 'integer',
      minimum: 1,
      maximum: COMMAND_MAX_TIMEOUT_MS,
      description: `run: default ${String(COMMAND_DEFAULT_TIMEOUT_MS)}. wait: at most ${String(COMMAND_MAX_WAIT_MS)}.`,
    },
    maxOutputChars: {
      type: 'integer',
      minimum: 200,
      maximum: COMMAND_MAX_OUTPUT_CHARS,
      description: `Combined output budget, default ${String(COMMAND_DEFAULT_OUTPUT_CHARS)}.`,
    },
    background: {
      type: 'boolean',
      description: `run: start without waiting and return { processId } (max ${String(COMMAND_MAX_BACKGROUND)} alive).`,
    },
    processId: { type: 'string', maxLength: 64, description: 'output, wait, stop.' },
    sinceOffset: {
      type: 'integer',
      minimum: 0,
      description: 'output: the nextOffset you last saw.',
    },
  },
} as const;
