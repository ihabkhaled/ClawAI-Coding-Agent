/** What identifies "the previous run" for `--continue`: one backend, one workspace. */
export interface HeadlessSessionScope {
  readonly backendUrl: string;
  readonly workspace: string;
}

/**
 * Remembers the thread of the most recent CLI run per scope.
 *
 * Only a thread identifier is kept, never a credential, a prompt or an answer.
 */
export interface HeadlessSessionStore {
  latest(scope: HeadlessSessionScope): Promise<string | undefined>;
  remember(scope: HeadlessSessionScope, threadId: string): Promise<void>;
}

export interface HeadlessSessionEntry {
  readonly threadId: string;
  readonly updatedAt: string;
}
