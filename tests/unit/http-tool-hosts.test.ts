import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import { canonicalIp, classifyAddress } from '../../src/sdk/http-address';
import {
  addressProblem,
  isLocalName,
  matchingRule,
  parseHostRule,
  parseHostRules,
} from '../../src/sdk/http-host-rules';
import { createHttpTool } from '../../src/sdk/http-tool';
import { approveTarget } from '../../src/sdk/http-tool-target';
import { selfSignedPair, startTestServer, startTlsServer } from '../helpers/http-test-server';

import type {
  HttpHostRule,
  HttpResolvedAddress,
  HttpResolver,
} from '../../src/sdk/http-tool.types';
import type { TestServer } from '../helpers/http-test-server';

function rules(...hosts: string[]): readonly HttpHostRule[] {
  const parsed = parseHostRules(hosts);
  if (typeof parsed === 'string') throw new Error(parsed);
  return parsed;
}

const answers =
  (...list: string[]): HttpResolver =>
  () =>
    Promise.resolve(
      list.map((address): HttpResolvedAddress => ({
        address,
        family: address.includes(':') ? 6 : 4,
      })),
    );

describe('host rules', () => {
  it('parses names, ports, ip literals, ipv6 and wildcards', () => {
    expect(parseHostRule('claw.local')).toEqual({
      kind: 'name',
      host: 'claw.local',
      port: undefined,
    });
    expect(parseHostRule('Claw.Local:8443')).toEqual({
      kind: 'name',
      host: 'claw.local',
      port: 8443,
    });
    expect(parseHostRule('127.0.0.1:3000')).toEqual({ kind: 'ip', host: '127.0.0.1', port: 3000 });
    expect(parseHostRule('[::1]:3000')).toEqual({
      kind: 'ip',
      host: '0:0:0:0:0:0:0:1',
      port: 3000,
    });
    expect(parseHostRule('*.example.com')).toEqual({
      kind: 'wildcard',
      host: 'example.com',
      port: undefined,
    });
    expect(parseHostRule('localhost:80')).toEqual({ kind: 'name', host: 'localhost', port: 80 });
  });

  it.each([
    '*',
    '',
    'https://claw.local',
    'claw.local/path',
    'a@b.com',
    '*.com',
    'a*.example.com',
    'claw.local:0',
    'claw.local:99999',
    '*.127.0.0.1',
    '::1',
  ])('rejects %j', (text) => {
    expect(typeof parseHostRule(text)).toBe('string');
  });

  it('lets a rule without a port reach 80 and 443 only', () => {
    const list = rules('claw.local');

    expect(matchingRule(new URL('https://claw.local/x'), list)).toBeDefined();
    expect(matchingRule(new URL('http://claw.local/x'), list)).toBeDefined();
    expect(matchingRule(new URL('https://claw.local:8443/x'), list)).toBeUndefined();
    expect(matchingRule(new URL('https://other.local/x'), list)).toBeUndefined();
  });

  it('matches a wildcard on subdomains only, not the bare name or a lookalike', () => {
    const list = rules('*.example.com');

    expect(matchingRule(new URL('https://api.example.com/'), list)).toBeDefined();
    expect(matchingRule(new URL('https://a.b.example.com/'), list)).toBeDefined();
    expect(matchingRule(new URL('https://example.com/'), list)).toBeUndefined();
    expect(matchingRule(new URL('https://evilexample.com/'), list)).toBeUndefined();
    expect(matchingRule(new URL('https://example.com.evil.io/'), list)).toBeUndefined();
  });

  it('matches an ip literal in any spelling the URL parser normalizes', () => {
    const list = rules('127.0.0.1:3000');

    expect(matchingRule(new URL('http://127.1:3000/'), list)).toBeDefined();
    expect(matchingRule(new URL('http://0x7f.0.0.1:3000/'), list)).toBeDefined();
    expect(matchingRule(new URL('http://[::ffff:7f00:1]:3000/'), list)).toBeDefined();
    expect(matchingRule(new URL('http://127.0.0.2:3000/'), list)).toBeUndefined();
  });

  it('has no default: nothing is allowed without a rule', () => {
    expect(matchingRule(new URL('http://127.0.0.1/'), [])).toBeUndefined();
  });
});

