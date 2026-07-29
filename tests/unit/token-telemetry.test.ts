import { describe, expect, it } from 'vitest';

import {
  addTokenReceipts,
  estimateTokens,
  reconcileTokenReceipt,
} from '../../src/core/token-telemetry';

describe('token telemetry', () => {
  it('labels deterministic UTF-8 estimates', () => {
    expect(estimateTokens('hello')).toEqual({
      input: 2,
      output: 0,
      source: 'estimated',
      total: 2,
    });
    expect(estimateTokens('')).toEqual({
      input: 0,
      output: 0,
      source: 'estimated',
      total: 0,
    });
  });

  it('reconciles estimates with authoritative provider usage', () => {
    expect(
      reconcileTokenReceipt(estimateTokens('hello'), {
        input: 3,
        output: 5,
      }),
    ).toEqual({
      input: 3,
      output: 5,
      source: 'reported',
      total: 8,
    });
  });

  it('adds receipts without presenting mixed estimates as reported usage', () => {
    expect(
      addTokenReceipts(
        { input: 3, output: 5, source: 'reported', total: 8 },
        { input: 2, output: 0, source: 'estimated', total: 2 },
      ),
    ).toEqual({
      input: 5,
      output: 5,
      source: 'estimated',
      total: 10,
    });
  });
});
