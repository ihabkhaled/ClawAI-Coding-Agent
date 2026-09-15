import { describe, expect, it } from 'vitest';

import { applyAgentModeToPrompt, resumeAgentMode } from '../../src/core/agent-mode';

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

describe('resumeAgentMode', () => {
  it('keeps a planning run planning when the workspace has moved to Auto', () => {
    expect(resumeAgentMode('PLAN', 'AUTO')).toBe('PLAN');
  });

  it('keeps a resumed run read-only when the workspace has moved to Plan', () => {
    expect(resumeAgentMode('AUTO', 'PLAN')).toBe('PLAN');
  });

  it('resumes an Auto run in Auto when nothing has tightened', () => {
    expect(resumeAgentMode('AUTO', 'AUTO')).toBe('AUTO');
  });

  it('defers to the current setting for a journal that recorded no mode', () => {
    expect(resumeAgentMode(undefined, 'AUTO')).toBe('AUTO');
    expect(resumeAgentMode(undefined, 'PLAN')).toBe('PLAN');
  });
});