describe('url tricks that try to look like an allowed host', () => {
  const list = rules('claw.local');
  const refused = async (url: string): Promise<void> => {
    await expect(
      createHttpTool({
        rules: list,
        resolve: answers('93.184.216.34'),
        send: () => Promise.reject(new Error('must not be sent')),
      }).execute({ method: 'GET', url }),
    ).rejects.toThrow(/credentials|not an allowed host/u);
  };

  it.each([
    'http://claw.local@evil.example.com/',
    'http://evil.example.com#@claw.local/',
    String.raw`http://evil.example.com\@claw.local/`,
    'http://claw.local.evil.example.com/',
    'http://evilclaw.local/',
    'http://2130706433/',
    'http://0x7f000001/',
    'http://[::ffff:127.0.0.1]/',
    'http://clаw.local/',
  ])('refuses %s', refused);
});

describe('address classes', () => {
  it.each([
    ['8.8.8.8', 'public'],
    ['127.0.0.1', 'loopback'],
    ['::1', 'loopback'],
    ['::ffff:127.0.0.1', 'loopback'],
    ['::ffff:7f00:1', 'loopback'],
    ['10.1.2.3', 'private'],
    ['172.16.0.1', 'private'],
    ['172.32.0.1', 'public'],
    ['192.168.1.1', 'private'],
    ['100.64.0.1', 'private'],
    ['fd12::1', 'private'],
    ['169.254.169.254', 'blocked'],
    ['169.254.1.1', 'blocked'],
    ['::ffff:169.254.169.254', 'blocked'],
    ['fe80::1', 'blocked'],
    ['0.0.0.0', 'blocked'],
    ['::', 'blocked'],
    ['224.0.0.1', 'blocked'],
    ['fd00:ec2::254', 'blocked'],
    ['100.100.100.200', 'blocked'],
    ['2606:4700::1111', 'public'],
  ])('%s is %s', (address, expected) => {
    expect(classifyAddress(address)).toBe(expected);
  });

  it('gives one spelling per address', () => {
    expect(canonicalIp('::ffff:7f00:1')).toBe('127.0.0.1');
    expect(canonicalIp('[::1]')).toBe('0:0:0:0:0:0:0:1');
    expect(canonicalIp('nope')).toBeUndefined();
  });

  it('knows local names', () => {
    expect(isLocalName('claw.local')).toBe(true);
    expect(isLocalName('localhost')).toBe(true);
    expect(isLocalName('intranet')).toBe(true);
    expect(isLocalName('api.example.com')).toBe(false);
  });
});

