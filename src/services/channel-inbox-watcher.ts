import {
  CHANNEL_MAX_BACKOFF_MS,
  CHANNEL_MAX_CONSECUTIVE_FAILURES,
  CHANNEL_MAX_POLLS_PER_SESSION,
  CHANNEL_POLL_INTERVAL_MS,
  CHANNEL_READ_LIMIT,
} from '../core/channel-inbox.constants';

import type {
  ChannelTimer,
  ChannelWatchState,
  ChannelWatcherDependencies,
} from './channel-inbox-watcher.types';

/**
 * Watches the channel inbox (F083) with a bounded poll.
 *
 * Bounded in both directions: consecutive failures back off exponentially and
 * stop the watch after a fixed count, and even a healthy watch ends after a
 * fixed number of reads. Only the user restarting it begins a new session, so
 * a forgotten window can never poll the backend forever.
 *
 * A message is acknowledged right after it is surfaced, so it is shown once.
 */
export class ChannelInboxWatcher {
  private timer: ChannelTimer | undefined;
  private polls = 0;
  private failures = 0;
  /** Bumped by every start and dispose, so a read that outlives its session ends there. */
  private session = 0;
  private stateValue: ChannelWatchState = 'idle';

  constructor(private readonly dependencies: ChannelWatcherDependencies) {}

  get state(): ChannelWatchState {
    return this.stateValue;
  }

  /** Starts (or restarts) a watch session and reads immediately. */
  start(): void {
    this.cancel();
    this.session += 1;
    this.polls = 0;
    this.failures = 0;
    this.stateValue = 'watching';
    this.next(0);
  }

  /** Reads once now; the count of surfaced messages. Errors propagate to the caller. */
  async checkNow(): Promise<number> {
    const messages = await this.dependencies.inbox().read(CHANNEL_READ_LIMIT);
    for (const message of messages) {
      this.dependencies.surface(message);
      await this.dependencies.inbox().ack(message.id);
    }
    return messages.length;
  }

  dispose(): void {
    this.cancel();
    this.session += 1;
    this.stateValue = 'idle';
  }

  private async poll(): Promise<void> {
    this.timer = undefined;
    if (this.polls >= CHANNEL_MAX_POLLS_PER_SESSION) {
      this.stateValue = 'stopped-session-limit';
      return;
    }
    this.polls += 1;
    const session = this.session;
    if (!this.dependencies.signedIn()) {
      this.next(CHANNEL_POLL_INTERVAL_MS);
      return;
    }
    try {
      await this.checkNow();
      if (session !== this.session) return;
      this.failures = 0;
      this.next(CHANNEL_POLL_INTERVAL_MS);
    } catch {
      if (session !== this.session) return;
      this.failures += 1;
      if (this.failures >= CHANNEL_MAX_CONSECUTIVE_FAILURES) {
        this.stateValue = 'stopped-failures';
        return;
      }
      this.next(Math.min(CHANNEL_POLL_INTERVAL_MS * 2 ** this.failures, CHANNEL_MAX_BACKOFF_MS));
    }
  }

  private next(delayMs: number): void {
    if (this.stateValue !== 'watching') return;
    this.cancel();
    this.timer = this.dependencies.schedule(() => {
      void this.poll();
    }, delayMs);
  }

  private cancel(): void {
    this.timer?.cancel();
    this.timer = undefined;
  }
}
