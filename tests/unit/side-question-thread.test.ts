import { describe, expect, it, vi } from 'vitest';

import { SIDE_QUESTION_THREAD_TITLE } from '../../src/core/side-question';
import { SideQuestionThread } from '../../src/services/side-question-thread';

function backend() {
  const createThread = vi.fn(async () => ({ id: 'thread-side' }));
  const updateThread = vi.fn(async () => ({ id: 'thread-side' }));
  return { createThread, updateThread };
}

describe('SideQuestionThread', () => {
  it('creates the thread with a name a user would recognise', async () => {
    const client = backend();

    await new SideQuestionThread(() => client as never).id();

    expect(client.createThread).toHaveBeenCalledWith(
      expect.objectContaining({ title: SIDE_QUESTION_THREAD_TITLE }),
    );
  });

  it('archives it immediately, before it can appear in history', async () => {
    const client = backend();

    await new SideQuestionThread(() => client as never).id();

    expect(client.updateThread).toHaveBeenCalledWith('thread-side', { isArchived: true });
  });

  it('reuses the same thread rather than making one per question', async () => {
    const client = backend();
    const subject = new SideQuestionThread(() => client as never);

    await subject.id();
    await subject.id();

    expect(client.createThread).toHaveBeenCalledTimes(1);
  });

  it('forgets the thread when the account changes, because it belonged to it', async () => {
    const client = backend();
    const subject = new SideQuestionThread(() => client as never);

    await subject.id();
    subject.forget();
    await subject.id();

    expect(client.createThread).toHaveBeenCalledTimes(2);
  });
});
