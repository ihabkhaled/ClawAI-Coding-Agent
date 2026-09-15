import { describe, expect, it } from 'vitest';

import {
  notificationReasonForStateChange,
  userNotificationInputSchema,
  type NotifiableState,
} from '../../src/core/user-notification';

const idle: NotifiableState = {
  approvalRequestId: undefined,
  questionRequestId: undefined,
  busy: false,
  lastError: undefined,
};

describe('notificationReasonForStateChange', () => {
  it('says nothing while the window has focus', () => {
    const next = { ...idle, approvalRequestId: 'approval-1' };

    expect(notificationReasonForStateChange(idle, next, true)).toBeUndefined();
  });

  it('reports a newly raised approval', () => {
    const next = { ...idle, approvalRequestId: 'approval-1' };

    expect(notificationReasonForStateChange(idle, next, false)).toBe('approval');
  });

  it('reports a newly raised question', () => {
    const next = { ...idle, questionRequestId: 'question-1' };

    expect(notificationReasonForStateChange(idle, next, false)).toBe('question');
  });

  it('does not repeat an approval that was already on screen', () => {
    const standing = { ...idle, approvalRequestId: 'approval-1' };

    expect(notificationReasonForStateChange(standing, standing, false)).toBeUndefined();
  });

  it('reports the next approval when one replaces another', () => {
    const first = { ...idle, approvalRequestId: 'approval-1' };
    const second = { ...idle, approvalRequestId: 'approval-2' };

    expect(notificationReasonForStateChange(first, second, false)).toBe('approval');
  });

  it('reports a run that finished while the user was away', () => {
    expect(notificationReasonForStateChange({ ...idle, busy: true }, idle, false)).toBe(
      'completion',
    );
  });

  it('says nothing when a run is still going', () => {
    const busy = { ...idle, busy: true };

    expect(notificationReasonForStateChange(busy, busy, false)).toBeUndefined();
  });

  it('prefers the failure over the completion that lands with it', () => {
    const before = { ...idle, busy: true };
    const after = { ...idle, busy: false, lastError: 'Provider unavailable' };

    expect(notificationReasonForStateChange(before, after, false)).toBe('failure');
  });

  it('prefers a blocking approval over a result that already landed', () => {
    const before = { ...idle, busy: true };
    const after = { ...idle, busy: false, approvalRequestId: 'approval-1' };

    expect(notificationReasonForStateChange(before, after, false)).toBe('approval');
  });

  it('does not repeat an error that has not changed', () => {
    const failed = { ...idle, lastError: 'Provider unavailable' };

    expect(notificationReasonForStateChange(failed, failed, false)).toBeUndefined();
  });
});

describe('userNotificationInputSchema', () => {
  it('defaults the kind to info', () => {
    expect(userNotificationInputSchema.parse({ message: 'Build finished' })).toEqual({
      message: 'Build finished',
      kind: 'info',
    });
  });

  it('accepts an explicit warning', () => {
    expect(
      userNotificationInputSchema.parse({ message: 'Tests failed', kind: 'warning' }).kind,
    ).toBe('warning');
  });

  it.each([{ message: '' }, { message: '   ' }, { message: 'x'.repeat(501) }])(
    'rejects %j',
    (candidate) => {
      expect(userNotificationInputSchema.safeParse(candidate).success).toBe(false);
    },
  );

  it('rejects an unknown property', () => {
    expect(userNotificationInputSchema.safeParse({ message: 'ok', urgency: 'high' }).success).toBe(
      false,
    );
  });
});
