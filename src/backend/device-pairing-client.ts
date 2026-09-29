import { z } from 'zod';

import type { AgentKeyRequester } from './agent-remote-client';

export const pairingStartSchema = z
  .object({
    pairingCode: z.string().min(8).max(200),
    verificationUrl: z.url().max(2_048),
    expiresAt: z.string().min(1),
    intervalSeconds: z.number().int().min(1).max(60),
  })
  .loose();

export type PairingStart = z.infer<typeof pairingStartSchema>;

export const pairingPollSchema = z
  .object({
    status: z.enum(['pending', 'approved', 'denied', 'expired']),
    tokens: z
      .object({
        accessToken: z.string().min(1),
        refreshToken: z.string().min(1),
        expiresIn: z.number(),
      })
      .loose()
      .optional(),
  })
  .loose();

export type PairingPoll = z.infer<typeof pairingPollSchema>;

export interface PairingDeviceHint {
  readonly name: string;
  readonly hostname: string;
  readonly os: 'darwin' | 'linux' | 'windows';
  readonly platform: string;
  readonly agentVersion: string;
}

/**
 * F097 client half of the public pairing routes. The device being paired
 * starts the request and polls; a signed-in person approves it elsewhere,
 * typically on a phone browser at the verification link.
 */
export const devicePairingClient = {
  start(request: AgentKeyRequester, deviceHint: PairingDeviceHint): Promise<PairingStart> {
    return request('/agent/auth/pair/init', pairingStartSchema, null, {
      method: 'POST',
      body: { deviceHint },
    });
  },

  poll(
    request: AgentKeyRequester,
    pairingCode: string,
    signal?: AbortSignal,
  ): Promise<PairingPoll> {
    return request(
      `/agent/auth/pair/poll?pairingCode=${encodeURIComponent(pairingCode)}`,
      pairingPollSchema,
      null,
      { method: 'POST', ...(signal === undefined ? {} : { signal }) },
    );
  },
};
