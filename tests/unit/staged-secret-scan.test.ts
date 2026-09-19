import { describe, expect, it } from 'vitest';

import { findStagedSecret } from '../../src/core/staged-secret-scan';

const added = (...lines: readonly string[]): string =>
  ['diff --git a/x b/x', '--- a/x', '+++ b/x', '@@ -0,0 +1 @@', ...lines].join('\n');

describe('findStagedSecret', () => {
  // Every line here appeared in the password-reset diff the previous scan
  // refused to commit. Each one is ordinary source text.
  it.each([
    [
      'a type annotation named like a token',
      '+  async sendPasswordReset(email: string, rawToken: string): Promise<void> {',
    ],
    ['a route constant', "+  FORGOT_PASSWORD: '/forgot-password',"],
    ['a test fixture', "+    const token = 'reset-token-abc';"],
    ['another test fixture', "+    const token = 'secret-token-xyz';"],
    ['an interpolated value', '+      `Reset your password: ${url.toString()}`,'],
    ['a value read from elsewhere', '+    const token = request.headers.authorization;'],
    ['a screaming-snake reference', '+    const secret = PASSWORD_RESET_TOKEN_SECRET;'],
  ])('allows %s', (_label, line) => {
    expect(findStagedSecret(added(line))).toBeUndefined();
  });

  it.each([
    ['a private key block', '+-----BEGIN RSA PRIVATE KEY-----'],
    ['an AWS access key', '+const key = "AKIAIOSFODNN7HXQMPLE";'],
    ['a GitHub token', '+GITHUB_TOKEN=ghp_A1b2C3d4E5f6G7h8I9j0K1l2M3n4O5p6Q7r8'],
    ['a Stripe live key', '+const stripe = "sk_live_51H8xKlMnOpQrStUvWxYz";'],
    [
      'a JWT',
      '+const jwt = "eyJhbGciOiJIUzI1NiJ9.eyJzdWIiOiIxMjM0NTY3ODkwIn0.dBjftJeZ4CVPmB92K27uhbUJU1p1r"',
    ],
  ])('blocks %s', (_label, line) => {
    expect(findStagedSecret(added(line))).toBeDefined();
  });

  it('blocks a generated credential assigned to a credential name', () => {
    expect(findStagedSecret(added('+  password: "aB3xK9pQ7mZ2wL5vR8tD",'))).toBe(
      'aB3xK9pQ7mZ2wL5vR8tD',
    );
  });

  it('ignores a secret that is being removed', () => {
    // Deleting the line is the fix; blocking it strands the repository with
    // the secret still committed.
    const diff = ['--- a/x', '+++ b/x', '-const key = "AKIAIOSFODNN7HXQMPLE";'].join('\n');
    expect(findStagedSecret(diff)).toBeUndefined();
  });

  it('does not read the +++ header as an added line', () => {
    expect(findStagedSecret(added('+++ b/password-reset-token-secret.ts'))).toBeUndefined();
  });

  it('keeps each line independent of the one before it', () => {
    // The assignment pattern is global; a shared instance carries lastIndex
    // between lines and silently skips matches.
    const diff = added(
      '+  password: "aB3xK9pQ7mZ2wL5vR8tD",',
      '+  password: "zQ7mW2nX9kV4bT6yH3jL",',
    );
    expect(findStagedSecret(diff)).toBe('aB3xK9pQ7mZ2wL5vR8tD');
  });
});

/**
 * Model-provider keys, which the scan did not recognise at all.
 *
 * Found by the extension-host lane committing one. Built at runtime rather
 * than written out: a key-shaped literal in this file would trip the secret
 * scanners that guard the repository itself, including this one.
 */
describe('findStagedSecret — model provider keys', () => {
  const body = 'A1b2C3d4E5f6G7h8I9j0K1l2M3n4O5p6Q7r8S9t0U1v2W3x4';

  it.each([
    ['a legacy OpenAI key', `sk-${body}`],
    ['an OpenAI project key', `sk-proj-${body}`],
    ['an Anthropic key', `sk-ant-api03-${body}`],
  ])('refuses %s assigned to a name the assignment list does not know', (_label, key) => {
    expect(findStagedSecret(added(`+const KEY = "${key}";`))).toBe(key);
  });

  it('refuses a model key that is not assigned to anything', () => {
    // The format is the evidence. A key pasted into a comment leaks the same.
    const key = `sk-ant-api03-${body}`;

    expect(findStagedSecret(added(`+// debug with ${key}`))).toBe(key);
  });

  it.each([
    ['a short sk- identifier', '+const sk-button = 1;'],
    ['a CSS-like class name', '+  class="sk-spinner sk-fading-circle"'],
    ['a kebab-case key under forty characters', '+const id = "sk-settings-panel-toggle";'],
  ])('allows %s', (_label, line) => {
    expect(findStagedSecret(added(line))).toBeUndefined();
  });
});
