import { describe, expect, it } from 'vitest';

import { redactText, redactValue } from '../../src/core/redaction';

/** Each case pins a rule that dropping its pattern or key left the suite green. */
describe('redactText: every secret shape is covered by its own rule', () => {
  it('redacts a Bearer token in any case', () => {
    expect(redactText('Authorization header was Bearer abc.def-ghi')).not.toContain('abc.def');
    expect(redactText('bearer abc.def')).toBe('bearer [REDACTED]');
    expect(redactText('BEARER abc.def')).toBe('BEARER [REDACTED]');
  });

  it.each(['Basic', 'Digest', 'Token'])(
    'redacts an Authorization %s credential and keeps the scheme',
    (scheme) => {
      expect(redactText(`Authorization: ${scheme} dXNlcjpwdw==`)).toBe(
        `Authorization: ${scheme} [REDACTED]`,
      );
    },
  );

  it('redacts URL userinfo but keeps scheme and host', () => {
    expect(redactText('clone https://user:pw@github.com/a/b.git')).toBe(
      'clone https://[REDACTED]@github.com/a/b.git',
    );
    expect(redactText('git+ssh://TOKEN123@host/x')).toBe('git+ssh://[REDACTED]@host/x');
    expect(redactText('https://github.com/a/b')).toBe('https://github.com/a/b');
  });

  it.each([
    'key',
    'apikey',
    'api_key',
    'access_token',
    'refresh_token',
    'token',
    'secret',
    'password',
  ])('redacts the %s query parameter and only its value', (name) => {
    expect(redactText(`https://x.test/p?a=1&${name}=hunter2&b=2`)).toBe(
      `https://x.test/p?a=1&${name}=[REDACTED]&b=2`,
    );
    expect(redactText(`https://x.test/p?${name}=hunter2`)).toBe(
      `https://x.test/p?${name}=[REDACTED]`,
    );
  });

  it('redacts shell-style assignments, including underscore-joined names', () => {
    expect(redactText('GITHUB_TOKEN=ghp_abc123')).toBe('GITHUB_TOKEN=[REDACTED]');
    expect(redactText('AWS_SECRET_ACCESS_KEY=abc/def')).toBe('AWS_SECRET_ACCESS_KEY=[REDACTED]');
    expect(redactText('{"password": "hunter2"}')).toContain('[REDACTED]');
    expect(redactText('{"password": "hunter2"}')).not.toContain('hunter2');
    expect(redactText('password: hunter2')).toBe('password: [REDACTED]');
  });

  it('leaves a name that merely starts with a keyword alone', () => {
    expect(redactText('SECRETARY_NAME=Alice')).toBe('SECRETARY_NAME=Alice');
  });

  it('redacts several different secrets in one string', () => {
    const text = 'curl -H "Authorization: Basic Zm9v" "https://u:p@h/x?key=k1" TOKEN_X=t2';
    const redacted = redactText(text);
    for (const leaked of ['Zm9v', 'u:p@', 'k1', 't2']) expect(redacted).not.toContain(leaked);
  });
});

describe('redactValue: structure', () => {
  it.each([
    'token',
    'sessionToken',
    'accessToken',
    'refresh_token',
    'Authorization',
    'cookie',
    'Password',
    'passphrase',
    'clientSecret',
    'apiKey',
    'api-key',
    'credential',
  ])('redacts the value under the key %s whatever it contains', (key) => {
    expect(redactValue({ [key]: 'plain' })).toEqual({ [key]: '[REDACTED]' });
  });

  it('keeps non-sensitive keys and non-string leaves as they are', () => {
    expect(redactValue({ name: 'a', count: 3, ok: true, none: null })).toEqual({
      name: 'a',
      count: 3,
      ok: true,
      none: null,
    });
  });

  it('redacts secrets inside strings nested in objects and arrays', () => {
    expect(redactValue({ note: 'Bearer abc123' })).toEqual({ note: 'Bearer [REDACTED]' });
    expect(redactValue(['Bearer abc123', { deep: ['https://u:p@h/'] }])).toEqual([
      'Bearer [REDACTED]',
      { deep: ['https://[REDACTED]@h/'] },
    ]);
  });

  it('survives cycles in objects and arrays without recursing forever', () => {
    const object: { a: number; self?: unknown } = { a: 1 };
    object.self = object;
    expect(redactValue(object)).toEqual({ a: 1, self: { circular: '[REDACTED]' } });
    const array: unknown[] = [1];
    array.push(array);
    expect(redactValue(array)).toEqual([1, ['[REDACTED]']]);
  });

  it('does not change its input', () => {
    const input = { token: 'x', list: ['Bearer y'] };
    redactValue(input);
    expect(input).toEqual({ token: 'x', list: ['Bearer y'] });
  });
});
