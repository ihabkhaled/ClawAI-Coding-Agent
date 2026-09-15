import { describe, expect, it, vi } from 'vitest';

vi.mock('vscode', () => ({
  l10n: { t: (message: string) => message },
  window: { showInformationMessage: vi.fn(async () => undefined) },
}));

import {
  disableFastMode,
  enableFastMode,
  FAST_MODE,
  FAST_MODE_FALLBACK,
  isFastMode,
} from '../../src/core/fast-mode';
import { toggleFastMode } from '../../src/services/fast-mode-command';

import type { FastModeSettings } from '../../src/core/fast-mode.types';

describe('isFastMode', () => {
  it('is on only when both levers are where Fast mode put them', () => {
    expect(isFastMode(FAST_MODE)).toBe(true);
    expect(isFastMode({ routingMode: 'LOW_LATENCY', speedMode: '1X' })).toBe(false);
    expect(isFastMode({ routingMode: 'AUTO', speedMode: '2X' })).toBe(false);
  });
});

describe('enableFastMode', () => {
  it('remembers what it is replacing', () => {
    const before: FastModeSettings = { routingMode: 'HIGH_REASONING', speedMode: '1.5X' };

    expect(enableFastMode(before)).toEqual({ apply: FAST_MODE, remember: before });
  });

  it('remembers the fallback rather than itself when it is already on', () => {
    expect(enableFastMode(FAST_MODE).remember).toEqual(FAST_MODE_FALLBACK);
  });
});

describe('disableFastMode', () => {
  it('puts back what was remembered', () => {
    const before: FastModeSettings = { routingMode: 'COST_SAVER', speedMode: '1X' };

    expect(disableFastMode(before)).toEqual(before);
  });

  it('falls back to automatic routing when nothing was remembered', () => {
    expect(disableFastMode(undefined)).toEqual(FAST_MODE_FALLBACK);
  });
});

describe('toggleFastMode', () => {
  function harness(current: FastModeSettings) {
    let settings = current;
    let memory: FastModeSettings | undefined;
    const apply = vi.fn(async (next: FastModeSettings) => {
      settings = next;
    });
    return {
      apply,
      dependencies: {
        current: () => settings,
        apply,
        remembered: () => memory,
        remember: async (next: FastModeSettings | undefined) => {
          memory = next;
        },
      },
      memory: () => memory,
      settings: () => settings,
    };
  }

  it('moves both levers when turned on', async () => {
    const seat = harness({ routingMode: 'MANUAL_MODEL', speedMode: '1X' });

    expect(await toggleFastMode(seat.dependencies)).toBe(true);
    expect(seat.settings()).toEqual(FAST_MODE);
  });

  it('puts back exactly what was there, and forgets it afterwards', async () => {
    const before: FastModeSettings = { routingMode: 'PRIVACY_FIRST', speedMode: '1.5X' };
    const seat = harness(before);
    await toggleFastMode(seat.dependencies);

    expect(await toggleFastMode(seat.dependencies)).toBe(false);
    expect(seat.settings()).toEqual(before);
    expect(seat.memory()).toBeUndefined();
  });

  it('restores the speed lever even when the routing lever was manual', async () => {
    const seat = harness({ routingMode: 'MANUAL_MODEL', speedMode: '1X' });
    await toggleFastMode(seat.dependencies);
    await toggleFastMode(seat.dependencies);

    expect(seat.settings()).toEqual({ routingMode: 'MANUAL_MODEL', speedMode: '1X' });
  });

  it('toggling from an already-fast state turns it off and lands on the fallback', async () => {
    const seat = harness(FAST_MODE);

    expect(await toggleFastMode(seat.dependencies)).toBe(false);
    expect(seat.settings()).toEqual(FAST_MODE_FALLBACK);
  });
});
