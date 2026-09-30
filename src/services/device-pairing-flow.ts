import {
  DEVICE_PAIRING_LIMITS,
  DEVICE_PAIRING_MAX_BACKOFF_MS,
} from './device-pairing-flow.constants';

import type {
  DevicePairingLimits,
  DevicePairingOutcome,
  DevicePairingPorts,
} from './device-pairing-flow.types';
import type { PairingPoll } from '../backend/device-pairing-client';

/**
 * F097: pair this editor as a device approved from another screen, usually a
 * phone. Polling honours the server interval, ends at the server expiry, and
 * is capped both in attempts and in consecutive errors.
 */
export async function runDevicePairing(
  ports: DevicePairingPorts,
  signal: AbortSignal,
  limits: DevicePairingLimits = DEVICE_PAIRING_LIMITS,
): Promise<DevicePairingOutcome> {
  const start = await ports.start();
  ports.present(start);
  const deadline = Date.parse(start.expiresAt);
  const intervalMs = start.intervalSeconds * 1_000;
  let errors = 0;
  for (let attempt = 0; attempt < limits.maxPolls; attempt += 1) {
    await ports.sleep(Math.min(intervalMs * 2 ** errors, DEVICE_PAIRING_MAX_BACKOFF_MS), signal);
    if (signal.aborted) return 'cancelled';
    if (Number.isFinite(deadline) && ports.now() >= deadline) return 'expired';
    const result = await pollOnce(ports, start.pairingCode, signal);
    if (result === 'error') {
      errors += 1;
      if (errors >= limits.maxConsecutiveErrors) return 'failed';
      continue;
    }
    errors = 0;
    if (result !== 'pending') return result;
  }
  return 'expired';
}

async function pollOnce(
  ports: DevicePairingPorts,
  pairingCode: string,
  signal: AbortSignal,
): Promise<DevicePairingOutcome | 'pending' | 'error'> {
  let response: PairingPoll;
  try {
    response = await ports.poll(pairingCode, signal);
  } catch {
    return signal.aborted ? 'cancelled' : 'error';
  }
  if (response.status === 'approved') {
    if (response.tokens === undefined) return 'pending';
    await ports.store(response.tokens);
    return 'approved';
  }
  return response.status;
}
