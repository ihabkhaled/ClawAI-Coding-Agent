import { PluginFailure } from '../core/plugin-failure';
import { MAX_PLUGIN_BYTES } from '../core/plugin-manifest.constants';

import { assertPublicUrl } from './plugin-network-guard';

import type { PluginNetworkOptions } from './plugin-network-guard.types';

/** How long one catalog or archive download may take. */
const DOWNLOAD_TIMEOUT_MS = 30_000;

/** Redirect hops followed by hand, each one checked before it is requested. */
const MAX_REDIRECTS = 5;

/**
 * Bytes from an https URL, bounded in size and time.
 *
 * The size is checked against the header and again against what arrived,
 * because a header is the server's claim and the body is the fact.
 */
export async function downloadBytes(
  url: string,
  request: typeof fetch = fetch,
  network: PluginNetworkOptions = {},
): Promise<Uint8Array> {
  const response = await fetchChecked(url, request, network);
  // A runtime that followed a redirect on its own must still have ended on https.
  if (response.url !== '' && !response.url.startsWith('https://')) {
    throw new PluginFailure('invalid-source', response.url);
  }
  if (!response.ok) throw new PluginFailure('unreachable', `${url} (${String(response.status)})`);
  const declared = Number(response.headers.get('content-length') ?? '0');
  if (declared > MAX_PLUGIN_BYTES) throw new PluginFailure('too-large');
  return readBounded(response);
}

/**
 * Follows redirects by hand so every hop is held to the same rules as the
 * first: https (a plain-http hop would let the bytes be swapped in transit),
 * no credentials, and, unless the user opted in, a public address.
 */
async function fetchChecked(
  first: string,
  request: typeof fetch,
  network: PluginNetworkOptions,
): Promise<Response> {
  let url = first;
  for (let hop = 0; hop <= MAX_REDIRECTS; hop += 1) {
    if (!url.startsWith('https://') || hasCredentials(url)) {
      throw new PluginFailure('invalid-source', hop === 0 ? 'not a plain https URL' : url);
    }
    await assertPublicUrl(url, network);
    let response: Response;
    try {
      response = await request(url, {
        redirect: 'manual',
        signal: AbortSignal.timeout(DOWNLOAD_TIMEOUT_MS),
      });
    } catch {
      throw new PluginFailure('unreachable', url);
    }
    const redirected = response.status >= 300 && response.status < 400;
    const location = redirected ? response.headers.get('location') : null;
    if (location === null) return response;
    url = URL.canParse(location, url) ? new URL(location, url).href : location;
  }
  throw new PluginFailure('unreachable', 'too many redirects');
}

/** A user name or password in a URL ends up in logs, settings sync and referrers. */
function hasCredentials(url: string): boolean {
  if (!URL.canParse(url)) return true;
  const parsed = new URL(url);
  return parsed.username !== '' || parsed.password !== '';
}

/**
 * The body, read chunk by chunk and abandoned at the ceiling. `arrayBuffer()`
 * would buffer whatever a server keeps sending until the timeout.
 */
async function readBounded(response: Response): Promise<Uint8Array> {
  const reader = response.body?.getReader();
  if (reader === undefined) return new Uint8Array();
  const chunks: Uint8Array[] = [];
  let total = 0;
  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    total += value.byteLength;
    if (total > MAX_PLUGIN_BYTES) {
      await reader.cancel();
      throw new PluginFailure('too-large');
    }
    chunks.push(value);
  }
  return new Uint8Array(Buffer.concat(chunks));
}
