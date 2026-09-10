/** Why a note was posted, which is what tells a reader whether to act on it. */
export type AgentNoteKind = 'finding' | 'claim' | 'warning' | 'done';

export interface AgentNote {
  readonly taskId: string;
  readonly kind: AgentNoteKind;
  readonly text: string;
  /** Monotonic within a board, so readers can order what they have not seen. */
  readonly sequence: number;
}

export interface AgentBoard {
  readonly notes: readonly AgentNote[];
}

/** What a post did, since a refusal has to say which limit stopped it. */
export type AgentBoardPostResult =
  | { readonly posted: true; readonly board: AgentBoard; readonly sequence: number }
  | { readonly posted: false; readonly reason: 'agent-quota' | 'board-full' | 'duplicate' };
