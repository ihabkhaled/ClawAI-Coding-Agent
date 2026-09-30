import { describe, expect, it } from 'vitest';

import {
  describeRejection,
  installUnhandledRejectionGuard,
  isGuardInstalled,
  recordUnhandledRejection,
  takeUnhandledRejections,
} from '../helpers/unhandled-rejection-guard';

describe('unhandled rejection guard', () => {
  it('is installed once by the vitest setup', () => {
    expect(isGuardInstalled()).toBe(true);
    expect(installUnhandledRejectionGuard()).toBe(false);
  });

  it('collects reasons and clears them when taken', () => {
    recordUnhandledRejection(new Error('leaked'));
    expect(takeUnhandledRejections().map(describeRejection)).toEqual(['Error: leaked']);
    expect(takeUnhandledRejections()).toEqual([]);
  });

  it('describes a non-error reason', () => {
    expect(describeRejection('plain')).toBe('plain');
  });
});
