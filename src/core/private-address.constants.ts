/** [first, last] of each blocked IPv4 range, as unsigned 32-bit integers. */
export const PRIVATE_IPV4_RANGES: readonly (readonly [number, number])[] = [
  [0x00000000, 0x00ffffff], // 0.0.0.0/8 unspecified
  [0x0a000000, 0x0affffff], // 10/8
  [0x64400000, 0x647fffff], // 100.64/10 shared address space
  [0x7f000000, 0x7fffffff], // 127/8 loopback
  [0xa9fe0000, 0xa9feffff], // 169.254/16 link-local and metadata
  [0xac100000, 0xac1fffff], // 172.16/12
  [0xc0a80000, 0xc0a8ffff], // 192.168/16
  [0xc6120000, 0xc613ffff], // 198.18/15 benchmarking
  [0xe0000000, 0xffffffff], // multicast, reserved, broadcast
];

/** IPv6 groups (16 bits each) in a full address. */
export const IPV6_GROUP_COUNT = 8;
