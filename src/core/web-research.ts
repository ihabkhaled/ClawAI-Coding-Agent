import { z } from 'zod';

/** Schemes a fetch may use. Everything else is a way to reach something that is not the web. */
const ALLOWED_PROTOCOLS = new Set(['http:', 'https:']);

/** Hosts that name the machine running the request rather than somewhere on the web. */
const LOOPBACK_HOSTS = new Set(['localhost', '127.0.0.1', '0.0.0.0', '::1', '[::1]']);

export const webSearchSchema = z
  .object({
    query: z.string().trim().min(1).max(2_000),
    maxResults: z.number().int().min(1).max(25).optional(),
    providerId: z.string().min(1).max(200).optional(),
  })
  .strict();

export const webFetchSchema = z
  .object({
    url: z.string().min(1).max(4_096),
    timeoutMs: z.number().int().min(1_000).max(120_000).optional(),
    refresh: z.boolean().optional(),
  })
  .strict();

/**
 * Whether a private network address is hiding behind a hostname.
 *
 * Only literal addresses are judged here. A name that resolves to a private
 * address still gets through, and it has to: resolution happens on the server
 * that performs the fetch, and re-resolving it here would be a different
 * answer to a different question at a different time. This check is the cheap
 * half of the defence — it stops the direct, obvious attempt.
 */
function isPrivateAddress(hostname: string): boolean {
  if (LOOPBACK_HOSTS.has(hostname)) return true;
  const octets = /^(\d{1,3})\.(\d{1,3})\.(\d{1,3})\.\d{1,3}$/u.exec(hostname);
  if (octets === null) return hostname.endsWith('.localhost') || hostname.endsWith('.internal');
  const [first, second] = [Number(octets[1]), Number(octets[2])];
  if (first === 10 || first === 127) return true;
  if (first === 192 && second === 168) return true;
  if (first === 172 && second >= 16 && second <= 31) return true;
  // Link-local, which is where cloud instance metadata lives.
  return first === 169 && second === 254;
}

/**
 * The URL a fetch may be given, or a refusal saying why not.
 *
 * The fetch itself happens on the server, which is exactly why this check
 * exists: a tool the model can call with any string, backed by a server that
 * will dutifully retrieve it, is a request-forgery primitive unless something
 * decides what counts as the web. A workspace file or a web page can put a URL
 * in front of the model, so the model's choice of URL is untrusted input.
 *
 * Credentials embedded in a URL are refused rather than stripped. Stripping
 * would silently send an unauthenticated request the caller did not intend,
 * and a caller who put a password in a URL needs to be told, not helped.
 */
export function assertFetchableUrl(raw: string): URL {
  let url: URL;
  try {
    url = new URL(raw);
  } catch {
    throw new Error(`Not a URL: ${raw}`);
  }
  if (!ALLOWED_PROTOCOLS.has(url.protocol)) {
    throw new Error(`Only http and https may be fetched, not ${url.protocol}`);
  }
  if (url.username.length > 0 || url.password.length > 0) {
    throw new Error('A URL carrying credentials will not be fetched');
  }
  if (isPrivateAddress(url.hostname.toLowerCase())) {
    throw new Error(`Refusing to fetch a private address: ${url.hostname}`);
  }
  return url;
}