describe('anti-rebinding: resolve once, compare, connect to that address', () => {
  it('refuses a public-looking name that resolves to loopback unless that address is listed', async () => {
    const list = rules('api.example.com');

    await expect(
      approveTarget(new URL('https://api.example.com/'), list, answers('127.0.0.1')),
    ).rejects.toThrow(/resolves to 127\.0\.0\.1, a loopback address that is not listed/u);
    await expect(
      approveTarget(new URL('https://api.example.com/'), list, answers('10.0.0.5')),
    ).rejects.toThrow(/private address/u);
  });

  it('allows it when the address is listed for that port', async () => {
    const list = rules('api.example.com', '127.0.0.1:443');
    const target = await approveTarget(
      new URL('https://api.example.com/'),
      list,
      answers('127.0.0.1'),
    );

    expect(target.address).toEqual({ address: '127.0.0.1', family: 4 });
  });

  it('allows a local name to resolve inside the machine, as claw.local does', async () => {
    const target = await approveTarget(
      new URL('https://claw.local/'),
      rules('claw.local'),
      answers('127.0.0.1'),
    );

    expect(target.address.address).toBe('127.0.0.1');
  });

  it('refuses when ANY answer is bad, so a mixed answer cannot be used to slip through', async () => {
    await expect(
      approveTarget(
        new URL('https://api.example.com/'),
        rules('api.example.com'),
        answers('93.184.216.34', '127.0.0.1'),
      ),
    ).rejects.toThrow(/loopback/u);
  });

  it('refuses the metadata address even when it is listed, as a literal or through DNS', async () => {
    const list = rules('169.254.169.254', 'api.example.com', 'claw.local');

    await expect(
      approveTarget(new URL('http://169.254.169.254/latest/meta-data/'), list, answers()),
    ).rejects.toThrow(/never reachable/u);
    await expect(
      approveTarget(new URL('https://api.example.com/'), list, answers('169.254.169.254')),
    ).rejects.toThrow(/never reachable/u);
    await expect(
      approveTarget(new URL('https://claw.local/'), list, answers('::ffff:a9fe:a9fe')),
    ).rejects.toThrow(/never reachable/u);
  });

  it('refuses a name that does not match any rule before resolving it', async () => {
    let asked = 0;
    const resolver: HttpResolver = () => {
      asked += 1;
      return Promise.resolve([]);
    };

    await expect(
      approveTarget(new URL('https://evil.example.com/'), rules('claw.local'), resolver),
    ).rejects.toThrow(/not an allowed host\. Allowed: claw\.local/u);
    expect(asked).toBe(0);
  });

  it('names the problem when nothing is listed', async () => {
    await expect(approveTarget(new URL('http://127.0.0.1:3000/'), [], answers())).rejects.toThrow(
      /Allowed: none/u,
    );
  });

  it('judges an ip literal on its own, never as a name', () => {
    expect(
      addressProblem(new URL('http://127.0.0.1:3000/'), '127.0.0.1', rules('127.0.0.1:3000')),
    ).toBeUndefined();
    expect(addressProblem(new URL('http://93.184.216.34/'), '93.184.216.34', [])).toBeUndefined();
  });
});

describe('anti-rebinding on the wire', () => {
  let server: TestServer;

  beforeAll(async () => {
    server = await startTestServer();
  });
  afterAll(async () => {
    await server.close();
  });

  it('connects to the address it approved, and asks DNS once per hop', async () => {
    let asked = 0;
    const resolve: HttpResolver = () => {
      asked += 1;
      // The first (and only) answer is the listed loopback address. A second
      // question would get a public one; the connection must never use it.
      return Promise.resolve(
        asked === 1
          ? [{ address: '127.0.0.1', family: 4 }]
          : [{ address: '93.184.216.34', family: 4 }],
      );
    };
    const tool = createHttpTool({
      rules: rules(`api.example.com:${String(server.port)}`, `127.0.0.1:${String(server.port)}`),
      resolve,
    });

    const result = (await tool.execute({
      method: 'GET',
      url: `http://api.example.com:${String(server.port)}/status/200`,
    })) as { ok: boolean; status: number };

    expect(result).toMatchObject({ ok: true, status: 200 });
    expect(asked).toBe(1);
  });

  it('refuses the same call when the name resolves to loopback and it is not listed', async () => {
    const tool = createHttpTool({
      rules: rules(`api.example.com:${String(server.port)}`),
      resolve: answers('127.0.0.1'),
    });

    await expect(
      tool.execute({
        method: 'GET',
        url: `http://api.example.com:${String(server.port)}/status/200`,
      }),
    ).rejects.toThrow(/not listed/u);
  });
});

describe('TLS', () => {
  const pair = selfSignedPair();
  let tls: TestServer | undefined;

  beforeAll(async () => {
    if (pair !== undefined) tls = await startTlsServer(pair);
  });
  afterAll(async () => {
    await tls?.close();
    pair?.dispose();
  });

  it.skipIf(pair === undefined)(
    'keeps verification on: a certificate nobody trusts is a result, not a pass',
    async () => {
      const port = tls?.port ?? 0;
      const tool = createHttpTool({ rules: rules(`127.0.0.1:${String(port)}`) });

      const result = (await tool.execute({
        method: 'GET',
        url: `https://127.0.0.1:${String(port)}/status/200`,
      })) as {
        ok: boolean;
        error: { code: string; message: string };
      };

      expect(result.ok).toBe(false);
      expect(result.error.code).toBe('TLS_VERIFICATION_FAILED');
      expect(result.error.message).toMatch(/NODE_EXTRA_CA_CERTS|use-system-ca/u);
    },
  );
});
