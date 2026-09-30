import { IPV6_GROUP_COUNT, PRIVATE_IPV4_RANGES } from './private-address.constants';

/**
 * Whether a host or address points inside the user's own machine or network.
 *
 * A plugin source that resolves there is a way to make the extension probe
 * intranet services or cloud metadata endpoints. Pure: DNS is somebody else's job.
 */

const IPV4_PART = /^\d{1,3}$/u;
const HEX_GROUP = /^[0-9a-f]{1,4}$/iu;

function parseIpv4(text: string): number[] | undefined {
  const parts = text.split('.');
  if (parts.length !== 4 || !parts.every((part) => IPV4_PART.test(part))) return undefined;
  const octets = parts.map(Number);
  return octets.every((octet) => octet <= 255) ? octets : undefined;
}

/** Loopback, private, link-local, shared (CGNAT), benchmarking, unspecified and reserved IPv4. */
export function isPrivateIpv4(text: string): boolean {
  const octets = parseIpv4(text);
  if (octets === undefined) return false;
  const [a = 0, b = 0, c = 0, d = 0] = octets;
  const value = ((a * 256 + b) * 256 + c) * 256 + d;
  return PRIVATE_IPV4_RANGES.some(([first, last]) => value >= first && value <= last);
}

function hexGroups(pieces: readonly string[]): number[] | undefined {
  const groups = pieces.map((piece) => (HEX_GROUP.test(piece) ? parseInt(piece, 16) : NaN));
  return groups.some(Number.isNaN) ? undefined : groups;
}

function tailGroups(tail: string): number[] | undefined {
  if (tail === '') return [];
  const pieces = tail.split(':');
  const last = pieces.at(-1) ?? '';
  if (!last.includes('.')) return hexGroups(pieces);
  const [a = 0, b = 0, c = 0, d = 0] = parseIpv4(last) ?? [];
  const head = hexGroups(pieces.slice(0, -1));
  return parseIpv4(last) === undefined || head === undefined
    ? undefined
    : [...head, a * 256 + b, c * 256 + d];
}

function parseIpv6(text: string): number[] | undefined {
  const bare = text.replace(/^\[|\]$/gu, '').split('%')[0] ?? '';
  const halves = bare.split('::');
  if (halves.length > 2 || !bare.includes(':')) return undefined;
  const head = tailGroups(halves[0] ?? '');
  const rest = tailGroups(halves[1] ?? '');
  if (head === undefined || rest === undefined) return undefined;
  if (halves.length === 1) return head.length === IPV6_GROUP_COUNT ? head : undefined;
  const fill = IPV6_GROUP_COUNT - head.length - rest.length;
  return fill < 1 ? undefined : [...head, ...new Array<number>(fill).fill(0), ...rest];
}

function embeddedIpv4(high: number, low: number): string {
  return `${String(high >> 8)}.${String(high & 255)}.${String(low >> 8)}.${String(low & 255)}`;
}

function isReservedIpv6(groups: readonly number[]): boolean {
  const [g0 = 0, , , , , , , g7 = 0] = groups;
  const unspecifiedOrLoopback = groups.slice(0, 7).every((g) => g === 0) && g7 <= 1;
  const uniqueLocal = (g0 & 0xfe00) === 0xfc00;
  const linkLocal = (g0 & 0xffc0) === 0xfe80;
  const multicast = (g0 & 0xff00) === 0xff00;
  return unspecifiedOrLoopback || uniqueLocal || linkLocal || multicast;
}

function isMappedPrefix(groups: readonly number[]): boolean {
  const zeroPrefix = groups.slice(0, 5).every((g) => g === 0);
  return zeroPrefix && (groups[5] === 0xffff || groups[5] === 0);
}

/** The IPv4 an IPv6 address wraps (mapped, compatible, NAT64, 6to4), if it wraps one. */
function wrappedIpv4(groups: readonly number[]): string | undefined {
  const [g0 = 0, g1 = 0, g2 = 0, , , , g6 = 0, g7 = 0] = groups;
  if (isMappedPrefix(groups) || (g0 === 0x64 && g1 === 0xff9b)) return embeddedIpv4(g6, g7);
  return g0 === 0x2002 ? embeddedIpv4(g1, g2) : undefined;
}

/** Loopback, unspecified, unique-local, link-local, and any IPv6 form that wraps a private IPv4. */
export function isPrivateIpv6(text: string): boolean {
  const groups = parseIpv6(text);
  if (groups === undefined) return false;
  if (isReservedIpv6(groups)) return true;
  const wrapped = wrappedIpv4(groups);
  return wrapped !== undefined && isPrivateIpv4(wrapped);
}

/** A resolved address, either family. */
export function isPrivateAddress(address: string): boolean {
  return address.includes(':') ? isPrivateIpv6(address) : isPrivateIpv4(address);
}

/**
 * The literal host of a URL. `URL` has already folded decimal, octal and hex
 * IPv4 spellings (`2130706433`, `0177.1`, `0x7f.1`) to dotted form, so this sees
 * one canonical shape.
 */
export function isPrivateHostLiteral(url: URL): boolean {
  const host = url.hostname.toLowerCase().replace(/\.$/u, '');
  if (host === '') return true;
  if (host === 'localhost' || host.endsWith('.localhost')) return true;
  if (host.endsWith('.local') || host.endsWith('.internal')) return true;
  return isPrivateAddress(host);
}
