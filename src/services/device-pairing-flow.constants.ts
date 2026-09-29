import type { DevicePairingLimits } from './device-pairing-flow.types';

/** At most 120 polls (the server expiry usually ends it first); five failures in a row end it. */
export const DEVICE_PAIRING_LIMITS: DevicePairingLimits = {
  maxPolls: 120,
  maxConsecutiveErrors: 5,
};
