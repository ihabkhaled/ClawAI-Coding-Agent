import { describe, expect, it } from 'vitest';

import { DEFAULT_CHAT_SUBJECT } from '../../src/core/chat-session';
import {
  CLOSED_SESSION_LIMIT,
  rememberClosedSession,
  takeClosedSession,
} from '../../src/core/closed-session-stack';

import type { ClosedSession } from '../../src/core/closed-session-stack.types';

function closed(threadId: string | undefined, subject = 'Fix the parser'): ClosedSession {
  return { subject, threadId, closedAt: 1 };
}

describe('rememberClosedSession', () => {
  it('puts the most recently closed session first', () => {
    const stack = rememberClosedSession(rememberClosedSession([], closed('a')), closed('b'));

    expect(stack.map(({ threadId }) => threadId)).toEqual(['b', 'a']);
  });

  it('does not remember an empty chat, which holds nothing to come back to', () => {
    expect(rememberClosedSession([], closed(undefined, DEFAULT_CHAT_SUBJECT))).toEqual([]);
  });

  it('remembers an unsent chat that at least has a subject', () => {
    expect(rememberClosedSession([], closed(undefined, 'Fix the parser'))).toHaveLength(1);
  });

  it('moves a thread closed twice to the front instead of storing it twice', () => {
    const stack = rememberClosedSession(
      rememberClosedSession(rememberClosedSession([], closed('a')), closed('b')),
      closed('a'),
    );

    expect(stack.map(({ threadId }) => threadId)).toEqual(['a', 'b']);
  });

  it('forgets the oldest rather than growing without bound', () => {
    let stack: ClosedSession[] = [];
    for (let index = 0; index < CLOSED_SESSION_LIMIT + 5; index += 1) {
      stack = rememberClosedSession(stack, closed(`t${String(index)}`));
    }

    expect(stack).toHaveLength(CLOSED_SESSION_LIMIT);
    expect(stack.at(-1)?.threadId).toBe('t5');
  });
});

describe('takeClosedSession', () => {
  it('has nothing to reopen when nothing was closed', () => {
    expect(takeClosedSession([])).toBeUndefined();
  });

  it('takes the most recent and leaves the rest', () => {
    const taken = takeClosedSession([closed('b'), closed('a')]);

    expect(taken?.entry.threadId).toBe('b');
    expect(taken?.remaining.map(({ threadId }) => threadId)).toEqual(['a']);
  });
});
