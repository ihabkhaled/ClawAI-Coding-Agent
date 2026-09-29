import { HEADLESS_MAX_CONTENT_BYTES } from '../headless/headless-session.constants';

import type { AgentToolCategory } from './workspace-toolkit.types';

/** What a run may read or list unless the caller grants more. */
export const AGENT_DEFAULT_TOOL_CATEGORIES: readonly AgentToolCategory[] = ['read', 'git'];

/** The largest slice of command or git output handed back to the model. */
export const AGENT_TOOL_OUTPUT_CEILING = 16_000;

/** How long a spawned command or git call may run before it is killed. */
export const AGENT_TOOL_TIMEOUT_MS = 30_000;

/** The most commits a `log` call returns, whatever the model asks for. */
export const AGENT_GIT_LOG_MAX = 50;

/** The operations in each category, per tool, so filtering is a lookup. */
export const AGENT_TOOL_OPERATIONS: Readonly<
  Record<string, Readonly<Record<string, AgentToolCategory>>>
> = {
  'workspace.file': { read: 'read', list: 'read', create: 'write' },
  'workspace.command': { run: 'command' },
  'workspace.git': { status: 'git', diff: 'git', log: 'git' },
};

/**
 * The runtime tool contracts this SDK can execute locally.
 *
 * `workspace.git` is read-only here on purpose: status, diff and log. A
 * host-free run that could commit or push would be one nobody reviews.
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
    description: 'Read, write and list files in the workspace.',
    operations: ['read', 'create', 'list'],
    riskClasses: ['inspect', 'workspace-write'],
    targetIds: ['target:workspace'],
    inputSchema: {
      type: 'object',
      additionalProperties: false,
      properties: {
        path: { type: 'string', maxLength: 4096 },
        content: { type: 'string', maxLength: HEADLESS_MAX_CONTENT_BYTES },
      },
    },
  },
  {
    schemaVersion: '2.0',
    name: 'workspace.command',
    version: '2.0.0',
    description: 'Run a bounded command in the workspace and return its output.',
    operations: ['run'],
    riskClasses: ['process'],
    targetIds: ['target:workspace'],
    inputSchema: {
      type: 'object',
      additionalProperties: false,
      properties: {
        executable: { type: 'string', maxLength: 200 },
        arguments: { type: 'array', items: { type: 'string', maxLength: 4096 }, maxItems: 50 },
      },
      required: ['executable'],
    },
  },
  {
    schemaVersion: '2.0',
    name: 'workspace.git',
    version: '2.0.0',
    description: 'Inspect the workspace Git repository: status, diff and recent log.',
    operations: ['status', 'diff', 'log'],
    riskClasses: ['inspect'],
    targetIds: ['target:workspace'],
    inputSchema: {
      type: 'object',
      additionalProperties: false,
      properties: {
        path: { type: 'string', maxLength: 4096 },
        staged: { type: 'boolean' },
        maxCount: { type: 'integer', minimum: 1, maximum: AGENT_GIT_LOG_MAX },
      },
    },
  },
];
