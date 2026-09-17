import { describe, expect, it } from 'vitest';

import { outcomePayloadSchema } from '../../src/core/runtime/runtime-event-outcome.schema';

/**
 * The bounds on a finished call's summary.
 *
 * An event payload is untrusted at the boundary even when this build produced
 * it: a resumed journal may carry events an older build wrote, and a run that
 * recovers reads them back. Bounds are what stop a stored event from putting
 * an unbounded string into the panel.
 */
describe('outcomePayloadSchema', () => {
  it('accepts each kind the summariser can produce', () => {
    for (const kind of ['count', 'code', 'reason', 'none']) {
      expect(
        outcomePayloadSchema.safeParse({ kind, label: '', value: 0, reason: '' }).success,
      ).toBe(true);
    }
  });

  it('refuses a kind it does not know', () => {
    expect(
      outcomePayloadSchema.safeParse({ kind: 'bytes', label: '', value: 0, reason: '' }).success,
    ).toBe(false);
  });

  it('accepts a negative exit status, because a signal reports one', () => {
    expect(
      outcomePayloadSchema.safeParse({ kind: 'code', label: '', value: -1, reason: '' }).success,
    ).toBe(true);
  });

  it('refuses a fractional value', () => {
    expect(
      outcomePayloadSchema.safeParse({ kind: 'code', label: '', value: 1.5, reason: '' }).success,
    ).toBe(false);
  });

  it('bounds the label and the reason', () => {
    expect(
      outcomePayloadSchema.safeParse({
        kind: 'count',
        label: 'x'.repeat(81),
        value: 0,
        reason: '',
      }).success,
    ).toBe(false);
    expect(
      outcomePayloadSchema.safeParse({
        kind: 'reason',
        label: '',
        value: 0,
        reason: 'x'.repeat(201),
      }).success,
    ).toBe(false);
  });

  it('refuses an unknown field rather than carrying it into the panel', () => {
    expect(
      outcomePayloadSchema.safeParse({ kind: 'none', label: '', value: 0, reason: '', extra: 1 })
        .success,
    ).toBe(false);
  });

  it('requires every field, so a partial summary cannot be half-rendered', () => {
    expect(outcomePayloadSchema.safeParse({ kind: 'code' }).success).toBe(false);
  });
});
