import { describe, expect, it } from 'vitest';

import { needsApproval, permissionsForMode } from '../../src/sdk/permission-modes';

import type { AgentPermissionMode } from '../../src/sdk/permission-modes.types';

const request = (operation: string) => ({
  toolName: 'agent.team',
  operation,
  arguments: {},
  category: 'agents' as const,
});

describe('agent.team under each permission mode', () => {
  it.each([
    ['ask', 'spawn', true],
    ['strict', 'spawn', true],
    ['accept-edits', 'spawn', false],
    ['autonomous-scoped', 'spawn', false],
    ['ask', 'wait', false],
    ['ask', 'message', false],
    ['strict', 'cancel', false],
  ] as const)('%s %s needs approval: %s', (mode, operation, expected) => {
    expect(needsApproval(mode as AgentPermissionMode, request(operation))).toBe(expected);
  });

  it('with no approver, a spawn that needs approval is denied and one that does not is allowed', async () => {
    const strict = permissionsForMode('strict', { allow: ['read', 'agents'] });
    expect(await strict.approve?.(request('spawn'))).toBe(false);
    expect(await strict.approve?.(request('wait'))).toBe(true);
    const accept = permissionsForMode('accept-edits', { allow: ['read', 'agents'] });
    expect(await accept.approve?.(request('spawn'))).toBe(true);
  });

  it('plan mode drops the agents grant', () => {
    expect(permissionsForMode('plan', { allow: ['read', 'write', 'agents'] }).allow).toEqual([
      'read',
    ]);
  });
});
