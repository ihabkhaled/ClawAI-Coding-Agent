import { describe, expect, it } from 'vitest';

import { needsApproval, permissionsForMode } from '../../src/sdk/permission-modes';

import type { AgentPermissionMode } from '../../src/sdk/permission-modes.types';
import type { AgentToolCategory } from '../../src/sdk/workspace-toolkit.types';

type Row = readonly [
  tool: string,
  operation: string,
  category: AgentToolCategory,
  asked: Readonly<Record<'ask' | 'accept-edits' | 'autonomous-scoped' | 'strict', boolean>>,
];

const NEVER = { ask: false, 'accept-edits': false, 'autonomous-scoped': false, strict: false };
const ALWAYS = { ask: true, 'accept-edits': true, 'autonomous-scoped': true, strict: true };
/** Asked everywhere except `autonomous-scoped`, which runs what the editor's policy calls local. */
const LIKE_COMMAND = { ask: true, 'accept-edits': true, 'autonomous-scoped': false, strict: true };

const ROWS: readonly Row[] = [
  ['task.plan', 'set', 'read', NEVER],
  ['task.plan', 'update', 'read', NEVER],
  ['knowledge.context', 'search', 'read', NEVER],
  ['vision.describe', 'describe', 'read', NEVER],
  ['workspace.command', 'run', 'command', LIKE_COMMAND],
  ['process.watch', 'start', 'command', LIKE_COMMAND],
  ['process.watch', 'status', 'command', NEVER],
  ['process.watch', 'output', 'command', NEVER],
  ['process.watch', 'wait', 'command', NEVER],
  ['process.watch', 'list', 'command', NEVER],
  ['process.watch', 'stop', 'command', NEVER],
  ['code.gates', 'run', 'command', LIKE_COMMAND],
  ['code.gates', 'detect', 'command', NEVER],
  ['code.gates', 'report', 'command', NEVER],
  ['http.request', 'request', 'http', NEVER],
  ['http.request', 'request', 'http-write', ALWAYS],
  ['browser.page', 'open', 'browser', LIKE_COMMAND],
  ['browser.page', 'click', 'browser', LIKE_COMMAND],
  ['browser.page', 'type', 'browser', LIKE_COMMAND],
  ['browser.page', 'press', 'browser', LIKE_COMMAND],
  ['browser.page', 'snapshot', 'browser', NEVER],
  ['browser.page', 'screenshot', 'browser', NEVER],
  ['browser.page', 'console', 'browser', NEVER],
  ['browser.page', 'close', 'browser', NEVER],
  ['workspace.shell', 'run', 'shell', ALWAYS],
  [
    'agent.team',
    'spawn',
    'agents',
    { ask: true, 'accept-edits': false, 'autonomous-scoped': false, strict: true },
  ],
  ['agent.team', 'wait', 'agents', NEVER],
  ['agent.team', 'cancel', 'agents', NEVER],
];

const MODES = ['ask', 'accept-edits', 'autonomous-scoped', 'strict'] as const;

describe('permission modes over the tools added in 1.96.0', () => {
  for (const mode of MODES) {
    it(`${mode}: asks exactly where the matrix says`, () => {
      const wrong = ROWS.filter(([tool, operation, category, asked]) => {
        const got = needsApproval(mode, { toolName: tool, operation, arguments: {}, category });
        return got !== asked[mode];
      }).map(([tool, operation, category]) => `${tool}.${operation} [${category}]`);

      expect(wrong).toEqual([]);
    });
  }

  it('plan removes every category that can change anything, new ones included', () => {
    const everything: readonly AgentToolCategory[] = [
      'read',
      'write',
      'command',
      'git',
      'git-write',
      'mcp',
      'http',
      'http-write',
      'browser',
      'shell',
      'agents',
    ];
    const planned = permissionsForMode('plan', { allow: everything });

    expect(planned.allow).toEqual(['read', 'git', 'http']);
    expect(planned.approve).toBeUndefined();
  });

  it('a mode that asks denies a new tool when there is no approver', async () => {
    const modes: readonly AgentPermissionMode[] = [...MODES];
    for (const mode of modes) {
      const { approve } = permissionsForMode(mode, { allow: ['shell', 'http-write', 'browser'] });
      const answer = await approve?.({
        toolName: 'workspace.shell',
        operation: 'run',
        arguments: {},
        category: 'shell',
      });

      expect(answer).toBe(false);
    }
  });
});
