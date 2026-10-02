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
  'Run a program in the workspace (no shell; arguments as an array). ' +
  'run {executable, arguments, cwd?, timeoutMs? (default 120000, max 1800000), maxOutputChars? (default 24000, max 48000)} ' +
  'returns exitCode, stdout, stderr, timedOut, durationMs. Long output keeps its first 4000 characters ' +
  'and its END (where errors are); the middle is marked omitted. A timeout kills the process tree. ' +
  'For anything slower (a push hook, a dev server) run with background: true: returns { processId } at once; ' +
  'then output {processId, sinceOffset} (pass back nextOffset), wait {processId, timeoutMs<=600000}, ' +
  'stop {processId}. At most 4 background processes; all die when the run ends.';

/** One schema for all four operations: `executable` for run, `processId` for the rest. */
export const COMMAND_TOOL_INPUT_SCHEMA = {
  type: 'object',
  additionalProperties: false,
  properties: {
    executable: { type: 'string' },
    arguments: { type: 'array', items: { type: 'string' } },
    cwd: { type: 'string' },
    timeoutMs: { type: 'integer' },
    maxOutputChars: { type: 'integer' },
    background: { type: 'boolean' },
    processId: { type: 'string' },
    sinceOffset: { type: 'integer' },
  },
} as const;
