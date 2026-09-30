import { describe, expect, it } from 'vitest';

import { decidePermission } from '../../src/core/permission-policy';
import { classifyRemoteCommand, parseRemoteCommand } from '../../src/core/remote-command-policy';
import {
  REMOTE_COMMAND_MAX_ARGUMENTS,
  REMOTE_COMMAND_MAX_LENGTH,
} from '../../src/core/remote-command-policy.constants';

import type {
  PermissionInput,
  PermissionMode,
  PermissionOperation,
} from '../../src/core/permission-policy.types';

/**
 * Written from a hand-mutation pass: each case pins a branch that flipping a
 * condition, dropping an allowlist entry or removing a guard left green.
 */
describe('remote command classification: writes and escapes are never R1', () => {
  it.each(['-o', '-d', '-D', '--delete', '--set-url', 'add', 'remove', 'rename'])(
    'treats the bare write flag %s as R2 on an otherwise read-only call',
    (flag) => {
      expect(classifyRemoteCommand('git', ['log', flag])).toBe('R2');
    },
  );

  it.each([
    '--output=x',
    '--no-index',
    '--ext-diff',
    '--textconv',
    '--exec=x',
    '--config=core.pager=x',
    '--upload-pack=x',
    '--receive-pack=x',
  ])('treats the unsafe flag prefix %s as R2', (flag) => {
    expect(classifyRemoteCommand('git', ['diff', flag])).toBe('R2');
  });

  it.each([
    '/etc/passwd',
    '~/secrets',
    'C:\\Users\\me',
    '\\\\server\\share',
    '../outside',
    'a/../../b',
    'a\\..\\b',
    '--file=/etc/passwd',
    '--file=../up',
  ])('treats an argument that leaves the workspace (%s) as R2', (argument) => {
    expect(classifyRemoteCommand('git', ['log', argument])).toBe('R2');
  });

  it('keeps ordinary relative arguments and dotted names read-only', () => {
    expect(classifyRemoteCommand('git', ['log', 'src/a.ts', '--format=%h'])).toBe('R1');
    expect(classifyRemoteCommand('git', ['log', 'v1..v2'])).toBe('R1');
  });

  it('rejects an extra argument after an allowed listing flag', () => {
    expect(classifyRemoteCommand('git', ['branch', '-a'])).toBe('R1');
    expect(classifyRemoteCommand('git', ['branch', '-a', 'new-branch'])).toBe('R2');
    expect(classifyRemoteCommand('git', ['remote', '-v', 'origin'])).toBe('R2');
  });

  it.each([
    ['git', ['branch', 'x']],
    ['git', ['remote', 'set-url']],
    ['git', ['config', 'user.name']],
    ['git', ['push']],
    ['git', []],
    ['node', ['-e', '1']],
    ['npm', ['install']],
    ['cat', ['file']],
    ['rm', ['file']],
    ['constructor', []],
    ['toString', []],
  ] as const)('never lets %s %j run without the person', (executable, args) => {
    expect(classifyRemoteCommand(executable, args)).toBe('R2');
  });

  it('matches the program name case-insensitively but still applies every check', () => {
    expect(classifyRemoteCommand('GIT', ['status'])).toBe('R1');
    expect(classifyRemoteCommand('GIT', ['log', '-o'])).toBe('R2');
  });
});

describe('remote command parsing bounds', () => {
  it.each(['<', '>', '$', '(', ')', '{', '}', '`', '|', '&', ';', '\n', '\r'])(
    'refuses the shell operator %j',
    (operator) => {
      const parsed = parseRemoteCommand(`echo a${operator}b`);
      expect(parsed.kind).toBe('refused');
      expect(parsed).toMatchObject({ reason: expect.stringContaining('without a shell') });
    },
  );

  it('refuses empty and whitespace-only commands for the right reason', () => {
    expect(parseRemoteCommand('')).toEqual({ kind: 'refused', reason: 'The command is empty.' });
    expect(parseRemoteCommand(' \t ')).toEqual({
      kind: 'refused',
      reason: 'The command is empty.',
    });
  });

  it('measures length after trimming and refuses exactly one byte over the limit', () => {
    const atLimit = 'a'.repeat(REMOTE_COMMAND_MAX_LENGTH);
    expect(parseRemoteCommand(`  ${atLimit}  `)).toMatchObject({ kind: 'ok' });
    expect(parseRemoteCommand(`${atLimit}a`)).toEqual({
      kind: 'refused',
      reason: 'The command is too long.',
    });
  });

  it('allows exactly the maximum argument count and refuses one more', () => {
    const args = (count: number): string => `x${' a'.repeat(count)}`;
    expect(parseRemoteCommand(args(REMOTE_COMMAND_MAX_ARGUMENTS))).toMatchObject({ kind: 'ok' });
    expect(parseRemoteCommand(args(REMOTE_COMMAND_MAX_ARGUMENTS + 1))).toEqual({
      kind: 'refused',
      reason: 'The command has too many arguments.',
    });
  });

  it('refuses an unmatched quote of either kind', () => {
    expect(parseRemoteCommand('echo "a')).toEqual({
      kind: 'refused',
      reason: 'The command has an unmatched quote.',
    });
    expect(parseRemoteCommand("echo 'a")).toMatchObject({ kind: 'refused' });
  });
});

