import { describe, expect, it } from 'vitest';

import {
  addressProblem,
  assertBrowsableUrl,
  parseAllowHosts,
} from '../../src/sdk/browser-tool-url';

describe('browser address check', () => {
  it('lets public http and https pages through', () => {
    expect(assertBrowsableUrl('https://example.com/a?b=1', []).hostname).toBe('example.com');
    expect(assertBrowsableUrl('http://example.org', []).protocol).toBe('http:');
  });

  it.each([
    ['file:///etc/hosts', /Only http/u],
    ['javascript:alert(1)', /Only http/u],
    ['data:text/html,<h1>x</h1>', /does not open data:/u],
    ['ftp://example.com/', /Only http/u],
    ['https://user:pass@example.com/', /credentials/u],
    ['https://user@example.com/', /credentials/u],
    ['not a url', /Not a URL/u],
    ['', /needs a "url"/u],
  ])('refuses %s', (raw, message) => {
    expect(() => assertBrowsableUrl(raw, ['127.0.0.1'])).toThrow(message);
  });

  it.each([
    'http://localhost:3000/',
    'http://127.0.0.1/',
    'http://127.1/',
    'http://2130706433/',
    'http://0x7f.0.0.1/',
    'http://10.0.0.5/',
    'http://192.168.1.1/',
    'http://172.20.0.1/',
    'http://169.254.169.254/latest',
    'http://100.64.0.1/',
    'http://0.0.0.0/',
    'http://[::1]/',
    'http://[::ffff:7f00:1]/',
    'https://claw.local/',
    'http://intranet/',
    'http://service.internal/',
    'http://app.localhost/',
  ])('refuses the private host in %s until it is allowed', (raw) => {
    expect(() => assertBrowsableUrl(raw, [])).toThrow(/--browser-allow-host/u);
  });

  it('allows a private host the operator listed, and only that one', () => {
    expect(assertBrowsableUrl('https://claw.local/login', ['claw.local']).hostname).toBe(
      'claw.local',
    );
    expect(() => assertBrowsableUrl('http://127.0.0.1/', ['claw.local'])).toThrow(/private/u);
    expect(() => assertBrowsableUrl('https://other.local/', ['claw.local'])).toThrow(/private/u);
  });

  it('can pin an allowed host to a port', () => {
    expect(assertBrowsableUrl('http://127.0.0.1:8080/', ['127.0.0.1:8080']).port).toBe('8080');
    expect(() => assertBrowsableUrl('http://127.0.0.1:9090/', ['127.0.0.1:8080'])).toThrow(
      /private/u,
    );
  });

  it('lets a page use inline resources, but never navigate to them', () => {
    const data = new URL('data:image/png;base64,AAAA');
    expect(addressProblem(data, { allowHosts: [], navigation: false })).toBeUndefined();
    expect(addressProblem(data, { allowHosts: [], navigation: true })).toMatch(/data:/u);
  });

  it('reads allowed hosts from comma lists and refuses a URL given as a host', () => {
    expect(parseAllowHosts(['a.local,b.local', ' c.local '])).toEqual([
      'a.local',
      'b.local',
      'c.local',
    ]);
    expect(() => parseAllowHosts(['http://a.local/'])).toThrow(/host name/u);
    expect(() => parseAllowHosts(['user@a.local'])).toThrow(/host name/u);
  });
});
