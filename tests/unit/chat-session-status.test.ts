import { describe, expect, it } from 'vitest';

import {
  activityForRun,
  decideSessionUnread,
  sessionActivity,
  sessionTabTitle,
} from '../../src/core/chat-session-status';

describe('sessionTabTitle', () => {
  it('says nothing extra for an idle session that has been read', () => {
    expect(sessionTabTitle({ subject: 'Fix the parser', activity: 'idle', unread: false })).toBe(
      'Fix the parser',
    );
  });

  it('marks a running session', () => {
    expect(sessionTabTitle({ subject: 'Fix it', activity: 'running', unread: false })).not.toBe(
      'Fix it',
    );
  });

  it('lets activity outrank unread, because it says more', () => {
    const running = sessionTabTitle({ subject: 'Fix it', activity: 'running', unread: true });
    const unread = sessionTabTitle({ subject: 'Fix it', activity: 'idle', unread: true });

    expect(running).not.toBe(unread);
  });

  it('gives each activity its own marker', () => {
    const titles = (['idle', 'running', 'awaiting-approval', 'failed'] as const).map((activity) =>
      sessionTabTitle({ subject: 'S', activity, unread: false }),
    );

    expect(new Set(titles).size).toBe(4);
  });

  it('always ends with the subject so the tab is still recognisable', () => {
    expect(
      sessionTabTitle({ subject: 'Fix the parser', activity: 'failed', unread: true }),
    ).toContain('Fix the parser');
  });
});

describe('decideSessionUnread', () => {
  it('is never unread while the user is looking at it', () => {
    expect(
      decideSessionUnread({ previous: 'running', next: 'idle', visible: true, unread: true }),
    ).toBe(false);
  });

  it('marks a run that finished while the user was elsewhere', () => {
    expect(
      decideSessionUnread({ previous: 'running', next: 'idle', visible: false, unread: false }),
    ).toBe(true);
  });

  it('marks a run that stopped to ask a question, the moment it asks', () => {
    expect(
      decideSessionUnread({
        previous: 'running',
        next: 'awaiting-approval',
        visible: false,
        unread: false,
      }),
    ).toBe(true);
  });

  it('does not mark a run that has merely started', () => {
    expect(
      decideSessionUnread({ previous: 'idle', next: 'running', visible: false, unread: false }),
    ).toBe(false);
  });

  it('leaves an existing flag alone rather than clearing it on the next event', () => {
    expect(
      decideSessionUnread({ previous: 'idle', next: 'running', visible: false, unread: true }),
    ).toBe(true);
  });
});

describe('activityForRun', () => {
  it('is idle when no run is attached', () => {
    expect(activityForRun(undefined, false)).toBe('idle');
  });

  it('is running while work is in flight', () => {
    expect(activityForRun('generating', false)).toBe('running');
    expect(activityForRun('executing', false)).toBe('running');
  });

  it('reads a finished run as idle, because finishing is news rather than activity', () => {
    expect(activityForRun('applied', false)).toBe('idle');
    expect(activityForRun('verified', false)).toBe('idle');
  });

  it('reads a failed or rejected run as failed', () => {
    expect(activityForRun('failed', false)).toBe('failed');
    expect(activityForRun('rejected', false)).toBe('failed');
  });

  it('lets a waiting question outrank whatever the run was doing', () => {
    expect(activityForRun('generating', true)).toBe('awaiting-approval');
    expect(activityForRun(undefined, true)).toBe('awaiting-approval');
  });
});

describe('sessionActivity', () => {
  it('is idle for a session with no runs', () => {
    expect(sessionActivity([])).toBe('idle');
  });

  it('lets a waiting run outrank a moving one', () => {
    expect(
      sessionActivity([
        { phase: 'generating', awaitingAnswer: false },
        { phase: 'generating', awaitingAnswer: true },
      ]),
    ).toBe('awaiting-approval');
  });

  it('lets a moving run outrank an older failure', () => {
    expect(
      sessionActivity([
        { phase: 'failed', awaitingAnswer: false },
        { phase: 'executing', awaitingAnswer: false },
      ]),
    ).toBe('running');
  });

  it('reports a failure when nothing else is happening', () => {
    expect(
      sessionActivity([
        { phase: 'applied', awaitingAnswer: false },
        { phase: 'failed', awaitingAnswer: false },
      ]),
    ).toBe('failed');
  });
});
