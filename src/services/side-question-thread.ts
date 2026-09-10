import { SIDE_QUESTION_THREAD_TITLE } from '../core/side-question';

import type { BackendClient } from '../backend/backend-client';

/**
 * The thread side questions go to, created once per session and archived
 * immediately.
 *
 * Archived at creation, not later: a thread that appears in history for even a
 * moment has already polluted the list the user was trying to keep clean.
 *
 * Cached for the session rather than looked up each time. Reusing one thread
 * keeps the account tidy, and re-deriving it from the archived list on every
 * question would be a request to answer a question nobody asked.
 */
export class SideQuestionThread {
  private threadId: string | undefined;

  constructor(private readonly backend: () => BackendClient) {}

  async id(): Promise<string> {
    if (this.threadId !== undefined) return this.threadId;
    const created = await this.backend().createThread({
      title: SIDE_QUESTION_THREAD_TITLE,
      routingMode: 'AUTO',
    });
    await this.backend().updateThread(created.id, { isArchived: true });
    this.threadId = created.id;
    return created.id;
  }

  /** Forgotten when the account changes, because the thread belonged to it. */
  forget(): void {
    this.threadId = undefined;
  }
}
