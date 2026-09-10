import { describe, expect, it } from 'vitest';

import { flagshipRequestSchema } from '../../src/core/flagship-delivery';
import {
  flagshipStrategySchema,
  isSuggestedFlagshipStrategy,
} from '../../src/core/flagship-strategy';
import { FLAGSHIP_SUGGESTED_STRATEGIES } from '../../src/core/flagship-strategy.constants';

function request(strategy: unknown): unknown {
  return {
    deliveryId: 'delivery-0001',
    runId: 'runtime-0001',
    goal: 'Ship the thing',
    strategy,
    repositories: ['.'],
    budget: {
      maxRuntimeMs: 600_000,
      maxStageAttempts: 2,
      maxModelTurns: 20,
      maxToolCalls: 40,
      maxSubAgents: 3,
    },
  };
}

describe('flagshipStrategySchema', () => {
  it('still accepts every strategy the closed list used to allow', () => {
    for (const strategy of FLAGSHIP_SUGGESTED_STRATEGIES) {
      expect(flagshipStrategySchema.parse(strategy)).toBe(strategy);
    }
  });

  it('accepts a real strategy the five names never covered', () => {
    expect(flagshipStrategySchema.parse('security-hardening')).toBe('security-hardening');
    expect(flagshipStrategySchema.parse('data-migration')).toBe('data-migration');
  });

  it('normalizes case and surrounding space, so one intent is one identity', () => {
    expect(flagshipStrategySchema.parse('  Incident-Fix  ')).toBe('incident-fix');
  });

  it('refuses spellings that would hash as different deliveries', () => {
    for (const spelling of [
      '-leading',
      'trailing-',
      'double--hyphen',
      'has space',
      'under_score',
    ]) {
      expect(() => flagshipStrategySchema.parse(spelling)).toThrow();
    }
  });

  it('refuses a name too short to mean anything and one too long to show', () => {
    expect(() => flagshipStrategySchema.parse('ab')).toThrow();
    expect(() => flagshipStrategySchema.parse('a'.repeat(61))).toThrow();
  });
});

describe('isSuggestedFlagshipStrategy', () => {
  it('can still tell a familiar strategy from a new one', () => {
    expect(isSuggestedFlagshipStrategy('incident-fix')).toBe(true);
    expect(isSuggestedFlagshipStrategy('security-hardening')).toBe(false);
  });

  it('does not turn that distinction into a refusal', () => {
    expect(() => flagshipStrategySchema.parse('security-hardening')).not.toThrow();
  });
});

describe('flagshipRequestSchema', () => {
  it('accepts a delivery whose strategy is not one of the five', () => {
    const parsed = flagshipRequestSchema.parse(request('security-hardening'));

    expect(parsed.strategy).toBe('security-hardening');
  });

  it('still refuses a malformed strategy', () => {
    expect(() => flagshipRequestSchema.parse(request('Not A Slug'))).toThrow();
  });
});
