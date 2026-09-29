/** A coding session to start on a registered runner. */
export interface CloudSessionRequest {
  readonly branch: string;
  readonly task: string;
}

/** The outcome of building the runner command: a command, or why there is none. */
export type CloudSessionCommand =
  | { readonly ok: true; readonly command: string }
  | { readonly ok: false; readonly reason: 'unsafe-branch' | 'empty-task' | 'too-long' };
