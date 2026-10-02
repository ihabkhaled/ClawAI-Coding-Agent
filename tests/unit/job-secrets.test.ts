import { describe, expect, it } from 'vitest';

import {
  jobSecretEnvironment,
  redactJobSecrets,
  redactJobSecretsDeep,
} from '../../src/core/job-secrets';

const VALUE = 'zq-routine-value-7731';

describe('jobSecretEnvironment', () => {
  it('maps valid entries to an environment record', () => {
    expect(jobSecretEnvironment([{ name: 'DEPLOY_KEY', value: VALUE }])).toEqual({
      DEPLOY_KEY: VALUE,
    });
  });

  it('is empty for an older server that sends nothing', () => {
    expect(jobSecretEnvironment(undefined)).toEqual({});
    expect(jobSecretEnvironment([])).toEqual({});
  });

  it.each([
    'PATH',
    'NODE_OPTIONS',
    'BASH_ENV',
    'CLAW_TOKEN',
    'LD_PRELOAD',
    'DYLD_X',
    'lower',
    '1A',
  ])('drops the name %s that could change how code loads or is not an environment name', (name) => {
    expect(jobSecretEnvironment([{ name, value: VALUE }])).toEqual({});
  });

  it('drops a NUL, an empty value and an oversized value', () => {
    expect(
      jobSecretEnvironment([
        { name: 'A_ONE', value: 'x\u0000y' },
        { name: 'A_TWO', value: '' },
        { name: 'A_THREE', value: 'x'.repeat(8_193) },
        { name: 'A_FOUR', value: 'ok-value' },
      ]),
    ).toEqual({ A_FOUR: 'ok-value' });
  });

  it('keeps at most 20', () => {
    const many = Array.from({ length: 30 }, (_, index) => ({
      name: `S_${String(index)}`,
      value: `value-${String(index)}`,
    }));
    expect(Object.keys(jobSecretEnvironment(many))).toHaveLength(20);
  });
});

describe('redactJobSecrets', () => {
  const environment = { DEPLOY_KEY: VALUE };

  it('replaces every occurrence of the value', () => {
    expect(redactJobSecrets(`a ${VALUE} b ${VALUE}`, environment)).toBe(
      'a [REDACTED] b [REDACTED]',
    );
  });

  it('replaces its base64 and URL-encoded forms', () => {
    const odd = { K: 'p@ss w0rd/value' };
    const base64 = Buffer.from(odd.K).toString('base64');
    const text = `${base64} ${encodeURIComponent(odd.K)}`;
    expect(redactJobSecrets(text, odd)).toBe('[REDACTED] [REDACTED]');
  });

  it('redacts the longer secret first so a prefix secret cannot leave a tail', () => {
    const both = { SHORT: 'abcd', LONG: 'abcdWXYZ' };
    expect(redactJobSecrets('abcdWXYZ', both)).toBe('[REDACTED]');
  });

  it('does not scrub a value under 4 characters, which would mangle ordinary text', () => {
    expect(redactJobSecrets('yes yes', { K: 'yes' })).toBe('yes yes');
  });

  it('walks nested tool results and leaves non-strings alone', () => {
    const result = redactJobSecretsDeep(
      { stdout: VALUE, nested: [{ line: `x${VALUE}` }], exitCode: 0, flag: true },
      environment,
    );
    expect(result).toEqual({
      stdout: '[REDACTED]',
      nested: [{ line: 'x[REDACTED]' }],
      exitCode: 0,
      flag: true,
    });
  });
});
