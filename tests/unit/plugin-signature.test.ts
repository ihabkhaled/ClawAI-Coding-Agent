import { generateKeyPairSync, sign } from 'node:crypto';

import { describe, expect, it } from 'vitest';

import {
  canonicalEntryJson,
  signatureOutcome,
  verifyEntrySignature,
} from '../../src/core/plugin-signature';
import {
  effectiveTrustedPublishers,
  readSignaturePolicy,
  readTrustedPublishers,
} from '../../src/core/plugin-signature-policy';

import type { SignableEntry } from '../../src/core/plugin-signature.types';

const entry: SignableEntry = {
  name: 'review-kit',
  publisher: 'acme',
  version: '1.0.0',
  source: 'review-kit.zip',
  sha256: 'a'.repeat(64),
};

function keyPair() {
  const { publicKey, privateKey } = generateKeyPairSync('ed25519');
  const der = publicKey.export({ format: 'der', type: 'spki' });
  return { privateKey, spki: der.toString('base64'), raw: der.subarray(-32).toString('base64') };
}

function signed(privateKey: ReturnType<typeof keyPair>['privateKey']): string {
  return sign(null, Buffer.from(canonicalEntryJson(entry), 'utf8'), privateKey).toString('base64');
}

describe('canonicalEntryJson', () => {
  it('is fixed text, independent of key order and unsigned fields', () => {
    const shuffled = {
      version: '1.0.0',
      sha256: 'a'.repeat(64),
      source: 'review-kit.zip',
      publisher: 'acme',
      name: 'review-kit',
      description: 'ignored',
      signature: 'ignored',
    };

    expect(canonicalEntryJson(shuffled)).toBe(canonicalEntryJson(entry));
    expect(canonicalEntryJson(entry)).toBe(
      `{"name":"review-kit","publisher":"acme","sha256":"${'a'.repeat(64)}","source":"review-kit.zip","version":"1.0.0"}`,
    );
  });
});

describe('verifyEntrySignature', () => {
  it('accepts a valid signature for SPKI and for raw public keys', () => {
    const { privateKey, spki, raw } = keyPair();
    const signature = signed(privateKey);

    expect(verifyEntrySignature(entry, signature, { acme: spki })).toEqual({
      status: 'signed',
      signer: 'acme',
    });
    expect(verifyEntrySignature(entry, signature, { acme: raw }).status).toBe('signed');
  });

  it.each([
    ['name', { name: 'other-kit' }],
    ['version', { version: '9.9.9' }],
    ['source', { source: 'evil.zip' }],
    ['sha256', { sha256: 'b'.repeat(64) }],
    ['publisher', { publisher: 'mallory' }],
  ])('rejects a tampered %s', (_field, change) => {
    const { privateKey, spki } = keyPair();
    const signature = signed(privateKey);
    const trusted = { acme: spki, mallory: spki };

    expect(verifyEntrySignature({ ...entry, ...change }, signature, trusted).status).toBe(
      'invalid',
    );
  });

  it('rejects a signature made with a different key', () => {
    const { privateKey } = keyPair();
    const other = keyPair();

    expect(verifyEntrySignature(entry, signed(privateKey), { acme: other.spki }).status).toBe(
      'invalid',
    );
  });

  it('reports an unknown publisher, an unsigned entry and an unusable key', () => {
    const { privateKey, spki } = keyPair();
    const signature = signed(privateKey);

    expect(verifyEntrySignature(entry, signature, { other: spki }).status).toBe(
      'unknown-publisher',
    );
    expect(verifyEntrySignature(entry, undefined, { acme: spki }).status).toBe('unsigned');
    expect(verifyEntrySignature(entry, signature, { acme: 'not a key' }).status).toBe('invalid');
    expect(verifyEntrySignature(entry, '%%%', { acme: spki }).status).toBe('invalid');
  });

  it('does not treat an inherited property name as a trusted publisher', () => {
    const { privateKey } = keyPair();

    expect(
      verifyEntrySignature({ ...entry, publisher: 'constructor' }, signed(privateKey), {}).status,
    ).toBe('unknown-publisher');
  });
});

describe('signatureOutcome', () => {
  it('accepts everything when off and anything signed in every mode', () => {
    expect(signatureOutcome({ status: 'invalid' }, 'off')).toBe('accept');
    expect(signatureOutcome({ status: 'signed', signer: 'acme' }, 'require')).toBe('accept');
  });

  it('warns in warn mode and refuses in require mode', () => {
    for (const status of ['unsigned', 'unknown-publisher', 'invalid'] as const) {
      expect(signatureOutcome({ status }, 'warn')).toBe('warn');
      expect(signatureOutcome({ status }, 'require')).toBe('refuse');
    }
  });
});

describe('trusted publisher policy', () => {
  const user = { acme: 'user-key', beta: 'beta-key' };

  it('uses the user list when no policy speaks', () => {
    expect(effectiveTrustedPublishers(undefined, undefined, user)).toEqual(user);
  });

  it('lets the organization replace the user list', () => {
    expect(effectiveTrustedPublishers({ acme: 'org-key' }, undefined, user)).toEqual({
      acme: 'org-key',
    });
  });

  it('lets a project only narrow', () => {
    expect(effectiveTrustedPublishers(undefined, { acme: 'user-key' }, user)).toEqual({
      acme: 'user-key',
    });
    expect(effectiveTrustedPublishers(undefined, { evil: 'evil-key' }, user)).toEqual({});
    expect(effectiveTrustedPublishers(undefined, { acme: 'swapped-key' }, user)).toEqual({});
    expect(
      effectiveTrustedPublishers({ acme: 'org-key' }, { acme: 'org-key', evil: 'k' }, user),
    ).toEqual({ acme: 'org-key' });
  });

  it('reads a malformed block as trusting nobody and absence as no opinion', () => {
    expect(readTrustedPublishers(undefined)).toBeUndefined();
    expect(readTrustedPublishers(7)).toEqual({});
    expect(readTrustedPublishers({ 'Bad Id': 'x' })).toEqual({});
    expect(readTrustedPublishers({ acme: 'k' })).toEqual({ acme: 'k' });
  });

  it('falls back to warn for an unknown mode', () => {
    expect(readSignaturePolicy('require')).toBe('require');
    expect(readSignaturePolicy('strict')).toBe('warn');
    expect(readSignaturePolicy(undefined)).toBe('warn');
  });
});
