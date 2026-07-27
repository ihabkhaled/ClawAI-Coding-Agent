import { describe, expect, it } from 'vitest';

import { redactText, redactValue } from '../../src/core/redaction';

describe('redaction', () => {
  it('redacts nested secret-bearing keys without mutating the input', () => {
    const input = {
      email: 'dev@example.com',
      nested: {
        accessToken: 'access-secret',
        password: 'password-secret',
      },
    };

    expect(redactValue(input)).toEqual({
      email: 'dev@example.com',
      nested: {
        accessToken: '[REDACTED]',
        password: '[REDACTED]',
      },
    });
    expect(input.nested.accessToken).toBe('access-secret');
  });

  it('redacts bearer tokens and sensitive query parameters in diagnostic text', () => {
    expect(
      redactText('Authorization: Bearer abc.def.ghi https://claw.example?token=my-token&mode=AUTO'),
    ).toBe('Authorization: Bearer [REDACTED] https://claw.example?token=[REDACTED]&mode=AUTO');
  });

  it('handles arrays, circular data, primitive values, and assignment syntax', () => {
    const circular: Record<string, unknown> = {};
    circular.self = circular;
    const repeated: unknown[] = [];
    repeated.push(repeated);

    expect(redactValue({ circular, repeated, count: 3, empty: null })).toEqual({
      circular: { self: { circular: '[REDACTED]' } },
      repeated: [['[REDACTED]']],
      count: 3,
      empty: null,
    });
    expect(redactText('password=hunter2 cookie:session-id')).toBe(
      'password=[REDACTED] cookie:[REDACTED]',
    );
  });
});
