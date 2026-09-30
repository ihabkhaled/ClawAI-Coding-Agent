/** Where the answer to "is a run still going on this thread?" comes from (F095). */
export interface RunActivitySources<Entry> {
  /** The backend's own answer: `GET /chat-threads/:id/active-run`. */
  readonly query: () => Promise<{ readonly active: boolean }>;
  /** True when the query failed only because the backend predates it (404). */
  readonly isUnsupported: (error: unknown) => boolean;
  /** The transcript, read only when the query is unsupported. */
  readonly transcript: () => Promise<readonly Entry[]>;
  readonly now?: number;
}
