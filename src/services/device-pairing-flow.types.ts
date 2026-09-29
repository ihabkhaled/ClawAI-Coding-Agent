import type { PairingPoll, PairingStart } from '../backend/device-pairing-client';

export type DevicePairingOutcome = 'approved' | 'denied' | 'expired' | 'cancelled' | 'failed';

export interface DevicePairingTokens {
  readonly accessToken: string;
  readonly refreshToken: string;
  readonly expiresIn: number;
}

export interface DevicePairingPorts {
  start(): Promise<PairingStart>;
  poll(pairingCode: string, signal: AbortSignal): Promise<PairingPoll>;
  /** Show the verification link to open on a phone. Never the tokens. */
  present(start: PairingStart): void;
  store(tokens: DevicePairingTokens): Promise<void>;
  sleep(ms: number, signal: AbortSignal): Promise<void>;
  now(): number;
}

export interface DevicePairingLimits {
  readonly maxPolls: number;
  readonly maxConsecutiveErrors: number;
}
