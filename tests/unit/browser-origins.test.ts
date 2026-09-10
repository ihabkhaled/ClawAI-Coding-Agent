import { describe, expect, it } from 'vitest';

import { browserAllowedOrigins, parseAllowedOrigins } from '../../src/core/browser-origins';

describe('parseAllowedOrigins', () => {
  it('reduces a URL to its origin', () => {
    expect(parseAllowedOrigins(['https://docs.example.com/guide/page?x=1#y'])).toEqual([
      'https://docs.example.com',
    ]);
  });

  it('keeps a port, which is what makes a dev server a different origin', () => {
    expect(parseAllowedOrigins(['http://localhost:3000'])).toEqual(['http://localhost:3000']);
  });

  it('allows loopback and private addresses, which the web tool refuses', () => {
    expect(parseAllowedOrigins(['http://127.0.0.1:8080', 'http://192.168.1.10'])).toEqual([
      'http://127.0.0.1:8080',
      'http://192.168.1.10',
    ]);
  });

  it('refuses a scheme a browser cannot be pointed at', () => {
    expect(
      parseAllowedOrigins(['file:///etc/passwd', 'javascript:alert(1)', 'ftp://x.test']),
    ).toEqual([]);
  });

  it('refuses a URL carrying credentials rather than storing them in settings', () => {
    expect(parseAllowedOrigins(['https://user:secret@internal.test'])).toEqual([]);
  });

  it('skips entries that are not URLs at all instead of failing the whole list', () => {
    expect(parseAllowedOrigins(['not a url', '', '   ', 'https://ok.test'])).toEqual([
      'https://ok.test',
    ]);
  });

  it('collapses entries that mean the same origin', () => {
    expect(parseAllowedOrigins(['https://a.test/one', 'https://a.test/two'])).toEqual([
      'https://a.test',
    ]);
  });
});

describe('browserAllowedOrigins', () => {
  it('keeps the built-ins first and adds what the workspace configured', () => {
    expect(browserAllowedOrigins(['https://claw.local'], ['http://localhost:3000'])).toEqual([
      'https://claw.local',
      'http://localhost:3000',
    ]);
  });

  it('cannot be used to remove a built-in origin', () => {
    const allowed = browserAllowedOrigins(['https://claw.local'], []);

    expect(allowed).toContain('https://claw.local');
  });

  it('does not repeat an origin the built-ins already carry', () => {
    expect(browserAllowedOrigins(['https://claw.local'], ['https://claw.local/app'])).toEqual([
      'https://claw.local',
    ]);
  });
});
