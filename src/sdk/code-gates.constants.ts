import type { GateName } from './code-gates.types';
import type { AgentToolCategory } from './workspace-toolkit.types';

/** Every gate, in the order a done-check shorthand may list them. */
export const GATE_NAMES: readonly GateName[] = ['lint', 'typecheck', 'test', 'build', 'format'];

/** The longest a single gate may run unless the model asks for less. */
export const GATE_DEFAULT_TIMEOUT_MS = 600_000;

/** The longest a gate may be given. */
export const GATE_MAX_TIMEOUT_MS = 1_800_000;

/** Characters of output kept for parsing; both ends are kept. */
export const GATE_PARSE_OUTPUT_CHARS = 400_000;

/** Characters of the output tail handed back with a failing gate. */
export const GATE_TAIL_CHARS = 600;

/** The most issues and failing tests listed. */
export const GATE_MAX_ISSUES = 8;

/** The longest message of one issue or failing test. */
export const GATE_MAX_MESSAGE_CHARS = 200;

/** The most files one narrowed gate takes. */
export const GATE_MAX_FILES = 100;

/** The most workspace folders and changed projects detection lists. */
export const GATE_MAX_LISTED_DIRS = 30;

/** The most failing test files re-run once to look for flakiness. */
export const GATE_FLAKY_RERUN_FILES = 10;

/** The most results `report` returns. */
export const GATE_REPORT_MAX = 12;

/** The most folders a `changed` run covers in one call. */
export const GATE_MAX_CHANGED_PROJECTS = 6;

/** Marks a gate that could not run, in a result's `status`. */
export const GATE_UNAVAILABLE = 'unavailable' as const;

/** The operations of `code.gates`; all fall under the `command` grant. */
export const GATES_TOOL_OPERATIONS: Readonly<Record<string, AgentToolCategory>> = {
  detect: 'command',
  run: 'command',
  report: 'command',
};

export const GATES_TOOL_DESCRIPTION =
  'Validate code with short structured results, not logs. detect {scope?}: projects, gate commands, folders of your changed files. ' +
  'run {gate: lint|typecheck|test|build|format, scope?: folder|"changed", files? (lint, format, test), timeoutMs?} returns ' +
  '{status: pass|fail|unavailable|timeout, ok, summary:{errors, warnings, failedTests:[{name,file,message}], issues:["file:line:col message"]}, tail, notRun?}. ' +
  'Failing tests re-run once (pass then = flaky). unavailable = could not run: never a pass; say so. ' +
  'A pass lists notRun gates: run those the task names before saying done. report: latest per gate. ' +
  'Run in the touched folder, not the whole monorepo.';

/** One schema for the three operations. */
export const GATES_TOOL_INPUT_SCHEMA = {
  type: 'object',
  additionalProperties: false,
  properties: {
    gate: { type: 'string', enum: GATE_NAMES },
    scope: { type: 'string' },
    files: { type: 'array', items: { type: 'string' } },
    timeoutMs: { type: 'integer' },
  },
} as const;
