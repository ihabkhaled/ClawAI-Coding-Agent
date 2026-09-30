import { describe, expect, it, vi } from 'vitest';

import { downloadBytes } from '../../src/infrastructure/plugin-download';
import { assertPublicUrl } from '../../src/infrastructure/plugin-network-guard';

const publicLookup = vi.fn(async () => ['93.184.216.34']);
const PUBLIC = { lookup: publicLookup };

function redirect(location: string): Response {
  return new Response(null, { status: 302, headers: { location } });
}

describe('assertPublicUrl', () => {
  it('passes a public name that resolves publicly', async () => {
    await expect(assertPublicUrl('https://cdn.example/p.zip', PUBLIC)).resolves.toBeUndefined();
  });

  it('refuses a private literal without resolving anything', async () => {
    const lookup = vi.fn(async () => ['93.184.216.34']);
    await expect(assertPublicUrl('https://169.254.169.254/x', { lookup })).rejects.toMatchObject({
      code: 'invalid-source',
    });
    expect(lookup).not.toHaveBeenCalled();
  });

  it('accepts a public IP literal without a lookup', async () => {
    const lookup = vi.fn(async () => ['10.0.0.1']);
    await expect(assertPublicUrl('https://8.8.8.8/x', { lookup })).resolves.toBeUndefined();
    expect(lookup).not.toHaveBeenCalled();
  });

  it('refuses a public-looking name when ANY resolved address is private', async () => {
    const lookup = vi.fn(async () => ['93.184.216.34', '::ffff:10.0.0.1']);
    await expect(assertPublicUrl('https://evil.example/x', { lookup })).rejects.toMatchObject({
      code: 'invalid-source',
    });
  });

  it('reports an unresolvable or empty answer as unreachable', async () => {
    const failing = async (): Promise<string[]> => {
      throw new Error('ENOTFOUND');
    };
    await expect(assertPublicUrl('https://x.example/', { lookup: failing })).rejects.toMatchObject({
      code: 'unreachable',
    });
    await expect(
      assertPublicUrl('https://x.example/', { lookup: async () => [] }),
    ).rejects.toMatchObject({ code: 'unreachable' });
  });

  it('refuses something that is not a URL', async () => {
    await expect(assertPublicUrl('nope', PUBLIC)).rejects.toMatchObject({
      code: 'invalid-source',
    });
  });

  it('lets everything through when the user opted in', async () => {
    const lookup = vi.fn(async () => ['10.0.0.1']);
    await expect(
      assertPublicUrl('https://localhost/x', { allowPrivate: true, lookup }),
    ).resolves.toBeUndefined();
    expect(lookup).not.toHaveBeenCalled();
  });
});

describe('downloadBytes network policy', () => {
  it('refuses a name that resolves to a private address before any request', async () => {
    const request = vi.fn();
    await expect(
      downloadBytes('https://evil.example/p.zip', request, { lookup: async () => ['192.168.0.9'] }),
    ).rejects.toMatchObject({ code: 'invalid-source' });
    expect(request).not.toHaveBeenCalled();
  });

  it('refuses a literal metadata URL', async () => {
    const request = vi.fn();
    await expect(
      downloadBytes('https://169.254.169.254/latest/meta-data', request, PUBLIC),
    ).rejects.toMatchObject({ code: 'invalid-source' });
    expect(request).not.toHaveBeenCalled();
  });

  it('checks every redirect hop, resolving relative locations', async () => {
    const request = vi
      .fn<typeof fetch>()
      .mockResolvedValueOnce(redirect('/next'))
      .mockResolvedValueOnce(redirect('https://internal-alias.example/p.zip'));
    const lookup = vi.fn(async (host: string) =>
      host === 'internal-alias.example' ? ['10.0.0.7'] : ['93.184.216.34'],
    );
    await expect(
      downloadBytes('https://cdn.example/p.zip', request, { lookup }),
    ).rejects.toMatchObject({ code: 'invalid-source' });
    expect(request).toHaveBeenCalledTimes(2);
    expect(request.mock.calls[1]?.[0]).toBe('https://cdn.example/next');
  });

  it('refuses a redirect to a private literal and to plain http', async () => {
    const toPrivate = vi
      .fn<typeof fetch>()
      .mockResolvedValueOnce(redirect('https://127.0.0.1/p.zip'));
    await expect(
      downloadBytes('https://cdn.example/p.zip', toPrivate, PUBLIC),
    ).rejects.toMatchObject({ code: 'invalid-source' });
    const toHttp = vi
      .fn<typeof fetch>()
      .mockResolvedValueOnce(redirect('http://cdn.example/p.zip'));
    await expect(downloadBytes('https://cdn.example/p.zip', toHttp, PUBLIC)).rejects.toMatchObject({
      code: 'invalid-source',
    });
  });

  it('follows a public redirect and stops a redirect loop', async () => {
    const ok = vi
      .fn<typeof fetch>()
      .mockResolvedValueOnce(redirect('https://mirror.example/p.zip'))
      .mockResolvedValueOnce(new Response(new Uint8Array([7, 8])));
    expect([...(await downloadBytes('https://cdn.example/p.zip', ok, PUBLIC))]).toEqual([7, 8]);
    const loop = vi.fn<typeof fetch>(async () => redirect('https://cdn.example/p.zip'));
    await expect(downloadBytes('https://cdn.example/p.zip', loop, PUBLIC)).rejects.toMatchObject({
      code: 'unreachable',
    });
    expect(loop).toHaveBeenCalledTimes(6);
  });

  it('reports a failed request as unreachable', async () => {
    const request = vi.fn<typeof fetch>(async () => {
      throw new Error('boom');
    });
    await expect(downloadBytes('https://cdn.example/p.zip', request, PUBLIC)).rejects.toMatchObject(
      {
        code: 'unreachable',
      },
    );
  });

  it('allows a private host when the user opted in', async () => {
    const request = vi.fn<typeof fetch>(async () => new Response(new Uint8Array([1])));
    expect([
      ...(await downloadBytes('https://intranet.local/p.zip', request, { allowPrivate: true })),
    ]).toEqual([1]);
  });
});
