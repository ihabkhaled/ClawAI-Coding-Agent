import { mkdir, mkdtemp, readdir, rm, utimes, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import { EMPTY_MAILBOX } from '../../src/core/agent-mailbox';
import {
  MAX_WINDOW_INBOX_BYTES,
  MAX_WINDOW_INBOX_MESSAGES,
  MAX_WINDOW_MESSAGE_LENGTH,
  MAX_WINDOW_SENDS,
  MESSAGE_TTL_MS,
  PEER_STALE_MS,
} from '../../src/core/cross-window-mailbox.constants';
import {
  AgentMailboxToolExecutor,
  agentMailboxToolDefinition,
} from '../../src/infrastructure/agent-mailbox-tool-executor';
import { isSafeKey, writeAtomic } from '../../src/infrastructure/cross-window-mailbox-files';
import { CrossWindowMailbox } from '../../src/infrastructure/cross-window-mailbox-store';

import type { AgentMailbox } from '../../src/core/agent-mailbox.types';
import type { WindowRefusal } from '../../src/core/cross-window-mailbox.types';
import type { ToolInvocation } from '../../src/core/runtime/runtime-tool-contracts';

let root: string;
let clock: number;
let refusal: WindowRefusal | undefined;

function window(id: string, name = `ws-${id}`): CrossWindowMailbox {
  return new CrossWindowMailbox({
    rootDir: root,
    identity: { windowId: id, workspaceName: name },
    refusal: () => refusal,
    now: () => clock,
  });
}

beforeEach(async () => {
  root = await mkdtemp(join(tmpdir(), 'claw-mailbox-'));
  clock = 1_000_000;
  refusal = undefined;
});

afterEach(async () => {
  await rm(root, { recursive: true, force: true });
});

describe('cross-window mailbox', () => {
  it('lists another live window as a peer and never itself', async () => {
    const a = window('aaaa');
    const b = window('bbbb');
    await a.beat();
    await b.beat();
    const peers = await a.peers();
    expect(peers).toEqual([
      { windowId: 'bbbb', workspaceName: 'ws-bbbb', address: 'window:bbbb', ageMs: 0 },
    ]);
  });

  it('drops a peer whose heartbeat is stale', async () => {
    const a = window('aaaa');
    const b = window('bbbb');
    await b.beat();
    clock += PEER_STALE_MS + 1;
    await a.beat();
    expect(await a.peers()).toEqual([]);
  });

  it('delivers a message with host-stamped sender and reads it once', async () => {
    const a = window('aaaa', 'alpha');
    const b = window('bbbb');
    await a.beat();
    await b.beat();
    const sent = await a.send('window:bbbb', 'main', 'please review');
    expect(sent.sent).toBe(true);
    const mail = await b.receive();
    expect(mail).toMatchObject([
      { fromWindowId: 'aaaa', fromWorkspace: 'alpha', fromAddress: 'main', text: 'please review' },
    ]);
    expect(await b.receive()).toEqual([]);
  });

  it('redacts secrets before writing and truncates long text', async () => {
    const a = window('aaaa');
    const b = window('bbbb');
    await a.beat();
    await b.beat();
    await a.send('window:bbbb', 'main', `Bearer abcdef123456SECRET ${'x'.repeat(5000)}`);
    const mail = await b.receive();
    if (typeof mail === 'string') throw new Error('refused');
    expect(mail[0]?.text).not.toContain('abcdef123456SECRET');
    expect(mail[0]?.text.length).toBeLessThanOrEqual(MAX_WINDOW_MESSAGE_LENGTH);
  });

  it('refuses unknown, self and traversal recipients', async () => {
    const a = window('aaaa');
    await a.beat();
    expect(await a.send('window:zzzz', 'main', 'hi')).toEqual({
      sent: false,
      reason: 'unknown-recipient',
    });
    expect(await a.send('window:aaaa', 'main', 'hi')).toEqual({ sent: false, reason: 'self' });
    expect(await a.send('window:../../etc', 'main', 'hi')).toEqual({
      sent: false,
      reason: 'unknown-recipient',
    });
    expect(isSafeKey('../x')).toBe(false);
  });

  it('refuses a duplicate from the same sender', async () => {
    const a = window('aaaa');
    await a.beat();
    await window('bbbb').beat();
    await a.send('window:bbbb', 'main', 'same');
    expect(await a.send('window:bbbb', 'main', 'same')).toEqual({
      sent: false,
      reason: 'duplicate',
    });
  });

  it('enforces the per-recipient message count', async () => {
    const b = window('bbbb');
    await b.beat();
    for (let i = 0; i < MAX_WINDOW_INBOX_MESSAGES; i += 1) {
      const sender = window(`s${String(i)}`);
      await sender.beat();
      expect((await sender.send('window:bbbb', 'main', `m${String(i)}`)).sent).toBe(true);
    }
    const extra = window('extra');
    await extra.beat();
    expect(await extra.send('window:bbbb', 'main', 'one too many')).toEqual({
      sent: false,
      reason: 'inbox-full',
    });
  }, 30_000);

  it('enforces the inbox byte budget', async () => {
    const a = window('aaaa');
    await a.beat();
    await window('bbbb').beat();
    const dir = join(root, 'inbox', 'bbbb');
    await mkdir(dir, { recursive: true });
    await writeFile(join(dir, 'big.json'), 'x'.repeat(MAX_WINDOW_INBOX_BYTES));
    expect(await a.send('window:bbbb', 'main', 'more')).toEqual({
      sent: false,
      reason: 'inbox-full',
    });
  });

  it('enforces the sender quota', async () => {
    const a = window('aaaa');
    await a.beat();
    const receiver = window('bbbb');
    await receiver.beat();
    for (let i = 0; i < MAX_WINDOW_SENDS; i += 1) {
      expect((await a.send('window:bbbb', 'main', `n${String(i)}`)).sent).toBe(true);
      if (i % 20 === 19) await receiver.receive();
    }
    expect(await a.send('window:bbbb', 'main', 'over')).toEqual({
      sent: false,
      reason: 'sender-quota',
    });
  }, 30_000);

  it('never exceeds the inbox cap under concurrent writers', async () => {
    const b = window('bbbb');
    await b.beat();
    const senders = Array.from({ length: MAX_WINDOW_INBOX_MESSAGES + 20 }, (_, i) =>
      window(`c${String(i)}`),
    );
    await Promise.all(senders.map((s) => s.beat()));
    const results = await Promise.all(
      senders.map((s, i) => s.send('window:bbbb', 'main', `msg ${String(i)}`)),
    );
    const files = (await readdir(join(root, 'inbox', 'bbbb'))).filter((n) => n.endsWith('.json'));
    expect(files.length).toBeLessThanOrEqual(MAX_WINDOW_INBOX_MESSAGES);
    expect(results.filter((r) => r.sent).length).toBeGreaterThanOrEqual(files.length);
    const mail = await b.receive();
    if (typeof mail === 'string') throw new Error('refused');
    expect(new Set(mail.map((m) => m.id)).size).toBe(files.length);
  });

  it('drops mail older than the TTL on receive and on sweep', async () => {
    const a = window('aaaa');
    const b = window('bbbb');
    await a.beat();
    await b.beat();
    await a.send('window:bbbb', 'main', 'old');
    clock += MESSAGE_TTL_MS + 1;
    await b.sweep();
    expect(await readdir(join(root, 'inbox', 'bbbb'))).toEqual([]);
    clock -= MESSAGE_TTL_MS + 1;
    await b.beat();
    await a.send('window:bbbb', 'main', 'old2');
    clock += MESSAGE_TTL_MS + 1;
    expect(await b.receive()).toEqual([]);
  });

  it('ignores corrupt and half-written files', async () => {
    const dir = join(root, 'inbox', 'bbbb');
    await mkdir(dir, { recursive: true });
    await writeFile(join(dir, 'bad.json'), '{nope');
    await writeFile(join(dir, '.tmp-partial'), '{"id":"x"}');
    const b = window('bbbb');
    expect(await b.receive()).toEqual([]);
  });

  it('atomic write leaves no temp file behind', async () => {
    const dir = join(root, 'atomic');
    expect(await writeAtomic(dir, 'one', '{}')).toBe(true);
    expect(await readdir(dir)).toEqual(['one.json']);
  });

  it('refuses everything under zero retention and untrusted workspaces', async () => {
    const a = window('aaaa');
    await a.beat();
    await window('bbbb').beat();
    for (const reason of ['zero-retention', 'untrusted'] as const) {
      refusal = reason;
      expect(await a.send('window:bbbb', 'main', 'hi')).toEqual({ sent: false, reason });
      expect(await a.peers()).toBe(reason);
      expect(await a.receive()).toBe(reason);
    }
  });

  it('withdraws its heartbeat when refusal starts and on dispose', async () => {
    const a = window('aaaa');
    const b = window('bbbb');
    await a.start();
    await b.beat();
    expect(await b.peers()).toHaveLength(1);
    refusal = 'zero-retention';
    await a.beat();
    refusal = undefined;
    expect(await b.peers()).toEqual([]);
    await a.start();
    await a.dispose();
    expect(await b.peers()).toEqual([]);
    await b.dispose();
  });

  it('start is idempotent and dispose clears the timer', async () => {
    const a = window('aaaa');
    await a.start();
    await a.start();
    await a.dispose();
    await a.dispose();
    expect(await readdir(join(root, 'peers'))).toEqual([]);
  });

  it('removes expired heartbeats of vanished windows', async () => {
    await window('gone').beat();
    clock += MESSAGE_TTL_MS + 1;
    await window('aaaa').beat();
    expect(await readdir(join(root, 'peers'))).toEqual(['aaaa.json']);
    await utimes(join(root, 'peers', 'aaaa.json'), new Date(), new Date());
  });
});

describe('runtime.messages across windows (integration)', () => {
  const mailbox: AgentMailbox = EMPTY_MAILBOX;

  function executor(win: CrossWindowMailbox, caller = 'main'): AgentMailboxToolExecutor {
    return new AgentMailboxToolExecutor(
      { read: () => mailbox, write: () => undefined, callerAddress: () => caller },
      win,
    );
  }

  function call(operation: string, args: Record<string, unknown> = {}): ToolInvocation {
    return {
      toolName: agentMailboxToolDefinition.name,
      operation,
      arguments: args,
    } as ToolInvocation;
  }

  it('sends from one window and receives in another through the tool', async () => {
    const wa = window('aaaa');
    const wb = window('bbbb');
    await wa.beat();
    await wb.beat();
    const a = executor(wa);
    const b = executor(wb);
    const peers = await a.execute(call('peers'));
    expect(peers.structured).toMatchObject({ peers: ['window:bbbb'] });
    const sent = await a.execute(call('send', { to: 'window:bbbb', text: 'hello b' }));
    expect(sent.structured).toMatchObject({ sent: true });
    const got = await b.execute(call('receive'));
    expect(got.structured).toMatchObject({
      windowMessages: [{ text: 'hello b', fromAddress: 'window:aaaa' }],
    });
  });

  it('reports a refusal instead of throwing, and sub-agents cannot reach windows', async () => {
    const wa = window('aaaa');
    await wa.beat();
    refusal = 'zero-retention';
    const refused = await executor(wa).execute(call('send', { to: 'window:bbbb', text: 'x' }));
    expect(refused.structured).toEqual({ sent: false, reason: 'zero-retention' });
    refusal = undefined;
    const sub = await executor(wa, 'task-1').execute(
      call('send', { to: 'window:bbbb', text: 'x' }),
    );
    expect(sub.structured).toEqual({ sent: false, reason: 'unknown-recipient' });
    const noWindows = new AgentMailboxToolExecutor({
      read: () => mailbox,
      write: () => undefined,
      callerAddress: () => 'main',
    });
    const none = await noWindows.execute(call('send', { to: 'window:bbbb', text: 'x' }));
    expect(none.structured).toEqual({ sent: false, reason: 'unknown-recipient' });
    refusal = 'untrusted';
    const peers = await executor(wa).execute(call('peers'));
    expect(peers.structured).toEqual({ peers: [], windowsRefused: 'untrusted' });
  });
});
