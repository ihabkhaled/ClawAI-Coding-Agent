import { describe, expect, it } from 'vitest';

import { assertFetchableUrl, webFetchSchema, webSearchSchema } from '../../src/core/web-research';

describe('webSearchSchema', () => {
  it('takes a query and optional bounds', () => {
    expect(webSearchSchema.parse({ query: 'zod refinements', maxResults: 5 })).toEqual({
      query: 'zod refinements',
      maxResults: 5,
    });
  });

  it('refuses an empty query rather than searching for nothing', () => {
    expect(webSearchSchema.safeParse({ query: '   ' }).success).toBe(false);
  });

  it('bounds how many results one call may ask for', () => {
    expect(webSearchSchema.safeParse({ query: 'a', maxResults: 500 }).success).toBe(false);
  });

  it('refuses arguments it does not advertise', () => {
    expect(webSearchSchema.safeParse({ query: 'a', headers: {} }).success).toBe(false);
  });
});

describe('webFetchSchema', () => {
  it('bounds the timeout a call may ask for', () => {
    expect(webFetchSchema.safeParse({ url: 'https://a.dev', timeoutMs: 10 }).success).toBe(false);
    expect(webFetchSchema.safeParse({ url: 'https://a.dev', timeoutMs: 5_000 }).success).toBe(true);
  });
});

describe('assertFetchableUrl', () => {
  it('accepts an ordinary web address', () => {
    expect(assertFetchableUrl('https://example.dev/docs').hostname).toBe('example.dev');
  });

  it('refuses a scheme that is not the web', () => {
    expect(() => assertFetchableUrl('file:///etc/passwd')).toThrow(/http and https/u);
    expect(() => assertFetchableUrl('ftp://example.dev')).toThrow(/http and https/u);
  });

  it('refuses something that is not a URL at all', () => {
    expect(() => assertFetchableUrl('example.dev/docs')).toThrow(/Not a URL/u);
  });

  it('refuses credentials rather than quietly stripping them', () => {
    expect(() => assertFetchableUrl('https://user:secret@example.dev')).toThrow(/credentials/u);
  });

  it('refuses loopback, which is the machine and not the web', () => {
    expect(() => assertFetchableUrl('http://localhost:3000/admin')).toThrow(/private address/u);
    expect(() => assertFetchableUrl('http://127.0.0.1/')).toThrow(/private address/u);
  });

  it('refuses private ranges', () => {
    expect(() => assertFetchableUrl('http://10.0.0.5/')).toThrow(/private address/u);
    expect(() => assertFetchableUrl('http://192.168.1.1/')).toThrow(/private address/u);
    expect(() => assertFetchableUrl('http://172.16.0.9/')).toThrow(/private address/u);
  });

  it('refuses the link-local range where cloud instance metadata lives', () => {
    expect(() => assertFetchableUrl('http://169.254.169.254/latest/meta-data/')).toThrow(
      /private address/u,
    );
  });

  it('allows a public address that merely looks close to a private one', () => {
    expect(assertFetchableUrl('http://172.32.0.1/').hostname).toBe('172.32.0.1');
    expect(assertFetchableUrl('http://11.0.0.1/').hostname).toBe('11.0.0.1');
  });
});
