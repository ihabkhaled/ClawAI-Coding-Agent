import { describe, expect, it } from 'vitest';

import { ChannelInboxWatcher } from '../../src/services/channel-inbox-watcher';

import type { ChannelMessage } from '../../src/backend/channel.types';

function slowInbox() {
  const live = new Set<() => void>();
  const releases: (() => void)[] = [];
  const watcher = new ChannelInboxWatcher({
    inbox: () => ({
      read: () =>
        new Promise<readonly ChannelMessage[]>((resolve) => {
          releases.push(() => {
            resolve([]);
          });
        }),
      ack: () => Promise.resolve(),
      webhook: () => Promise.reject(new Error('unused')),
    }),
    signedIn: () => true,
    surface: () => undefined,
    schedule: (callback) => {
      live.add(callback);
      return {
        cancel: () => {
          live.delete(callback);
        },
      };
    },
  });
  const fireNext = (): void => {
    const [callback] = live;
    if (callback === undefined) return;
    live.delete(callback);
    callback();
  };
  return { watcher, live, releases, fireNext };
}

const settle = (): Promise<void> => new Promise((resolve) => setTimeout(resolve, 0));

describe('ChannelInboxWatcher restart while a read is in flight', () => {
  it('keeps exactly one poll chain alive', async () => {
    const h = slowInbox();

    h.watcher.start();
    h.fireNext();
    await settle();
    h.watcher.start();
    expect(h.live.size).toBe(1);
    h.releases[0]?.();
    await settle();

    expect(h.live.size).toBe(1);
  });

  it('does not reschedule after dispose during a read', async () => {
    const h = slowInbox();

    h.watcher.start();
    h.fireNext();
    await settle();
    h.watcher.dispose();
    h.releases[0]?.();
    await settle();

    expect(h.live.size).toBe(0);
  });
});
