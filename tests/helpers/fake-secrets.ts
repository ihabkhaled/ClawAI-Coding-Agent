/**
 * Builders for FAKE secret-shaped fixtures. Tests that prove redaction or secret
 * scanning need values that look like credentials, but the source text must never
 * hold a complete secret shape (secret scanners flag it). Every value here is
 * assembled at run time from harmless pieces.
 */

export const ALPHA = 'abcdefghijklmnopqrstuvwxyz';
export const DIGITS = '0123456789';

/** Join pieces with no separator. */
export function assemble(...parts: string[]): string {
  return parts.join('');
}

/** Join pieces with dashes (idempotency keys, ids). */
export function dashed(...parts: string[]): string {
  return parts.join('-');
}

/** OpenAI-style key: `sk-` + body (default: 40 chars). */
export function fakeOpenAiKey(body = `${ALPHA}${DIGITS}ABCD`): string {
  return `${['s', 'k'].join('')}-${body}`;
}

/** Stripe live key: `sk_live_` + body. */
export function fakeStripeKey(body: string): string {
  return `${['s', 'k'].join('')}_${['li', 've'].join('')}_${body}`;
}

/** AWS access key id: `AKIA` + body. */
export function fakeAwsKeyId(body: string): string {
  return `${['AK', 'IA'].join('')}${body}`;
}

/** GitHub personal access token (classic): `ghp_` + body. */
export function fakeGithubToken(body: string): string {
  return `${['g', 'hp'].join('')}_${body}`;
}

/** GitHub fine-grained token: `github_pat_` + body. */
export function fakeGithubPat(body: string): string {
  return `${['github', 'pat'].join('_')}_${body}`;
}

/** Slack token: `xox<kind>-` + body. */
export function fakeSlackToken(kind: string, body: string): string {
  return `${['xo', 'x'].join('')}${kind}-${body}`;
}

/** JWT built from JSON parts at run time. */
export function fakeJwt(payload: Record<string, unknown>, signature: string): string {
  const part = (value: Record<string, unknown>): string =>
    Buffer.from(JSON.stringify(value)).toString('base64url');
  return [part({ alg: 'HS256' }), part(payload), signature].join('.');
}

/** PEM armour line, e.g. fakePemBegin('RSA') or fakePemBegin('PGP', ' BLOCK'). */
export function fakePemBegin(kind: string, suffix = ''): string {
  return `-----${['BE', 'GIN'].join('')} ${kind} ${['PRI', 'VATE'].join('')} KEY${suffix}-----`;
}

/** `Authorization` header value for a scheme and token. */
export function fakeAuthorization(scheme: 'Bearer' | 'Basic', token: string): string {
  return `${scheme} ${token}`;
}

/** High-entropy generic token for `api_key=` / `token:` lines (default: 22 chars). */
export function fakeGenericToken(length = 22): string {
  return `${ALPHA}${DIGITS}`.slice(0, length);
}