const base: PermissionInput = {
  agentMode: 'AUTO',
  operation: 'editGeneration',
  permissionMode: 'ASK',
  sensitive: false,
  trusted: true,
};

const decide = (overrides: Partial<PermissionInput>) => decidePermission({ ...base, ...overrides });

describe('permission policy: the guards that flipping a condition would remove', () => {
  it('still reads workspace context in an untrusted workspace, and nothing else', () => {
    expect(decide({ trusted: false, operation: 'workspaceContext' })).toEqual({
      outcome: 'ask',
      reason: 'manualApproval',
    });
    for (const operation of [
      'editGeneration',
      'commandExecution',
      'finalDiff',
      'externalFinalDiff',
    ] as const) {
      expect(decide({ trusted: false, operation })).toEqual({
        outcome: 'deny',
        reason: 'workspaceUntrusted',
      });
    }
  });

  it.each(['AUTONOMOUS_SCOPED', 'BYPASS_PERMISSIONS', 'AUTO_EDIT'] as const)(
    'Plan agent mode denies commands and edits even in %s',
    (permissionMode) => {
      for (const operation of ['commandExecution', 'editGeneration'] as const) {
        expect(decide({ agentMode: 'PLAN', operation, permissionMode })).toEqual({
          outcome: 'deny',
          reason: 'planReadOnly',
        });
      }
    },
  );

  it('Plan agent mode leaves read-only context alone', () => {
    expect(
      decide({ agentMode: 'PLAN', operation: 'workspaceContext', permissionMode: 'ASK' }),
    ).toEqual({ outcome: 'ask', reason: 'manualApproval' });
  });

  it('a locked enterprise install always asks, for every operation that reaches the mode check', () => {
    for (const operation of ['editGeneration', 'workspaceContext'] as const) {
      expect(decide({ permissionMode: 'ENTERPRISE_LOCKED', operation })).toEqual({
        outcome: 'ask',
        reason: 'strictApproval',
      });
    }
  });

  it('the Plan permission mode denies writes rather than falling through to scoped access, and reads context', () => {
    for (const operation of ['editGeneration', 'commandExecution'] as const) {
      expect(decide({ permissionMode: 'PLAN', operation })).toEqual({
        outcome: 'deny',
        reason: 'planReadOnly',
      });
    }
    expect(decide({ permissionMode: 'PLAN', operation: 'workspaceContext' })).toEqual({
      outcome: 'allow',
      reason: 'planReadContext',
    });
  });

  it('a command is never pre-approved by any permission mode', () => {
    const modes: PermissionMode[] = [
      'PLAN',
      'ASK',
      'AUTO_EDIT',
      'AUTONOMOUS_SCOPED',
      'ENTERPRISE_LOCKED',
      'BYPASS_PERMISSIONS',
      'EDIT_AUTOMATICALLY',
      'MANUAL',
    ];
    const operation: PermissionOperation = 'commandExecution';
    for (const permissionMode of modes) {
      const decision = decide({ permissionMode, operation });
      expect(decision.outcome === 'allow', `${permissionMode} allowed a command`).toBe(false);
    }
  });

  it('a sensitive path is denied first, in every mode, with its own reason', () => {
    for (const permissionMode of ['AUTONOMOUS_SCOPED', 'BYPASS_PERMISSIONS', 'ASK'] as const) {
      expect(decide({ sensitive: true, trusted: false, permissionMode })).toEqual({
        outcome: 'deny',
        reason: 'sensitivePath',
      });
    }
  });

  it('final diffs are pre-approved only under full access, and ask with their own reason otherwise', () => {
    expect(decide({ operation: 'finalDiff', permissionMode: 'BYPASS_PERMISSIONS' })).toEqual({
      outcome: 'allow',
      reason: 'scopedAccess',
    });
    for (const permissionMode of ['ASK', 'AUTO_EDIT', 'MANUAL', 'EDIT_AUTOMATICALLY'] as const) {
      expect(decide({ operation: 'finalDiff', permissionMode })).toEqual({
        outcome: 'ask',
        reason: 'finalDiffRequired',
      });
    }
  });
});
