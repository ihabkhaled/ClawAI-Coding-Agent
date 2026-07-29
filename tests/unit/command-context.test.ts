import { describe, expect, it } from 'vitest';

import { contextModeForCommand } from '../../src/core/command-context';

describe('contextModeForCommand', () => {
  it('uses workspace context for coding and parallel workflows without an active editor', () => {
    expect(contextModeForCommand('clawAI.generateCode')).toBe('workspace');
    expect(contextModeForCommand('clawAI.generateTests')).toBe('workspace');
    expect(contextModeForCommand('clawAI.compareModels')).toBe('workspace');
    expect(contextModeForCommand('clawAI.judgeResponses')).toBe('workspace');
  });

  it('preserves explicit selection, file, and workspace command semantics', () => {
    expect(contextModeForCommand('clawAI.fixCode')).toBe('selection');
    expect(contextModeForCommand('clawAI.askFile')).toBe('file');
    expect(contextModeForCommand('clawAI.auditWorkspace')).toBe('workspace');
  });
});
