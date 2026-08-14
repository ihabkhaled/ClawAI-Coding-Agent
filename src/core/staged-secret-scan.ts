import {
  STAGED_SECRET_ASSIGNMENT_PATTERN,
  STAGED_SECRET_FORMAT_PATTERNS,
  STAGED_SECRET_MIN_ENTROPY_BITS,
  STAGED_SECRET_MIN_VALUE_LENGTH,
  STAGED_SECRET_PLACEHOLDER_MARKERS,
} from './staged-secret-scan.constants';

/**
 * Decides whether a staged diff introduces a credential.
 *
 * The scan this replaces was a single expression —
 * `(?:api[-_]?key|password|secret|token)\s*[:=]\s*[^\s]{8,}` — run over the
 * whole diff. It had no word boundary and no opinion about the value, so
 * `rawToken: string)` read as a leaked token, as did
 * `FORGOT_PASSWORD: '/forgot-password'` and `const token = 'reset-token-abc'`.
 * A password-reset feature hit it eight times and could not be committed at
 * all, which is a guard that fails safe into never shipping.
 *
 * Three narrowings make it precise without weakening it:
 *
 * 1. **Added lines only.** Deleting a line that once held a secret is the
 *    remediation, not the leak.
 * 2. **Known formats always block.** A private key block or an `AKIA…` key is
 *    a leak wherever it appears, quoted or not.
 * 3. **Everything else must look like a credential.** A name that suggests one
 *    is not enough: the value has to survive shape and entropy checks, which
 *    is what separates a generated secret from a type annotation, a route, or
 *    a test fixture.
 */
export function findStagedSecret(diff: string): string | undefined {
  for (const line of diff.split('\n')) {
    if (!line.startsWith('+') || line.startsWith('+++')) continue;
    const added = line.slice(1);
    for (const pattern of STAGED_SECRET_FORMAT_PATTERNS) {
      const match = pattern.exec(added);
      if (match !== null) return match[0];
    }
    const leaked = assignedSecret(added);
    if (leaked !== undefined) return leaked;
  }
  return undefined;
}

function assignedSecret(line: string): string | undefined {
  // `exec` on a /g/ regex is stateful; a fresh instance keeps each line
  // independent of the one before it.
  const pattern = new RegExp(STAGED_SECRET_ASSIGNMENT_PATTERN.source, 'giu');
  let match = pattern.exec(line);
  while (match !== null) {
    const value = unquote(match.groups?.value ?? '');
    if (looksGenerated(value)) return value;
    match = pattern.exec(line);
  }
  return undefined;
}

function unquote(value: string): string {
  const quoted =
    value.length >= 2 &&
    (value.startsWith('"') || value.startsWith("'") || value.startsWith('`')) &&
    value.at(-1) === value[0];
  return quoted ? value.slice(1, -1) : value;
}

/**
 * A value looks generated when nothing explains it as ordinary source text.
 *
 * Every rejection here is a shape a real credential does not have: an
 * interpolation is computed at runtime, a path or URL is a location, an
 * identifier is a reference to a value held elsewhere, and a run of dictionary
 * words joined by separators is what people type when they need a fixture.
 */
function looksGenerated(value: string): boolean {
  if (value.length < STAGED_SECRET_MIN_VALUE_LENGTH) return false;
  const lowered = value.toLowerCase();
  if (STAGED_SECRET_PLACEHOLDER_MARKERS.some((marker) => lowered.includes(marker))) return false;
  if (value.includes('${') || value.includes('#{')) return false;
  if (value.includes('://') || value.startsWith('/') || value.startsWith('./')) return false;
  // No bare-identifier rule: a generated credential is frequently pure
  // alphanumeric, so rejecting `^[A-Za-z_$][\w$]*$` waved through every secret
  // without punctuation in it. Identifiers are separated from credentials by
  // entropy instead — `requestToken` reads as words and scores below the
  // threshold, `aB3xK9pQ7mZ2wL5vR8tD` does not.
  if (/^[a-z0-9]+(?:[-_.][a-z0-9]+)+$/u.test(value)) return false;
  if (/^[A-Z0-9]+(?:_[A-Z0-9]+)+$/u.test(value)) return false;
  return entropyBits(value) >= STAGED_SECRET_MIN_ENTROPY_BITS;
}

function entropyBits(value: string): number {
  const counts = new Map<string, number>();
  for (const character of value) counts.set(character, (counts.get(character) ?? 0) + 1);
  let bits = 0;
  for (const count of counts.values()) {
    const probability = count / value.length;
    bits -= probability * Math.log2(probability);
  }
  return bits;
}
