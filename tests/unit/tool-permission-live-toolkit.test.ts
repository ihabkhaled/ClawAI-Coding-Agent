import { describe, expect, it, vi } from 'vitest';

import { agentToolkit } from '../../src/sdk/agent-toolkit';
import { TOOL_PERMISSION_ROWS } from '../../src/sdk/tool-permission-table.constants';

import type { AgentToolCall } from '../../src/sdk/agent-sdk.types';
import type { AgentPermissionMode } from '../../src/sdk/permission-modes.types';
import type { ToolPermissionRow } from '../../src/sdk/tool-permission-table.types';
import type { VisionPort } from '../../src/sdk/vision-tool.types';
import type { AgentToolCategory } from '../../src/sdk/workspace-toolkit.types';

/** The tools the composed toolkit builds itself; `agent.team` needs a team and is covered in agent-team-modes. */
const COMPOSED = TOOL_PERMISSION_ROWS.filter((row) => row.category !== 'agents');

const EVERYTHING: readonly AgentToolCategory[] = [
  'read',
  'write',
  'command',
  'git',
  'git-write',
  'http',
  'http-write',
  'browser',
  'shell',
];

const VISION: VisionPort = {
  models: () => Promise.resolve([]),
  ask: () => Promise.reject(new Error('never reached: only authorize is called')),
};

function callOf(row: ToolPermissionRow): AgentToolCall {
  const base = { toolName: row.tool, operation: row.operation };
  if (row.tool === 'http.request') {
    const method = row.category === 'http-write' ? 'POST' : 'GET';
    return { ...base, arguments: { method, url: 'http://127.0.0.1:1/x' } };
  }
  if (row.tool === 'workspace.shell') return { ...base, arguments: { script: 'echo hi' } };
  if (row.tool === 'workspace.command') {
    return { ...base, arguments: { executable: 'node', arguments: ['-v'] } };
  }
  if (row.tool === 'process.watch') {
    return { ...base, arguments: { executable: 'node', arguments: ['-v'], id: 'p1' } };
  }
  if (row.tool === 'code.gates') return { ...base, arguments: { gate: 'lint' } };
  return { ...base, arguments: {} };
}

function toolkitFor(mode: AgentPermissionMode, approve: (() => boolean) | undefined) {
  return agentToolkit({
    auth: { token: 't' },
    workspaceRoot: process.cwd(),
    permissionMode: mode,
    permissions: {
      allow: EVERYTHING,
      httpAllowHosts: ['127.0.0.1'],
      shell: {},
      ...(approve === undefined ? {} : { approve }),
    },
    taskPlan: true,
    loadKnowledge: true,
    vision: { port: VISION },
  });
}

describe('the composed toolkit enforces the table (no network, no model)', () => {
  it('plan: every row the table denies is refused on arrival or absent, and nothing reaches an approver', async () => {
    const toolkit = toolkitFor('plan', undefined);
    const offered = JSON.stringify(toolkit.definitions);
    const wrong: string[] = [];
    for (const row of COMPOSED) {
      const allowed = (await toolkit.authorize?.(callOf(row))) === true;
      if (allowed !== (row.decisions.plan === 'allow')) wrong.push(`${row.tool}.${row.operation}`);
    }
    expect(wrong).toEqual([]);
    // The shell is listed so a refusal is answerable (offerRefused); the browser is not built at all.
    expect(offered).not.toContain('browser.page');
    toolkit.dispose?.();
  });

  it.each(['ask', 'accept-edits', 'autonomous-scoped', 'strict'] as const)(
    '%s: the approver is asked exactly where the table says, and a refusal denies',
    async (mode) => {
      const wrong: string[] = [];
      for (const row of COMPOSED) {
        for (const answer of [true, false]) {
          const approve = vi.fn(() => answer);
          const toolkit = toolkitFor(mode, approve);
          const allowed = (await toolkit.authorize?.(callOf(row))) === true;
          const decision = row.decisions[mode];
          const asked = approve.mock.calls.length > 0;
          const expectedAllowed = decision === 'allow' || (decision === 'ask' && answer);
          if (asked !== (decision === 'ask') || allowed !== expectedAllowed) {
            wrong.push(`${row.tool}.${row.operation} [${row.category}] answer=${String(answer)}`);
          }
          toolkit.dispose?.();
        }
      }
      expect(wrong).toEqual([]);
    },
  );

  it.each(['ask', 'accept-edits', 'autonomous-scoped', 'strict'] as const)(
    '%s with nobody to ask: what needs asking is denied, never run',
    async (mode) => {
      const toolkit = toolkitFor(mode, undefined);
      const wrong: string[] = [];
      for (const row of COMPOSED) {
        const allowed = (await toolkit.authorize?.(callOf(row))) === true;
        if (allowed !== (row.decisions[mode] === 'allow'))
          wrong.push(`${row.tool}.${row.operation}`);
      }
      expect(wrong).toEqual([]);
      toolkit.dispose?.();
    },
  );
});
