import { describe, expect, it } from 'vitest';

import { composePrompt } from '../../src/core/prompt-composition';

describe('composePrompt', () => {
  it('sends an unstyled Auto prompt exactly as written', () => {
    expect(composePrompt({ agentMode: 'AUTO', stylePreamble: '', content: 'Fix it' })).toBe(
      'Fix it',
    );
  });

  it('puts the style in front of the request', () => {
    const composed = composePrompt({
      agentMode: 'AUTO',
      stylePreamble: 'Be brief.',
      content: 'Fix it',
    });

    expect(composed).toBe('Be brief.\n\nFix it');
  });

  it('lets the Plan constraint outrank the style that follows it', () => {
    const composed = composePrompt({
      agentMode: 'PLAN',
      stylePreamble: 'Be brief.',
      content: 'Fix it',
    });

    expect(composed.indexOf('read-only')).toBeLessThan(composed.indexOf('Be brief.'));
  });

  it('keeps the request itself last, whatever else is added', () => {
    const composed = composePrompt({
      agentMode: 'PLAN',
      stylePreamble: 'Be brief.',
      content: 'Fix it',
    });

    expect(composed.endsWith('Fix it')).toBe(true);
  });
});
