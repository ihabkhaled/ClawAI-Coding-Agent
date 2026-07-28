import { describe, expect, it } from 'vitest';

import {
  createVscodeAuthorizationRequest,
  parseVscodeAuthorizationCallback,
} from '../../src/core/vscode-authorization';

describe('VS Code browser authorization', () => {
  it('creates independent PKCE requests with URL-safe state and challenge values', () => {
    const first = createVscodeAuthorizationRequest();
    const second = createVscodeAuthorizationRequest();

    expect(first).not.toEqual(second);
    expect(first.codeVerifier).toMatch(/^[A-Za-z0-9_-]{43,128}$/u);
    expect(first.codeChallenge).toMatch(/^[A-Za-z0-9_-]{43}$/u);
    expect(first.state).toMatch(/^[A-Za-z0-9_-]{32,256}$/u);
  });

  it('accepts only callbacks containing a code and matching-state candidate', () => {
    expect(
      parseVscodeAuthorizationCallback(
        new URL('vscode://clawai.clawai-coding-agent/auth/callback?code=code-1&state=state-1'),
      ),
    ).toEqual({ code: 'code-1', state: 'state-1' });

    expect(() =>
      parseVscodeAuthorizationCallback(
        new URL('vscode://clawai.clawai-coding-agent/auth/callback?state=state-1'),
      ),
    ).toThrow('incomplete');
  });
});
