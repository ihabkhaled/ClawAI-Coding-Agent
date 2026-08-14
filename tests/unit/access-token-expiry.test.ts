import { Buffer } from 'node:buffer';

import { describe, expect, it } from 'vitest';

import { accessTokenExpiresAt, accessTokenNeedsRefresh } from '../../src/core/access-token-expiry';
import { ACCESS_TOKEN_REFRESH_SKEW_MS } from '../../src/core/access-token-expiry.constants';

function encodeSegment(value: unknown): string {
  return Buffer.from(JSON.stringify(value), 'utf8').toString('base64url');
}

function signedLikeToken(claims: unknown): string {
  return `${encodeSegment({ alg: 'HS256', typ: 'JWT' })}.${encodeSegment(claims)}.signature`;
}

describe('accessTokenExpiresAt', () => {
  it('reads the absolute expiry the backend guard enforces', () => {
    const token = signedLikeToken({ exp: 1_800_000_000, sub: 'user-1' });

    expect(accessTokenExpiresAt(token)).toBe(1_800_000_000_000);
  });

  it('refuses to guess an expiry for anything that is not a JWT', () => {
    expect(accessTokenExpiresAt('opaque-access-token')).toBeNull();
    expect(accessTokenExpiresAt('header.payload')).toBeNull();
    expect(accessTokenExpiresAt('header..signature')).toBeNull();
  });

  it('refuses to guess an expiry for an unreadable or claimless payload', () => {
    expect(accessTokenExpiresAt('header.not-base64-json.signature')).toBeNull();
    expect(accessTokenExpiresAt(signedLikeToken({ sub: 'user-1' }))).toBeNull();
    expect(accessTokenExpiresAt(signedLikeToken({ exp: 'soon' }))).toBeNull();
    expect(accessTokenExpiresAt(signedLikeToken({ exp: -1 }))).toBeNull();
    expect(accessTokenExpiresAt(signedLikeToken('not-an-object'))).toBeNull();
  });
});

describe('accessTokenNeedsRefresh', () => {
  const expiry = 1_800_000_000;
  const token = signedLikeToken({ exp: expiry, sub: 'user-1' });
  const expiresAtMs = expiry * 1_000;

  it('rotates a token that is inside the skew window', () => {
    expect(
      accessTokenNeedsRefresh(
        token,
        expiresAtMs - ACCESS_TOKEN_REFRESH_SKEW_MS + 1,
        ACCESS_TOKEN_REFRESH_SKEW_MS,
      ),
    ).toBe(true);
  });

  it('rotates a token that is exactly at the skew boundary', () => {
    expect(
      accessTokenNeedsRefresh(
        token,
        expiresAtMs - ACCESS_TOKEN_REFRESH_SKEW_MS,
        ACCESS_TOKEN_REFRESH_SKEW_MS,
      ),
    ).toBe(true);
  });

  it('leaves a token that still has most of its life alone', () => {
    expect(
      accessTokenNeedsRefresh(
        token,
        expiresAtMs - ACCESS_TOKEN_REFRESH_SKEW_MS - 1,
        ACCESS_TOKEN_REFRESH_SKEW_MS,
      ),
    ).toBe(false);
  });

  it('rotates a token that already expired while the host was asleep', () => {
    expect(
      accessTokenNeedsRefresh(token, expiresAtMs + 3_600_000, ACCESS_TOKEN_REFRESH_SKEW_MS),
    ).toBe(true);
  });

  it('never rotates on a token whose expiry cannot be read', () => {
    expect(
      accessTokenNeedsRefresh('opaque-access-token', Date.now(), ACCESS_TOKEN_REFRESH_SKEW_MS),
    ).toBe(false);
  });
});
