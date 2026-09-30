import { describe, expect, it } from 'vitest';

import {
  resolvePromptWorkspace,
  runnerToolDecision,
  splitModelReference,
} from '../../src/core/runner-prompt-policy';

const folders = [
  { name: 'Claw', fsPath: '/work/Claw' },
  { name: 'docs', fsPath: '/work/docs' },
];

describe('runnerToolDecision', () => {
  it('asks for every call under the ASK policy, reads included', () => {
    for (const category of ['read', 'git', 'write', 'command'] as const) {
      expect(runnerToolDecision({ category }, 'ASK')).toBe('ask');
    }
  });

  it('auto-approves only read-only calls under AUTO_APPROVE_READ_ONLY', () => {
    expect(runnerToolDecision({ category: 'read' }, 'AUTO_APPROVE_READ_ONLY')).toBe('auto');
    expect(runnerToolDecision({ category: 'git' }, 'AUTO_APPROVE_READ_ONLY')).toBe('auto');
  });

  it('never auto-approves a write or a command (R2+), whatever the policy', () => {
    expect(runnerToolDecision({ category: 'write' }, 'AUTO_APPROVE_READ_ONLY')).toBe('ask');
    expect(runnerToolDecision({ category: 'command' }, 'AUTO_APPROVE_READ_ONLY')).toBe('ask');
  });
});

describe('resolvePromptWorkspace', () => {
  it('uses the first folder when the job names no repository', () => {
    expect(resolvePromptWorkspace(folders, undefined)).toEqual(folders[0]);
    expect(resolvePromptWorkspace(folders, null)).toEqual(folders[0]);
    expect(resolvePromptWorkspace(folders, '  ')).toEqual(folders[0]);
  });

  it('matches a named repository case-insensitively', () => {
    expect(resolvePromptWorkspace(folders, 'DOCS')).toEqual(folders[1]);
  });

  it('never guesses: an unknown repository resolves to nothing', () => {
    expect(resolvePromptWorkspace(folders, 'other-repo')).toBeUndefined();
    expect(resolvePromptWorkspace([], undefined)).toBeUndefined();
  });
});

describe('splitModelReference', () => {
  it('splits PROVIDER/model and upper-cases the provider', () => {
    expect(splitModelReference('gemini/gemini-2.5-flash')).toEqual({
      provider: 'GEMINI',
      model: 'gemini-2.5-flash',
    });
  });

  it('keeps a bare model for the default provider, and nothing for blank', () => {
    expect(splitModelReference('kimi-k3')).toEqual({ provider: undefined, model: 'kimi-k3' });
    expect(splitModelReference('/x')).toEqual({ provider: undefined, model: '/x' });
    expect(splitModelReference(undefined)).toEqual({ provider: undefined, model: undefined });
  });
});
