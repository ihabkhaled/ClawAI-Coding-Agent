import type { ChannelInboxPort, ChannelMessage } from '../backend/channel.types';

/** A cancellable timer, so tests drive the watch without real time. */
export interface ChannelTimer {
  cancel(): void;
}

export interface ChannelWatcherDependencies {
  readonly inbox: () => ChannelInboxPort;
  /** Reads are skipped (not counted as failures) while nobody is signed in. */
  readonly signedIn: () => boolean;
  /** Shows one message. Must not wait for the user; the message is acknowledged after this. */
  readonly surface: (message: ChannelMessage) => void;
  readonly schedule: (callback: () => void, delayMs: number) => ChannelTimer;
}

export type ChannelWatchState = 'idle' | 'watching' | 'stopped-failures' | 'stopped-session-limit';
