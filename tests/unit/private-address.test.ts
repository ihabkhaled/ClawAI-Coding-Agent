import { describe, expect, it } from 'vitest';

import { isPrivateAddress, isPrivateHostLiteral } from '../../src/core/private-address';

const literal = (url: string): boolean => isPrivateHostLiteral(new URL(url));

describe('isPrivateAddress', () => {
  it.each([
    '10.1.2.3',
    '172.16.0.1',
    '172.31.255.255',
    '192.168.1.1',
    '127.0.0.1',
    '127.8.8.8',
    '169.254.169.254',
    '100.64.0.1',
    '100.127.255.255',
    '0.0.0.0',
    '198.18.0.1',
    '255.255.255.255',
    '::',
    '::1',
    'fc00::1',
    'fd12:3456::1',
    'fe80::1',
    'fe80::1%eth0',
    'ff02::1',
    '::ffff:127.0.0.1',
    '::ffff:7f00:1',
    '::ffff:a9fe:a9fe',
    '64:ff9b::a00:1',
    '2002:c0a8:101::1',
    '::10.0.0.1',
  ])('refuses %s', (address) => {
    expect(isPrivateAddress(address)).toBe(true);
  });

  it.each([
    '8.8.8.8',
    '172.15.0.1',
    '172.32.0.1',
    '100.63.0.1',
    '100.128.0.1',
    '169.253.0.1',
    '1.1.1.1',
    '2606:4700:4700::1111',
    '::ffff:8.8.8.8',
    '2002:0808:0808::1',
    'not-an-ip',
    '1.2.3',
    '999.1.1.1',
    '1:2:3',
  ])('allows %s', (address) => {
    expect(isPrivateAddress(address)).toBe(false);
  });
});

describe('isPrivateHostLiteral', () => {
  it.each([
    'https://localhost/x',
    'https://LOCALHOST./x',
    'https://app.localhost/x',
    'https://printer.local/x',
    'https://db.internal/x',
    'https://[::1]/x',
    'https://[::ffff:127.0.0.1]/x',
    'https://[fe80::1]/x',
    'https://2130706433/x',
    'https://0177.0.0.1/x',
    'https://0x7f.1/x',
    'https://0x7f000001/x',
    'https://127.1/x',
    'https://169.254.169.254/latest',
    'https://10.0.0.5/x',
  ])('refuses %s', (url) => {
    expect(literal(url)).toBe(true);
  });

  it.each(['https://example.com/x', 'https://8.8.8.8/x', 'https://[2606:4700::1111]/x'])(
    'allows %s',
    (url) => {
      expect(literal(url)).toBe(false);
    },
  );
});
