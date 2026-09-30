import { describe, expect, it, vi } from 'vitest';

import { MAX_PLUGIN_BYTES } from '../../src/core/plugin-manifest.constants';
import { downloadBytes } from '../../src/infrastructure/plugin-download';
import { assertPublicUrl } from '../../src/infrastructure/plugin-network-guard';

const publicLookup = async (): Promise<readonly string[]> => ['93.184.216.34'];
const network = { lookup: publicLookup };

function reply(
  status: number,
  body: string | Uint8Array<ArrayBuffer>,
  headers: Record<string, string> = {},
): Response {
  return new Response(body, { status, headers });
}

describe('downloadBytes failure paths', () => {
  it('refuses a plain-http first hop and never requests it', async () => {
    const request = vi.fn<typeof fetch>();
    await expect(downloadBytes('http://x.example/p.zip', request, network)).rejects.toMatchObject({
      code: 'invalid-source',
      detail: 'not a plain https URL',
    });
    expect(request).not.toHaveBeenCalled();
  });

  it('refuses a URL that carries credentials', async () => {
    const request = vi.fn<typeof fetch>();
    await expect(
      downloadBytes('https://user:pw@x.example/p.zip', request, network),
    ).rejects.toMatchObject({ code: 'invalid-source' });
    expect(request).not.toHaveBeenCalled();
  });

  it('maps a network error to unreachable', async () => {
    const request = vi.fn<typeof fetch>().mockRejectedValue(new Error('ECONNRESET'));
    await expect(downloadBytes('https://x.example/p.zip', request, network)).rejects.toMatchObject({
      code: 'unreachable',
      detail: 'https://x.example/p.zip',
    });
  });

  it('reports the status of a non-ok answer', async () => {
    const request = vi.fn<typeof fetch>().mockResolvedValue(reply(404, 'no'));
    await expect(downloadBytes('https://x.example/p.zip', request, network)).rejects.toMatchObject({
      code: 'unreachable',
      detail: 'https://x.example/p.zip (404)',
    });
  });

  it('rejects a declared size over the ceiling before reading the body', async () => {
    const request = vi
      .fn<typeof fetch>()
      .mockResolvedValue(reply(200, 'x', { 'content-length': String(MAX_PLUGIN_BYTES + 1) }));
    await expect(downloadBytes('https://x.example/p.zip', request, network)).rejects.toMatchObject({
      code: 'too-large',
    });
  });

  it('abandons a body that outgrows the ceiling despite a small header', async () => {
    const big = new Uint8Array(MAX_PLUGIN_BYTES + 1);
    const request = vi
      .fn<typeof fetch>()
      .mockResolvedValue(reply(200, big, { 'content-length': '5' }));
    await expect(downloadBytes('https://x.example/p.zip', request, network)).rejects.toMatchObject({
      code: 'too-large',
    });
  });

  it('returns the exact bytes of a good answer', async () => {
    const request = vi.fn<typeof fetch>().mockResolvedValue(reply(200, new Uint8Array([1, 2, 3])));
    const bytes = await downloadBytes('https://x.example/p.zip', request, network);
    expect([...bytes]).toEqual([1, 2, 3]);
  });

  it('follows a relative redirect and holds the next hop to https', async () => {
    const request = vi
      .fn<typeof fetch>()
      .mockResolvedValueOnce(reply(302, '', { location: '/final.zip' }))
      .mockResolvedValueOnce(reply(200, new Uint8Array([9])));
    const bytes = await downloadBytes('https://x.example/p.zip', request, network);
    expect([...bytes]).toEqual([9]);
    expect(request.mock.calls[1]?.[0]).toBe('https://x.example/final.zip');
  });

  it('refuses a redirect that downgrades to http', async () => {
    const request = vi
      .fn<typeof fetch>()
      .mockResolvedValueOnce(reply(301, '', { location: 'http://evil.example/p.zip' }));
    await expect(downloadBytes('https://x.example/p.zip', request, network)).rejects.toMatchObject({
      code: 'invalid-source',
      detail: 'http://evil.example/p.zip',
    });
    expect(request).toHaveBeenCalledTimes(1);
  });

  it('refuses a redirect into a private address', async () => {
    const request = vi
      .fn<typeof fetch>()
      .mockResolvedValueOnce(reply(302, '', { location: 'https://169.254.169.254/latest' }));
    await expect(downloadBytes('https://x.example/p.zip', request, network)).rejects.toMatchObject({
      code: 'invalid-source',
    });
    expect(request).toHaveBeenCalledTimes(1);
  });

  it('gives up after too many redirects', async () => {
    const request = vi
      .fn<typeof fetch>()
      .mockImplementation(async () => reply(302, '', { location: 'https://x.example/again' }));
    await expect(downloadBytes('https://x.example/p.zip', request, network)).rejects.toMatchObject({
      code: 'unreachable',
      detail: 'too many redirects',
    });
    expect(request).toHaveBeenCalledTimes(6);
  });
});

describe('assertPublicUrl', () => {
  it('skips every check when the user opted into private sources', async () => {
    await expect(
      assertPublicUrl('http://10.0.0.1/x', { allowPrivate: true }),
    ).resolves.toBeUndefined();
  });

  it('rejects text that is not a URL', async () => {
    await expect(assertPublicUrl('nope', network)).rejects.toMatchObject({
      code: 'invalid-source',
    });
  });

  it('rejects a name that resolves to any private address, not just the first', async () => {
    const lookup = async (): Promise<readonly string[]> => ['93.184.216.34', '169.254.169.254'];
    await expect(assertPublicUrl('https://sneaky.example/x', { lookup })).rejects.toMatchObject({
      code: 'invalid-source',
      detail: 'private address',
    });
  });

  it('rejects a private IP literal without asking DNS', async () => {
    const lookup = vi.fn(publicLookup);
    await expect(assertPublicUrl('https://192.168.1.5/x', { lookup })).rejects.toMatchObject({
      code: 'invalid-source',
    });
    expect(lookup).not.toHaveBeenCalled();
  });

  it('treats a failed or empty lookup as unreachable', async () => {
    await expect(
      assertPublicUrl('https://x.example/', {
        lookup: async () => {
          throw new Error('ENOTFOUND');
        },
      }),
    ).rejects.toMatchObject({ code: 'unreachable', detail: 'x.example' });
    await expect(
      assertPublicUrl('https://x.example/', { lookup: async () => [] }),
    ).rejects.toMatchObject({
      code: 'unreachable',
    });
  });

  it('accepts a public name and a public IP literal', async () => {
    await expect(assertPublicUrl('https://x.example/', network)).resolves.toBeUndefined();
    await expect(assertPublicUrl('https://93.184.216.34/', network)).resolves.toBeUndefined();
  });
});
