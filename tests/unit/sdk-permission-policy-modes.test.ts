import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';

import { describe, expect, it, vi } from 'vitest';

import { containedPath } from '../../src/core/workspace-containment';
import { permissionsForMode } from '../../src/sdk/permission-modes';

import type { AgentApprovalRequest } from '../../src/sdk/workspace-toolkit.types';

const call = (
  category: AgentApprovalRequest['category'],
  toolName: string,
  operation: string,
): AgentApprovalRequest => ({ category, toolName, operation, arguments: {} });

const read = call('read', 'workspace.file', 'read');
const gitRead = call('git', 'workspace.git', 'status');
const update = call('write', 'workspace.file', 'update');
const remove = call('write', 'workspace.file', 'delete');
const run = call('command', 'workspace.command', 'run');
const commit = call('git-write', 'workspace.git', 'commit');
const push = call('git-write', 'workspace.git', 'push');
const fetchRemote = call('git-write', 'workspace.git', 'fetch');
const mcp = call('mcp', 'mcp__docs__search', 'call');

/** What the mode did with one call: ran it, asked first, or refused without asking. */
async function outcomeOf(
  mode: Parameters<typeof permissionsForMode>[0],
  request: AgentApprovalRequest,
): Promise<'allowed' | 'asked' | 'refused'> {
  const asked = vi.fn(() => true);
  const permissions = permissionsForMode(mode, {
    allow: ['read', 'write', 'command', 'git', 'git-write', 'mcp'],
    approve: asked,
  });
  const allowed = await permissions.approve?.(request);
  if (asked.mock.calls.length > 0) return 'asked';
  return allowed === true ? 'allowed' : 'refused';
}

describe('autonomous-scoped', () => {
  it('runs edits and commands without asking, as the editor does', async () => {
    expect(await outcomeOf('autonomous-scoped', update)).toBe('allowed');
    expect(await outcomeOf('autonomous-scoped', run)).toBe('allowed');
    expect(await outcomeOf('autonomous-scoped', fetchRemote)).toBe('allowed');
    expect(await outcomeOf('autonomous-scoped', read)).toBe('allowed');
    expect(await outcomeOf('autonomous-scoped', gitRead)).toBe('allowed');
  });

  it('still asks for what cannot be undone or leaves the machine', async () => {
    expect(await outcomeOf('autonomous-scoped', remove)).toBe('asked');
    expect(await outcomeOf('autonomous-scoped', commit)).toBe('asked');
    expect(await outcomeOf('autonomous-scoped', push)).toBe('asked');
    expect(await outcomeOf('autonomous-scoped', mcp)).toBe('asked');
  });

  it('never asks about a path: a write outside the workspace is refused by containment, not offered for approval', async () => {
    const workspace = mkdtempSync(path.join(tmpdir(), 'scoped-'));
    const outside = call('write', 'workspace.file', 'create');

    expect(await outcomeOf('autonomous-scoped', outside)).toBe('allowed');
    expect(() => containedPath(workspace, '../outside.txt')).toThrow(/escapes the workspace/u);
    expect(containedPath(workspace, 'src/ok.txt')).toContain('ok.txt');
  });

  it('denies what needs asking when nobody can be asked', async () => {
    const permissions = permissionsForMode('autonomous-scoped', {
      allow: ['write', 'git-write'],
    });

    expect(await permissions.approve?.(commit)).toBe(false);
    expect(await permissions.approve?.(update)).toBe(true);
  });
});

describe('strict', () => {
  it('asks for every write, command, git change and MCP call, like ask', async () => {
    for (const request of [update, run, commit, push, fetchRemote, mcp]) {
      expect(await outcomeOf('strict', request)).toBe('asked');
    }
  });

  it('refuses a delete without asking, which ask does not', async () => {
    expect(await outcomeOf('strict', remove)).toBe('refused');
    expect(await outcomeOf('ask', remove)).toBe('asked');
  });

  it('does not ask about reading', async () => {
    expect(await outcomeOf('strict', read)).toBe('allowed');
    expect(await outcomeOf('strict', gitRead)).toBe('allowed');
  });
});

describe('the other three modes keep their meaning', () => {
  it('plan offers reading only', () => {
    const permissions = permissionsForMode('plan', { allow: ['read', 'write', 'command', 'git'] });

    expect(permissions.allow).toEqual(['read', 'git']);
  });

  it('ask asks for edits and accept-edits does not', async () => {
    expect(await outcomeOf('ask', update)).toBe('asked');
    expect(await outcomeOf('accept-edits', update)).toBe('allowed');
    expect(await outcomeOf('accept-edits', run)).toBe('asked');
  });
});
