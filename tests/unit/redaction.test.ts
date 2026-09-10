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

describe('redactText environment-variable shapes', () => {
  it('redacts a token whose name is prefixed, which is how shells write them', () => {
    const redacted = redactText('GITHUB_TOKEN=ghp_abcdefghijklmnopqrstuvwxyz0123456789');

    expect(redacted).not.toContain('ghp_abcdefghijklmnopqrstuvwxyz0123456789');
  });

  it('redacts a prefixed secret and key too', () => {
    expect(redactText('AWS_SECRET_ACCESS_KEY=wJalrXUtnFEMI')).not.toContain('wJalrXUtnFEMI');
    expect(redactText('MY_API_KEY=abc123def456')).not.toContain('abc123def456');
  });

  it('keeps the variable name, so the reader knows what was hidden', () => {
    expect(redactText('GITHUB_TOKEN=ghp_secretvalue123456')).toContain('GITHUB_TOKEN');
  });

  it('leaves an ordinary underscore word alone', () => {
    expect(redactText('BUILD_NUMBER=1234')).toContain('1234');
  });
});

describe('redactText precision', () => {
  it('does not redact a word that merely starts with a keyword', () => {
    expect(redactText('SECRETARY_NAME=Alice')).toContain('Alice');
  });
});
