/** What compacting a conversation needs to reach. */
export interface CompactConversationDependencies {
  /** The thread being compacted, or nothing when no conversation is open. */
  readonly activeThreadId: () => string | undefined;
  /** Asks the conversation's own model to summarize it, returning the text. */
  readonly summarize: (threadId: string, instruction: string) => Promise<string>;
  /** Opens a new conversation seeded with the summary. */
  readonly startContinuation: (seed: string) => Promise<void>;
  /**
   * Skips the confirmation. Only the automatic mode passes this, and only
   * because the user already answered the question once, in a setting.
   */
  readonly unattended?: boolean;
}
