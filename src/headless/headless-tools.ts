import { HEADLESS_MAX_CONTENT_BYTES } from './headless-session.constants';

/**
 * The tools a headless run may use.
 *
 * Fixed rather than configurable, and scoped to one directory. A run nobody is
 * watching should not be able to widen its own reach, and the surface a
 * pipeline schedules unattended is exactly the surface worth keeping small.
 */
export const HEADLESS_TOOLS: readonly unknown[] = [
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
];
