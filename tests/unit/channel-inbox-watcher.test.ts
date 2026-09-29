import { describe, expect, it } from 'vitest';

import { channelClient } from '../../src/backend/channel-client';
import {
  CHANNEL_MAX_BACKOFF_MS,
  CHANNEL_MAX_CONSECUTIVE_FAILURES,
  CHANNEL_MAX_POLLS_PER_SESSION,
  CHANNEL_POLL_INTERVAL_MS,
} from '../../src/core/channel-inbox.constants';
import { channelMessageBlock } from '../../src/core/channel-message-format';
import { ChannelInboxWatcher } from '../../src/services/channel-inbox-watcher';

import type { ChannelInboxPort, ChannelMessage } from '../../src/backend/channel.types';
import type { IntegrationRequester } from '../../src/backend/integration-contracts';

const message: ChannelMessage = {
  id: 'm1',
  kind: 'ci',
  source: 'github',
  title: 'CI failed on main',
  body: 'lint step failed',
  url: 'https://ci.example/run/1',
  receivedAt: '2026-09-29T00:00:00.000Z',
};

interface Harness {
  readonly watcher: ChannelInboxWatcher;
  readonly delays: number[];
  readonly surfaced: string[];
  readonly acked: string[];
  run(): Promise<void>;
}

function harness(read: () => Promise<readonly ChannelMessage[]>, signedIn = true): Harness {
  const delays: number[] = [];
  const surfaced: string[] = [];
  const acked: string[] = [];
  let pending: (() => void) | undefined;
  const inbox: ChannelInboxPort = {
    read,
    ack: (id) => {
      acked.push(id);
      return Promise.resolve();
    },
    webhook: () => Promise.reject(new Error('unused')),
  };
  const watcher = new ChannelInboxWatcher({
    inbox: () => inbox,
    signedIn: () => signedIn,
    surface: (m) => surfaced.push(m.id),
    schedule: (callback, delayMs) => {
      delays.push(delayMs);
      pending = callback;
      return { cancel: () => (pending = undefined) };
    },
  });
  return {
    watcher,
    delays,
    surfaced,
    acked,
    run: async () => {
      const next = pending;
      pending = undefined;
      next?.();
      await new Promise((resolve) => setTimeout(resolve, 0));
    },
  };
}

describe('ChannelInboxWatcher', () => {
  it('surfaces then acknowledges each message and keeps the normal gap', async () => {
    let first = true;
    const h = harness(() => {
      const batch = first ? [message] : [];
      first = false;
      return Promise.resolve(batch);
    });

    h.watcher.start();
    await h.run();
    await h.run();

    expect(h.surfaced).toEqual(['m1']);
    expect(h.acked).toEqual(['m1']);
    expect(h.delays).toEqual([0, CHANNEL_POLL_INTERVAL_MS, CHANNEL_POLL_INTERVAL_MS]);
  });

  it('backs off exponentially and stops after the failure limit', async () => {
    const h = harness(() => Promise.reject(new Error('down')));

    h.watcher.start();
    for (let index = 0; index < CHANNEL_MAX_CONSECUTIVE_FAILURES; index += 1) await h.run();

    expect(h.watcher.state).toBe('stopped-failures');
    expect(h.delays.slice(1)).toEqual([120_000, 240_000, 480_000, CHANNEL_MAX_BACKOFF_MS]);
    await h.run();
    expect(h.delays).toHaveLength(CHANNEL_MAX_CONSECUTIVE_FAILURES);
  });

  it('ends a healthy session after the poll limit, and a restart begins a new one', async () => {
    const h = harness(() => Promise.resolve([]), false);

    h.watcher.start();
    for (let index = 0; index <= CHANNEL_MAX_POLLS_PER_SESSION; index += 1) await h.run();
    expect(h.watcher.state).toBe('stopped-session-limit');

    h.watcher.start();
    expect(h.watcher.state).toBe('watching');
  });

  it('schedules nothing after dispose', async () => {
    const h = harness(() => Promise.resolve([]));
    h.watcher.start();
    h.watcher.dispose();
    await h.run();
    expect(h.delays).toEqual([0]);
  });
});

describe('channel client and composer block', () => {
  it('reads, acknowledges and fetches the webhook on the owner routes', async () => {
    const paths: string[] = [];
    const request: IntegrationRequester = (path, schema, options) => {
      paths.push(`${options?.method ?? 'GET'} ${path}`);
      if (path.startsWith('/agent/channels/inbox?'))
        return Promise.resolve(schema.parse({ messages: [message] }));
      if (path === '/agent/channels/webhook')
        return Promise.resolve(
          schema.parse({
            url: 'https://claw.local/x',
            secret: 's',
            signatureHeader: 'x-claw-signature',
            timestampHeader: 'x-claw-timestamp',
            signatureFormat: 'f',
          }),
        );
      return Promise.resolve(schema.parse(undefined));
    };
    const client = channelClient(request);

    expect(await client.read(10)).toHaveLength(1);
    await client.ack('m 1');
    expect((await client.webhook()).url).toBe('https://claw.local/x');
    expect(paths).toEqual([
      'GET /agent/channels/inbox?limit=10',
      'DELETE /agent/channels/inbox/m%201',
      'GET /agent/channels/webhook',
    ]);
  });

  it('labels where a message came from', () => {
    expect(channelMessageBlock(message)).toBe(
      '[Channel · github · ci] CI failed on main\n\nlint step failed\n\nhttps://ci.example/run/1',
    );
    expect(channelMessageBlock({ ...message, body: ' ', url: null })).toBe(
      '[Channel · github · ci] CI failed on main',
    );
  });
});
