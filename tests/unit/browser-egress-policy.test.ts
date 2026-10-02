import { describe, expect, it } from 'vitest';

import { egressDecision } from '../../src/sdk/browser-egress-policy';

import type { BrowserResolver } from '../../src/sdk/browser-egress.types';

const answers: Record<string, string[]> = {
  'localtest.me': ['127.0.0.1'],
  'rebind.example.com': ['93.184.216.34', '10.0.0.5'],
  'good.example.com': ['93.184.216.34'],
  'meta.example.com': ['169.254.169.254'],
  'six.example.com': ['::1'],
  'nat64.example.com': ['64:ff9b::7f00:1'],
};
const calls: string[] = [];
const resolve: BrowserResolver = (host) => {
  calls.push(host);
  const found = answers[host];
  return found === undefined ? Promise.reject(new Error('ENOTFOUND')) : Promise.resolve(found);
};

const decide = (host: string, allow: string[] = [], port = 80) =>
  egressDecision({ host, port }, allow, resolve);

describe('browser egress decision', () => {
  it('lets a public name through and returns the address that was judged', async () => {
    expect(await decide('good.example.com')).toEqual({ address: '93.184.216.34' });
  });

  it.each(['localtest.me', 'meta.example.com', 'six.example.com', 'nat64.example.com'])(
    'refuses %s, a public-looking name that points inside the machine',
    async (host) => {
      expect(await decide(host)).toMatchObject({ refused: expect.stringContaining('resolves to') });
    },
  );

  it('refuses a name when any one of its addresses is private', async () => {
    expect(await decide('rebind.example.com')).toMatchObject({
      refused: expect.stringContaining('10.0.0.5'),
    });
  });

  it('lets the operator list a name that points inside, with or without its port', async () => {
    expect(await decide('localtest.me', ['localtest.me'])).toEqual({ address: '127.0.0.1' });
    expect(await decide('localtest.me', ['localtest.me:8080'], 8080)).toEqual({
      address: '127.0.0.1',
    });
    expect(await decide('localtest.me', ['localtest.me:8080'], 9090)).toHaveProperty('refused');
  });

  it.each([
    '127.0.0.1',
    'localhost',
    'localhost.',
    'foo.localhost',
    'intranet',
    '10.1.2.3',
    '198.18.0.1',
    '[::1]',
    '::ffff:7f00:1',
    '::7f00:1',
    '2002:7f00:1::1',
    'fec0::1',
  ])('refuses the private spelling %s without resolving it', async (host) => {
    calls.length = 0;
    expect(await decide(host)).toHaveProperty('refused');
    expect(calls).toEqual([]);
  });

  it('refuses a non-standard IPv4 spelling even if it reaches the resolver', async () => {
    expect(await decide('0x7f.1')).toHaveProperty('refused');
  });

  it('passes a listed IP literal and a public literal', async () => {
    expect(await decide('127.0.0.1', ['127.0.0.1'])).toEqual({ address: '127.0.0.1' });
    expect(await decide('93.184.216.34')).toEqual({ address: '93.184.216.34' });
  });

  it('refuses a name that does not resolve rather than guessing', async () => {
    expect(await decide('nope.example.com')).toEqual({
      refused: 'nope.example.com did not resolve to any address',
    });
  });
});
