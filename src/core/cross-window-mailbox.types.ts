/** Who is speaking, stamped by the host. An agent can never name itself. */
export interface WindowIdentity {
  readonly windowId: string;
  readonly workspaceName: string;
}

export interface WindowPeer extends WindowIdentity {
  readonly address: string;
  readonly ageMs: number;
}

export interface WindowMessage {
  readonly id: string;
  readonly fromWindowId: string;
  readonly fromWorkspace: string;
  readonly fromAddress: string;
  readonly text: string;
  readonly createdAt: number;
}

export type WindowRefusal = 'zero-retention' | 'untrusted';

export type WindowSendRefusal =
  | WindowRefusal
  | 'unknown-recipient'
  | 'self'
  | 'inbox-full'
  | 'sender-quota'
  | 'duplicate'
  | 'write-failed';

export type WindowSendResult =
  | { readonly sent: true; readonly id: string }
  | { readonly sent: false; readonly reason: WindowSendRefusal };

/** The contract the tool executor uses; the store implements it over the filesystem. */
export interface CrossWindowMailboxPort {
  peers(): Promise<readonly WindowPeer[] | WindowRefusal>;
  send(to: string, fromAddress: string, text: string): Promise<WindowSendResult>;
  receive(): Promise<readonly WindowMessage[] | WindowRefusal>;
}
