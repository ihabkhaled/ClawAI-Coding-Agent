/** What asking a side question needs to reach. */
export interface SideQuestionDependencies {
  /** The archived thread side questions go to, created on first use. */
  readonly scratchThreadId: () => Promise<string>;
  readonly ask: (threadId: string, question: string) => Promise<string>;
  readonly openAnswer: (markdown: string) => Promise<void>;
}
