import { describe, expect, it } from 'vitest';

import { applyAgentModeToPrompt } from '../../src/core/agent-mode';

describe('agent mode', () => {
  it('leaves prompts unchanged in Auto mode', () => {
    expect(applyAgentModeToPrompt('AUTO', 'Fix the failing test')).toBe('Fix the failing test');
  });

  it('turns Plan mode requests into explicit read-only planning requests', () => {
    const prompt = applyAgentModeToPrompt('PLAN', 'Fix the failing test');

    expect(prompt).toContain('read-only');
    expect(prompt).toContain('implementation plan');
    expect(prompt).toContain('Fix the failing test');
  });
});
