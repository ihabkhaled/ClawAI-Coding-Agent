import { describe, expect, it } from 'vitest';

import { BackendSessionChangedError, bindBackendSession } from '../../src/backend/backend-errors';

/**
 * One ClawAI session is shared per backend origin across every window.
 *
 * Binding used to refuse ANY session id it had not seen before, so opening a
 * second VS Code window silently logged the first one out: the second window's
 * sign-in rotated the shared record, and the first window's next bind threw and
 * dropped it to the Connect gate with its queued message lost. Parallel windows
 * were impossible for that reason alone.
 *
 * The account, not the session id, is what may not change underneath a client.
 */
describe('bindBackendSession', () => {
  it('binds when nothing is bound yet', () => {
    expect(bindBackendSession(null, 'session-a')).toBe('session-a');
  });

  it('is a no-op when the session is unchanged', () => {
    expect(bindBackendSession('session-a', 'session-a')).toBe('session-a');
  });

  it('adopts a rotated session when the same account still owns it', () => {
    // The second window signed the same user in again. That is the shared vault
    // working, not a takeover, so the first window follows it across.
    expect(
      bindBackendSession('session-a', 'session-b', { current: 'user-1', incoming: 'user-1' }),
    ).toBe('session-b');
  });

  it('refuses a rotated session owned by a different account', () => {
    // Continuing here would run one person's agent against another person's
    // entitlements, so this must still fail closed.
    expect(() =>
      bindBackendSession('session-a', 'session-b', { current: 'user-1', incoming: 'user-2' }),
    ).toThrow(BackendSessionChangedError);
  });

  it.each([
    ['neither side records an account', undefined, undefined],
    ['only the bound side records one', 'user-1', undefined],
    ['only the incoming side records one', undefined, 'user-1'],
  ])('keeps the strict behaviour when %s', (_label, current, incoming) => {
    // A record written before accounts were stored proves nothing about who
    // owns it and must not be adopted on faith.
    expect(() => bindBackendSession('session-a', 'session-b', { current, incoming })).toThrow(
      BackendSessionChangedError,
    );
  });
});
