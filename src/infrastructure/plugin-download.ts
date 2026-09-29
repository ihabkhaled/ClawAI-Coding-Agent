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
  if (!url.startsWith('https://')) throw new PluginFailure('invalid-source', url);
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
  const bytes = new Uint8Array(await response.arrayBuffer());
  if (bytes.byteLength > MAX_PLUGIN_BYTES) throw new PluginFailure('too-large');
  return bytes;
}
