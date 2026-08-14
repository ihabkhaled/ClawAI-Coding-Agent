import { describe, expect, it } from 'vitest';

import { findStagedSecret } from '../../src/core/staged-secret-scan';

const added = (...lines: readonly string[]): string =>
  ['diff --git a/x b/x', '--- a/x', '+++ b/x', '@@ -0,0 +1 @@', ...lines].join('\n');

describe('findStagedSecret', () => {
  // Every line here appeared in the password-reset diff the previous scan
  // refused to commit. Each one is ordinary source text.
  it.each([
    ['a type annotation named like a token', '+  async sendPasswordReset(email: string, rawToken: string): Promise<void> {'],
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
    ['a private key block', '+-----BEGIN <fake-key-header-removed>-----'],
    ['an AWS access key', '+const key = "<fake-secret-removed>";'],
    ['a GitHub token', '+GITHUB_TOKEN=<fake-secret-removed>'],
    ['a Stripe live key', '+const stripe = "<fake-secret-removed>";'],
    ['a JWT', '+const jwt = "<fake-secret-removed>"'],
  ])('blocks %s', (_label, line) => {
    expect(findStagedSecret(added(line))).toBeDefined();
  });

  it('blocks a generated credential assigned to a credential name', () => {
    expect(findStagedSecret(added('+  password: "<fake-secret-removed>",'))).toBe('<fake-secret-removed>');
  });

  it('ignores a secret that is being removed', () => {
    // Deleting the line is the fix; blocking it strands the repository with
    // the secret still committed.
    const diff = ['--- a/x', '+++ b/x', '-const key = "<fake-secret-removed>";'].join('\n');
    expect(findStagedSecret(diff)).toBeUndefined();
  });

  it('does not read the +++ header as an added line', () => {
    expect(findStagedSecret(added('+++ b/password-reset-token-secret.ts'))).toBeUndefined();
  });

  it('keeps each line independent of the one before it', () => {
    // The assignment pattern is global; a shared instance carries lastIndex
    // between lines and silently skips matches.
    const diff = added(
      '+  password: "<fake-secret-removed>",',
      '+  password: "<fake-secret-removed>",',
    );
    expect(findStagedSecret(diff)).toBe('<fake-secret-removed>');
  });
});
