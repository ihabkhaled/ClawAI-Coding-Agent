import type { DevicePairingLimits } from './device-pairing-flow.types';

/** At most 120 polls (the server expiry usually ends it first); five failures in a row end it. */
export const DEVICE_PAIRING_LIMITS: DevicePairingLimits = {
  maxPolls: 120,
  maxConsecutiveErrors: 5,
};

/** Longest wait between two polls after failures; the server interval applies again once one succeeds. */
export const DEVICE_PAIRING_MAX_BACKOFF_MS = 30_000;
