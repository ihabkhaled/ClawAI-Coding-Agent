import { createPublicKey, verify } from 'node:crypto';

import { ED25519_SPKI_PREFIX_HEX } from './plugin-signature.constants';

import type {
  PluginSignaturePolicy,
  SignableEntry,
  SignatureOutcome,
  SignatureVerdict,
  TrustedPublishers,
} from './plugin-signature.types';
import type { KeyObject } from 'node:crypto';

/**
 * The exact text a publisher signs for one catalog entry.
 *
 * A JSON object with the five signed fields in alphabetical key order and no
 * whitespace, encoded as UTF-8. The order is written out here, never taken from
 * the input, so two catalogs that list the same entry's keys differently sign
 * the same bytes. Fields that are not listed (`description`, `signature`) are
 * not covered. `scripts/sign-plugin-catalog.mjs` writes the same text.
 */
export function canonicalEntryJson(entry: SignableEntry): string {
  return JSON.stringify({
    name: entry.name,
    publisher: entry.publisher,
    sha256: entry.sha256,
    source: entry.source,
    version: entry.version,
  });
}

function importPublicKey(encoded: string): KeyObject | undefined {
  try {
    const bytes = Buffer.from(encoded, 'base64');
    const der =
      bytes.length === 32
        ? Buffer.concat([Buffer.from(ED25519_SPKI_PREFIX_HEX, 'hex'), bytes])
        : bytes;
    const key = createPublicKey({ key: der, format: 'der', type: 'spki' });
    return key.asymmetricKeyType === 'ed25519' ? key : undefined;
  } catch {
    return undefined;
  }
}

/**
 * Checks an entry's detached signature against the key its publisher is trusted with.
 *
 * The entry's own `publisher` names the key, and is part of the signed text,
 * so a signature cannot be replayed under another publisher's name.
 */
export function verifyEntrySignature(
  entry: SignableEntry,
  signature: string | undefined,
  trusted: TrustedPublishers,
): SignatureVerdict {
  if (signature === undefined || signature === '') return { status: 'unsigned' };
  const encodedKey = Object.hasOwn(trusted, entry.publisher) ? trusted[entry.publisher] : undefined;
  if (encodedKey === undefined) return { status: 'unknown-publisher' };
  const key = importPublicKey(encodedKey);
  if (key === undefined) return { status: 'invalid' };
  try {
    const valid = verify(
      null,
      Buffer.from(canonicalEntryJson(entry), 'utf8'),
      key,
      Buffer.from(signature, 'base64'),
    );
    return valid ? { status: 'signed', signer: entry.publisher } : { status: 'invalid' };
  } catch {
    return { status: 'invalid' };
  }
}

/** `off` never looks; `warn` lets an unverified plugin through loudly; `require` refuses it. */
export function signatureOutcome(
  verdict: SignatureVerdict,
  mode: PluginSignaturePolicy,
): SignatureOutcome {
  if (mode === 'off' || verdict.status === 'signed') return 'accept';
  return mode === 'require' ? 'refuse' : 'warn';
}
