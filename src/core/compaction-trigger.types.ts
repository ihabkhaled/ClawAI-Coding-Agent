/** What the user asked ClawAI to do when a conversation is nearly full. */
export type AutoCompactionMode = 'off' | 'prompt' | 'automatic';

/** What should happen right now. */
export type AutoCompactionAction = 'none' | 'offer' | 'compact';

export interface AutoCompactionInput {
  readonly mode: AutoCompactionMode;
  /** True when the conversation is close enough to full to be worth compacting. */
  readonly nearlyFull: boolean;
  /** A run is still writing into this conversation. */
  readonly runInFlight: boolean;
  /** This conversation has already been raised and not yet fallen back. */
  readonly alreadyRaised: boolean;
}
