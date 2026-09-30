import { PluginFailure } from '../core/plugin-failure';
import { MAX_PLUGIN_BYTES } from '../core/plugin-manifest.constants';

/** How long one catalog or archive download may take. */
const DOWNLOAD_TIMEOUT_MS = 30_000;

/**
 * Bytes from an https URL, bounded in size and time.
 *
 * The size is checked against the header and again against what arrived,
 * because a header is the server's claim and the body is the fact.
 */
export async function downloadBytes(
  url: string,
  request: typeof fetch = fetch,
): Promise<Uint8Array> {
  if (!url.startsWith('https://') || hasCredentials(url)) {
    throw new PluginFailure('invalid-source', 'not a plain https URL');
  }
  let response: Response;
  try {
    response = await request(url, {
      redirect: 'follow',
      signal: AbortSignal.timeout(DOWNLOAD_TIMEOUT_MS),
    });
  } catch {
    throw new PluginFailure('unreachable', url);
  }
  // A redirect to plain http would let the bytes be swapped in transit.
  if (response.url !== '' && !response.url.startsWith('https://')) {
    throw new PluginFailure('invalid-source', response.url);
  }
  if (!response.ok) throw new PluginFailure('unreachable', `${url} (${String(response.status)})`);
  const declared = Number(response.headers.get('content-length') ?? '0');
  if (declared > MAX_PLUGIN_BYTES) throw new PluginFailure('too-large');
  return readBounded(response);
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
