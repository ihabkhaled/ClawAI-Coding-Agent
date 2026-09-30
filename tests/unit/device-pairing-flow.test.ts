import { describe, expect, it, vi } from 'vitest';

import { runDevicePairing } from '../../src/services/device-pairing-flow';

import type { PairingPoll, PairingStart } from '../../src/backend/device-pairing-client';
import type { DevicePairingPorts } from '../../src/services/device-pairing-flow.types';

const START: PairingStart = {
  pairingCode: 'p'.repeat(43),
  verificationUrl: 'https://claw.local/agent/connect?pairingCode=abc',
  expiresAt: '2026-09-29T00:02:00.000Z',
  intervalSeconds: 2,
};

const TOKENS = { accessToken: 'access', refreshToken: 'refresh', expiresIn: 900 };

function ports(
  answers: (PairingPoll | Error)[],
  now = Date.parse('2026-09-29T00:00:00.000Z'),
): DevicePairingPorts & { store: ReturnType<typeof vi.fn>; present: ReturnType<typeof vi.fn> } {
  let index = 0;
  return {
    start: () => Promise.resolve(START),
    poll: () => {
      const answer = answers[index] ?? { status: 'pending' };
      index += 1;
      return answer instanceof Error ? Promise.reject(answer) : Promise.resolve(answer);
    },
    present: vi.fn<(start: PairingStart) => void>(),
    store: vi.fn<DevicePairingPorts['store']>(() => Promise.resolve()),
    sleep: () => Promise.resolve(),
    now: () => now,
  };
}

describe('runDevicePairing', () => {
  it('presents the link, stores tokens once approved, and never presents tokens', async () => {
    const p = ports([{ status: 'pending' }, { status: 'approved', tokens: TOKENS }]);
    const outcome = await runDevicePairing(p, new AbortController().signal);
    expect(outcome).toBe('approved');
    expect(p.present).toHaveBeenCalledWith(START);
    expect(p.store).toHaveBeenCalledWith(TOKENS);
  });

  it('returns denied and expired as the server reports them', async () => {
    expect(
      await runDevicePairing(ports([{ status: 'denied' }]), new AbortController().signal),
    ).toBe('denied');
    expect(
      await runDevicePairing(ports([{ status: 'expired' }]), new AbortController().signal),
    ).toBe('expired');
  });

  it('stops at the server expiry without polling', async () => {
    const p = ports([], Date.parse('2026-09-29T00:05:00.000Z'));
    const poll = vi.spyOn(p, 'poll');
    expect(await runDevicePairing(p, new AbortController().signal)).toBe('expired');
    expect(poll).not.toHaveBeenCalled();
  });

  it('gives up after consecutive poll errors but tolerates isolated ones', async () => {
    const error = new Error('network');
    const limits = { maxPolls: 20, maxConsecutiveErrors: 3 };
    expect(
      await runDevicePairing(ports([error, error, error]), new AbortController().signal, limits),
    ).toBe('failed');
    expect(
      await runDevicePairing(
        ports([error, error, { status: 'pending' }, error, { status: 'denied' }]),
        new AbortController().signal,
        limits,
      ),
    ).toBe('denied');
  });

  it('is bounded by the poll cap and honours cancellation', async () => {
    expect(
      await runDevicePairing(ports([]), new AbortController().signal, {
        maxPolls: 3,
        maxConsecutiveErrors: 3,
      }),
    ).toBe('expired');
    const controller = new AbortController();
    controller.abort();
    expect(await runDevicePairing(ports([]), controller.signal)).toBe('cancelled');
  });

  it('keeps waiting when approval arrives without tokens', async () => {
    const p = ports([{ status: 'approved' }, { status: 'approved', tokens: TOKENS }]);
    expect(await runDevicePairing(p, new AbortController().signal)).toBe('approved');
    expect(p.store).toHaveBeenCalledTimes(1);
  });

  it('backs off after failed polls and returns to the server interval once one succeeds', async () => {
    const answers = [
      new Error('a'),
      new Error('b'),
      new Error('c'),
      { status: 'pending' as const },
    ];
    const p = ports([...answers, { status: 'denied' }]);
    const waits: number[] = [];
    p.sleep = (ms) => {
      waits.push(ms);
      return Promise.resolve();
    };
    await runDevicePairing(p, new AbortController().signal);
    expect(waits).toEqual([2_000, 4_000, 8_000, 16_000, 2_000]);
  });

  it('caps the back-off', async () => {
    const p = ports([new Error('a'), new Error('b'), new Error('c'), new Error('d')]);
    const waits: number[] = [];
    p.sleep = (ms) => {
      waits.push(ms);
      return Promise.resolve();
    };
    await runDevicePairing(p, new AbortController().signal, {
      maxPolls: 10,
      maxConsecutiveErrors: 5,
    });
    expect(Math.max(...waits)).toBeLessThanOrEqual(30_000);
  });
});
