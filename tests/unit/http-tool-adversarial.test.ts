import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import { parseHostRules } from '../../src/sdk/http-host-rules';
import { createHttpTool } from '../../src/sdk/http-tool';
import { startTestServer } from '../helpers/http-test-server';

import type { HttpHostRule } from '../../src/sdk/http-tool.types';
import type { TestServer } from '../helpers/http-test-server';

let server: TestServer;

beforeAll(async () => {
  server = await startTestServer();
});
afterAll(async () => {
  await server.close();
});

const rulesOf = (...hosts: string[]): readonly HttpHostRule[] => {
  const rules = parseHostRules(hosts);
  if (typeof rules === 'string') throw new Error(rules);
  return rules;
};

describe('http.request: names that resolve to an address inside the machine', () => {
  it.each([
    ['NAT64 loopback', '64:ff9b::7f00:1'],
    ['IPv4-compatible loopback', '::7f00:1'],
    ['6to4 loopback', '2002:7f00:1::1'],
    ['6to4 private', '2002:c0a8:101::1'],
    ['site-local', 'fec0::1'],
    ['benchmark range', '198.18.0.1'],
    ['mapped metadata', '::ffff:a9fe:a9fe'],
  ])('refuses a listed public name that resolves to %s', async (_label, address) => {
    const tool = createHttpTool({
      rules: rulesOf('rebind.example.com'),
      resolve: () => Promise.resolve([{ address, family: address.includes(':') ? 6 : 4 }]),
      send: () => Promise.reject(new Error('must not connect')),
    });
    await expect(
      tool.execute({ method: 'GET', url: 'http://rebind.example.com/' }),
    ).rejects.toThrow(/resolves to/u);
  });

  it('refuses a name when only the second of its answers is private', async () => {
    const tool = createHttpTool({
      rules: rulesOf('mixed.example.com'),
      resolve: () =>
        Promise.resolve([
          { address: '93.184.216.34', family: 4 },
          { address: '10.0.0.5', family: 4 },
        ]),
      send: () => Promise.reject(new Error('must not connect')),
    });
    await expect(tool.execute({ method: 'GET', url: 'http://mixed.example.com/' })).rejects.toThrow(
      /10\.0\.0\.5/u,
    );
  });
});

describe('http.request: URL parsing differentials on a redirect', () => {
  const tool = () => createHttpTool({ rules: rulesOf(`127.0.0.1:${String(server.port)}`) });

  it('treats a backslash as a path character, so a userinfo trick stays on the listed origin', async () => {
    const hidden = `http://127.0.0.1:${String(server.port)}\\@127.0.0.1:9/`;
    const result = (await tool().execute({
      method: 'GET',
      url: `${server.origin}/redirect?to=${encodeURIComponent(hidden)}`,
    })) as { finalUrl: string; status: number };

    expect(result.finalUrl).toContain(`:${String(server.port)}/@127.0.0.1:9/`);
    expect(result.status).toBe(404);
  });

  it.each([
    `http://127.0.0.1:${String(9)}@127.0.0.1:1/`,
    'http://0x7f.1:1/',
    'http://[::ffff:7f00:1]:1/',
    'file:///etc/passwd',
    'gopher://127.0.0.1:1/',
  ])('refuses a redirect to %s', async (to) => {
    const result = (await tool().execute({
      method: 'GET',
      url: `${server.origin}/redirect?to=${encodeURIComponent(to)}`,
    })) as { ok: boolean; error: string };

    expect(result.ok).toBe(false);
    expect(result.error).toMatch(/Redirect refused|not a valid URL/u);
  });
});
