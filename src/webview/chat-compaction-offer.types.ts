/** Host to panel: a conversation is nearly full; show the inline offer. */
export interface CompactionOfferMessage {
  readonly type: 'compactionOffer';
  readonly requestId: string;
  readonly threadId: string;
  readonly usedPercent: number;
}

/** The part of an open conversation panel an offer needs. */
export interface CompactionOfferPanel {
  readonly descriptor: { readonly threadId?: string | undefined };
  readonly target: {
    readonly webview: { postMessage(message: unknown): PromiseLike<boolean> };
  };
}
