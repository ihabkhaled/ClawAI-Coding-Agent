import { describe, expect, it } from 'vitest';

import { describeSubAgentFailure } from '../../src/services/runtime-sub-agent-executor';

describe('describeSubAgentFailure', () => {
  it("surfaces the nested runtime's actual code and message", () => {
    const description = describeSubAgentFailure({
      reason: { code: 'PROVIDER_UNAVAILABLE', message: 'The Ollama provider timed out.' },
    });

    expect(description).toBe(
      'Nested runtime failed: The Ollama provider timed out. (PROVIDER_UNAVAILABLE)',
    );
  });

  it('falls back to the generic message when the event carries no reason', () => {
    expect(describeSubAgentFailure({})).toBe('Nested runtime failed');
  });

  it('falls back to the generic message when reason is not an object', () => {
    expect(describeSubAgentFailure({ reason: 'not an object' })).toBe('Nested runtime failed');
  });

  it('falls back to the generic message when reason has neither field populated', () => {
    expect(describeSubAgentFailure({ reason: { code: '', message: '' } })).toBe(
      'Nested runtime failed',
    );
  });

  it('reports the code alone when the message is empty', () => {
    expect(describeSubAgentFailure({ reason: { code: 'TIMEOUT', message: '' } })).toBe(
      'Nested runtime failed: TIMEOUT',
    );
  });

  it('reports the message alone when the code is empty', () => {
    expect(
      describeSubAgentFailure({
        reason: { code: '', message: 'Model provider rejected the request.' },
      }),
    ).toBe('Nested runtime failed: Model provider rejected the request.');
  });
});
