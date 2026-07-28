import { createHash, randomBytes } from 'node:crypto';

export interface VscodeAuthorizationRequest {
  codeChallenge: string;
  codeVerifier: string;
  state: string;
}

export interface VscodeAuthorizationCallback {
  code: string;
  state: string;
}

export function createVscodeAuthorizationRequest(): VscodeAuthorizationRequest {
  const codeVerifier = randomBytes(48).toString('base64url');
  return {
    codeChallenge: createHash('sha256').update(codeVerifier, 'utf8').digest('base64url'),
    codeVerifier,
    state: randomBytes(32).toString('base64url'),
  };
}

export function parseVscodeAuthorizationCallback(uri: URL): VscodeAuthorizationCallback {
  const code = uri.searchParams.get('code');
  const state = uri.searchParams.get('state');
  if (code === null || state === null) {
    throw new Error('ClawAI authorization returned an incomplete response.');
  }
  return { code, state };
}
