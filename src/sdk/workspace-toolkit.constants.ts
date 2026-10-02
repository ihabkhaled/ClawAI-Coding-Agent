import {
  GATES_TOOL_DESCRIPTION,
  GATES_TOOL_INPUT_SCHEMA,
  GATES_TOOL_OPERATIONS,
} from './code-gates.constants';
import {
  COMMAND_TOOL_DESCRIPTION,
  COMMAND_TOOL_INPUT_SCHEMA,
  COMMAND_TOOL_OPERATIONS,
} from './command-tool-definition.constants';
import {
  FILE_TOOL_DESCRIPTION,
  FILE_TOOL_INPUT_SCHEMA,
  FILE_TOOL_OPERATIONS,
} from './file-tools.constants';
import {
  GIT_LOG_MAX_COUNT,
  GIT_TOOL_DESCRIPTION,
  GIT_TOOL_INPUT_SCHEMA,
  GIT_TOOL_OPERATIONS,
} from './git-tools.constants';
import { HTTP_TOOL_NAME, HTTP_TOOL_OPERATIONS } from './http-tool.constants';
import {
  NOTES_TOOL_DESCRIPTION,
  NOTES_TOOL_INPUT_SCHEMA,
  NOTES_TOOL_OPERATIONS,
} from './notes-tool.constants';
import {
  SHELL_TOOL_DESCRIPTION,
  SHELL_TOOL_INPUT_SCHEMA,
  SHELL_TOOL_OPERATIONS,
} from './shell-tool.constants';
import {
  PLAN_TOOL_DESCRIPTION,
  PLAN_TOOL_INPUT_SCHEMA,
  PLAN_TOOL_NAME,
  PLAN_TOOL_OPERATIONS,
} from './task-plan-tool.constants';

import type { AgentToolCategory } from './workspace-toolkit.types';

/** What a run may read or list unless the caller grants more. */
export const AGENT_DEFAULT_TOOL_CATEGORIES: readonly AgentToolCategory[] = ['read', 'git'];

/** The largest slice of command or git output handed back to the model. */
export const AGENT_TOOL_OUTPUT_CEILING = 16_000;

/** How long a spawned command or git call may run before it is killed. */
export const AGENT_TOOL_TIMEOUT_MS = 30_000;

/** The most commits a `log` call returns, whatever the model asks for. */
export const AGENT_GIT_LOG_MAX = GIT_LOG_MAX_COUNT;

/** The operations in each category, per tool, so filtering is a lookup. */
export const AGENT_TOOL_OPERATIONS: Readonly<
  Record<string, Readonly<Record<string, AgentToolCategory>>>
> = {
  'workspace.file': FILE_TOOL_OPERATIONS,
  'workspace.command': COMMAND_TOOL_OPERATIONS,
  'workspace.git': GIT_TOOL_OPERATIONS,
  'workspace.notes': NOTES_TOOL_OPERATIONS,
  [PLAN_TOOL_NAME]: PLAN_TOOL_OPERATIONS,
  'code.gates': GATES_TOOL_OPERATIONS,
  [HTTP_TOOL_NAME]: HTTP_TOOL_OPERATIONS,
  'workspace.shell': SHELL_TOOL_OPERATIONS,
};

/**
 * The runtime tool contracts this SDK can execute locally.
 *
 * `workspace.git` reads under `git`; add, commit, push and the rest need the
 * separate `git-write` grant, so a run that can only look cannot commit.
 */
export const AGENT_WORKSPACE_TOOL_DEFINITIONS: readonly {
  readonly name: string;
  readonly operations: readonly string[];
  readonly [key: string]: unknown;
}[] = [
  {
    schemaVersion: '2.0',
    name: 'workspace.file',
    version: '2.0.0',
    description: FILE_TOOL_DESCRIPTION,
    operations: Object.keys(FILE_TOOL_OPERATIONS),
    riskClasses: ['inspect', 'workspace-write'],
    targetIds: ['target:workspace'],
    inputSchema: FILE_TOOL_INPUT_SCHEMA,
  },
  {
    schemaVersion: '2.0',
    name: 'workspace.command',
    version: '2.0.0',
    description: COMMAND_TOOL_DESCRIPTION,
    operations: Object.keys(COMMAND_TOOL_OPERATIONS),
    riskClasses: ['process'],
    targetIds: ['target:workspace'],
    inputSchema: COMMAND_TOOL_INPUT_SCHEMA,
  },
  {
    schemaVersion: '2.0',
    name: 'workspace.git',
    version: '2.0.0',
    description: GIT_TOOL_DESCRIPTION,
    operations: Object.keys(GIT_TOOL_OPERATIONS),
    riskClasses: ['inspect', 'workspace-write', 'network'],
    targetIds: ['target:workspace'],
    inputSchema: GIT_TOOL_INPUT_SCHEMA,
  },
  {
    schemaVersion: '2.0',
    name: 'workspace.notes',
    version: '1.0.0',
    description: NOTES_TOOL_DESCRIPTION,
    operations: Object.keys(NOTES_TOOL_OPERATIONS),
    riskClasses: ['inspect'],
    targetIds: ['target:workspace'],
    inputSchema: NOTES_TOOL_INPUT_SCHEMA,
  },
  {
    schemaVersion: '2.0',
    name: PLAN_TOOL_NAME,
    version: '1.0.0',
    description: PLAN_TOOL_DESCRIPTION,
    operations: Object.keys(PLAN_TOOL_OPERATIONS),
    riskClasses: ['inspect'],
    targetIds: ['target:workspace'],
    inputSchema: PLAN_TOOL_INPUT_SCHEMA,
  },
  {
    schemaVersion: '2.0',
    name: 'code.gates',
    version: '1.0.0',
    description: GATES_TOOL_DESCRIPTION,
    operations: Object.keys(GATES_TOOL_OPERATIONS),
    riskClasses: ['process'],
    targetIds: ['target:workspace'],
    inputSchema: GATES_TOOL_INPUT_SCHEMA,
  },
  {
    schemaVersion: '2.0',
    name: 'workspace.shell',
    version: '1.0.0',
    description: SHELL_TOOL_DESCRIPTION,
    operations: Object.keys(SHELL_TOOL_OPERATIONS),
    riskClasses: ['process'],
    targetIds: ['target:workspace'],
    inputSchema: SHELL_TOOL_INPUT_SCHEMA,
  },
];
