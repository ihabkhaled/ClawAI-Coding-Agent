export interface AgentMessage {
  /** Monotonic across the mailbox, so a reader can resume from what it has seen. */
  readonly sequence: number;
  readonly from: string;
  readonly to: string;
  readonly text: string;
}

export interface AgentMailbox {
  /** Live addresses other than the main session, which is always live. */
  readonly addresses: readonly string[];
  readonly messages: readonly AgentMessage[];
  readonly nextSequence: number;
  /** Lifetime sends per sender, kept apart from `messages` so reading cannot refill a quota. */
  readonly sent: Readonly<Record<string, number>>;
}

export type AgentSendRefusal =
  'unknown-recipient' | 'self' | 'sender-quota' | 'inbox-full' | 'mailbox-full' | 'duplicate';

/** What a send did, since a refusal has to name the limit that stopped it. */
export type AgentSendResult =
  | { readonly sent: true; readonly mailbox: AgentMailbox; readonly sequence: number }
  | { readonly sent: false; readonly reason: AgentSendRefusal };
