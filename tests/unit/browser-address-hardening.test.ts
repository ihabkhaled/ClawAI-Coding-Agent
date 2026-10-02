import { describe, expect, it } from 'vitest';

import { addressProblem, isLocalHost, normalizedHost } from '../../src/sdk/browser-tool-url';
import { classifyAddress } from '../../src/sdk/http-address';

const check = (url: string, allowHosts: string[] = []) =>
  addressProblem(new URL(url), { allowHosts, navigation: true });

describe('browser address check: spellings of this machine', () => {
  it('treats a trailing dot as the same host', () => {
    expect(normalizedHost('LocalHost.')).toBe('localhost');
    expect(isLocalHost('localhost.')).toBe(true);
    expect(isLocalHost('claw.local.')).toBe(true);
    expect(check('http://localhost./')).toContain('private or local');
    expect(check('http://localhost.:3000/')).toContain('private or local');
    expect(check('http://app.localhost./')).toContain('private or local');
  });

  it('keeps a listed host working with or without the dot', () => {
    expect(check('http://localhost./', ['localhost'])).toBeUndefined();
    expect(check('http://localhost/', ['localhost.'])).toBeUndefined();
  });

  it('matches host:port entries on a default port too', () => {
    expect(check('https://claw.local/', ['claw.local:443'])).toBeUndefined();
    expect(check('http://claw.local/', ['claw.local:443'])).toContain('private or local');
    expect(check('http://claw.local:8080/', ['claw.local:8080'])).toBeUndefined();
  });

  it.each([
    'http://198.18.0.1/',
    'http://[::7f00:1]/',
    'http://[64:ff9b::a00:1]/',
    'http://[2002:c0a8:101::1]/',
    'http://[fec0::1]/',
  ])('refuses %s', (url) => {
    expect(check(url)).toContain('private or local');
  });

  it('still opens a public address', () => {
    expect(check('https://example.com/')).toBeUndefined();
    expect(check('http://93.184.216.34/')).toBeUndefined();
  });
});

describe('address classes: IPv4 inside IPv6', () => {
  it.each([
    ['::7f00:1', 'loopback'],
    ['64:ff9b::7f00:1', 'loopback'],
    ['64:ff9b::a00:1', 'private'],
    ['2002:7f00:1::', 'loopback'],
    ['2002:a9fe:a9fe::', 'blocked'],
    ['64:ff9b::808:808', 'public'],
    ['2606:4700::1111', 'public'],
    ['fec0::1', 'private'],
    ['198.18.5.5', 'private'],
    ['198.20.0.1', 'public'],
  ])('%s is %s', (address, expected) => {
    expect(classifyAddress(address)).toBe(expected);
  });
});
