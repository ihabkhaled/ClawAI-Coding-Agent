import { isIP } from 'node:net';

import { HTTP_METADATA_ADDRESSES } from './http-tool.constants';

/** Where an address sits: public, inside this machine or network, or never allowed. */
export type HttpAddressClass = 'public' | 'loopback' | 'private' | 'blocked';

function dottedTail(part: string): number[] | undefined {
  const four = part.split('.').map(Number);
  if (four.length !== 4 || four.some((n) => !Number.isInteger(n) || n < 0 || n > 255)) {
    return undefined;
  }
  return [((four[0] ?? 0) << 8) + (four[1] ?? 0), ((four[2] ?? 0) << 8) + (four[3] ?? 0)];
}

function parseRun(text: string): number[] | undefined {
  if (text.length === 0) return [];
  const parts = text.split(':');
  const out: number[] = [];
  for (const [index, part] of parts.entries()) {
    if (part.includes('.') && index === parts.length - 1) {
      const tail = dottedTail(part);
      if (tail === undefined) return undefined;
      out.push(...tail);
    } else if (/^[0-9a-f]{1,4}$/iu.test(part)) {
      out.push(Number.parseInt(part, 16));
    } else {
      return undefined;
    }
  }
  return out;
}

function groupsOf(ipv6: string): number[] | undefined {
  const halves = (ipv6.split('%')[0] ?? '').split('::');
  if (halves.length > 2) return undefined;
  const head = parseRun(halves[0] ?? '');
  const tail = parseRun(halves[1] ?? '');
  if (head === undefined || tail === undefined) return undefined;
  if (halves.length === 1) return head.length === 8 ? head : undefined;
  const fill = 8 - head.length - tail.length;
  return fill < 1 ? undefined : [...head, ...new Array<number>(fill).fill(0), ...tail];
}

function dotted(high: number, low: number): string {
  return `${String(high >> 8)}.${String(high & 255)}.${String(low >> 8)}.${String(low & 255)}`;
}

/**
 * One spelling per address: dotted for IPv4 (an IPv4-mapped IPv6 address
 * included, so `::ffff:7f00:1` cannot slip past a check on 127.0.0.1), eight
 * hex groups for IPv6. `undefined` when the text is not an address.
 */
export function canonicalIp(raw: string): string | undefined {
  const text = raw.startsWith('[') && raw.endsWith(']') ? raw.slice(1, -1) : raw;
  const version = isIP(text);
  if (version === 4) return text;
  if (version !== 6) return undefined;
  const groups = groupsOf(text);
  if (groups === undefined) return undefined;
  const mapped = groups.slice(0, 5).every((g) => g === 0) && groups[5] === 0xffff;
  if (mapped) return dotted(groups[6] ?? 0, groups[7] ?? 0);
  return groups.map((g) => g.toString(16)).join(':');
}

const METADATA = new Set(HTTP_METADATA_ADDRESSES.map((address) => canonicalIp(address) ?? address));

/** IPv4 ranges inside a machine or network: [first octet, lowest second octet, highest]. */
const PRIVATE_V4: readonly (readonly [number, number, number])[] = [
  [10, 0, 255],
  [172, 16, 31],
  [192, 168, 168],
  [100, 64, 127],
];

function classifyV4(text: string): HttpAddressClass {
  const [a = 0, b = 0] = text.split('.').map(Number);
  if (a === 0 || a >= 224 || (a === 169 && b === 254)) return 'blocked';
  if (a === 127) return 'loopback';
  return PRIVATE_V4.some(([first, low, high]) => a === first && b >= low && b <= high)
    ? 'private'
    : 'public';
}

function classifyV6(canonical: string): HttpAddressClass {
  const first = Number.parseInt(canonical.split(':')[0] ?? '0', 16);
  if (canonical === '0:0:0:0:0:0:0:0') return 'blocked';
  if (canonical === '0:0:0:0:0:0:0:1') return 'loopback';
  if (first >= 0xff00 || (first >= 0xfe80 && first <= 0xfebf)) return 'blocked';
  if (first >= 0xfc00 && first <= 0xfdff) return 'private';
  return 'public';
}

/**
 * The class of an address. Link-local, multicast, unspecified and the cloud
 * metadata addresses are `blocked`: no allow rule opens them.
 */
export function classifyAddress(raw: string): HttpAddressClass {
  const canonical = canonicalIp(raw);
  if (canonical === undefined || METADATA.has(canonical)) return 'blocked';
  return isIP(canonical) === 4 ? classifyV4(canonical) : classifyV6(canonical);
}
