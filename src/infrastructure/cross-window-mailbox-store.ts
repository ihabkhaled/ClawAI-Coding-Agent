import { randomUUID } from 'node:crypto';
import { join } from 'node:path';

import {
  HEARTBEAT_INTERVAL_MS,
  MAILBOX_FILE_SUFFIX,
  MAILBOX_INBOX_DIR,
  MAILBOX_PEERS_DIR,
  MAX_SEEN_IDS,
  MAX_WINDOW_INBOX_BYTES,
  MAX_WINDOW_INBOX_MESSAGES,
  MAX_WINDOW_MESSAGE_LENGTH,
  MAX_WINDOW_PEERS,
  MAX_WINDOW_SENDS,
  MESSAGE_TTL_MS,
  PEER_STALE_MS,
  WINDOW_ADDRESS_PREFIX,
} from '../core/cross-window-mailbox.constants';
import { redactText } from '../core/redaction';

import {
  fileSize,
  isSafeKey,
  listFinal,
  readJson,
  remove,
  writeAtomic,
} from './cross-window-mailbox-files';
import { heartbeatSchema, windowMessageSchema } from './cross-window-mailbox-schema';

import type {
  CrossWindowMailboxPort,
  WindowIdentity,
  WindowMessage,
  WindowPeer,
  WindowRefusal,
  WindowSendResult,
} from '../core/cross-window-mailbox.types';

export interface CrossWindowMailboxOptions {
  /** `<globalStorage>/mailbox`. One directory per user, shared by every window. */
  readonly rootDir: string;
  readonly identity: WindowIdentity;
  /** Returns why cross-window mail must not run right now, or undefined when it may. */
  readonly refusal: () => WindowRefusal | undefined;
  readonly now?: () => number;
}

/**
 * Mail between VS Code windows of one user on one machine, over plain files.
 *
 * There is no watcher: `receive` reads the inbox on demand and the only timer
 * is the heartbeat, which `dispose` clears and deletes. Nothing here can outlive
 * the window, and nothing polls without a bound.
 */
export class CrossWindowMailbox implements CrossWindowMailboxPort {
  private timer: ReturnType<typeof setInterval> | undefined;
  private sends = 0;
  private readonly seen = new Set<string>();

  constructor(private readonly options: CrossWindowMailboxOptions) {}

  private now(): number {
    return (this.options.now ?? Date.now)();
  }

  private get self(): string {
    return this.options.identity.windowId;
  }

  private peerFile(windowId: string): string {
    return join(this.options.rootDir, MAILBOX_PEERS_DIR, `${windowId}${MAILBOX_FILE_SUFFIX}`);
  }

  private inboxDir(windowId: string): string {
    return join(this.options.rootDir, MAILBOX_INBOX_DIR, windowId);
  }

  /** Announces this window and keeps announcing until disposed. */
  async start(): Promise<void> {
    if (this.timer !== undefined || this.options.refusal() !== undefined) return;
    await this.beat();
    this.timer = setInterval(() => {
      void this.beat();
    }, HEARTBEAT_INTERVAL_MS);
    this.timer.unref();
  }

  async dispose(): Promise<void> {
    if (this.timer !== undefined) clearInterval(this.timer);
    this.timer = undefined;
    await remove(this.peerFile(this.self));
  }

  /** One heartbeat plus a sweep of expired mail; a refusal stops announcing. */
  async beat(): Promise<void> {
    if (this.options.refusal() !== undefined) {
      await remove(this.peerFile(this.self));
      return;
    }
    const { windowId, workspaceName } = this.options.identity;
    const body = JSON.stringify({ windowId, workspaceName, at: this.now() });
    await writeAtomic(join(this.options.rootDir, MAILBOX_PEERS_DIR), windowId, body);
    await this.sweep();
  }

  /** Drops heartbeats of windows long gone and expired mail in this window's inbox. */
  async sweep(): Promise<void> {
    const peersDir = join(this.options.rootDir, MAILBOX_PEERS_DIR);
    for (const name of await listFinal(peersDir)) {
      const beat = heartbeatSchema.safeParse(await readJson(join(peersDir, name)));
      const age = beat.success ? this.now() - beat.data.at : Number.POSITIVE_INFINITY;
      if (age > MESSAGE_TTL_MS) await remove(join(peersDir, name));
    }
    await this.expireInbox(this.inboxDir(this.self));
  }

  private async expireInbox(dir: string): Promise<void> {
    for (const name of await listFinal(dir)) {
      const message = windowMessageSchema.safeParse(await readJson(join(dir, name)));
      if (!message.success || this.now() - message.data.createdAt > MESSAGE_TTL_MS) {
        await remove(join(dir, name));
      }
    }
  }

  async peers(): Promise<readonly WindowPeer[] | WindowRefusal> {
    const refusal = this.options.refusal();
    if (refusal !== undefined) return refusal;
    const dir = join(this.options.rootDir, MAILBOX_PEERS_DIR);
    const found: WindowPeer[] = [];
    for (const name of await listFinal(dir)) {
      const parsed = heartbeatSchema.safeParse(await readJson(join(dir, name)));
      if (!parsed.success || parsed.data.windowId === this.self) continue;
      const ageMs = this.now() - parsed.data.at;
      if (ageMs > PEER_STALE_MS || !isSafeKey(parsed.data.windowId)) continue;
      found.push({
        windowId: parsed.data.windowId,
        workspaceName: parsed.data.workspaceName,
        address: `${WINDOW_ADDRESS_PREFIX}${parsed.data.windowId}`,
        ageMs,
      });
    }
    return found.slice(0, MAX_WINDOW_PEERS);
  }

  async send(to: string, fromAddress: string, text: string): Promise<WindowSendResult> {
    const refusal = this.options.refusal();
    if (refusal !== undefined) return { sent: false, reason: refusal };
    const target = to.startsWith(WINDOW_ADDRESS_PREFIX)
      ? to.slice(WINDOW_ADDRESS_PREFIX.length)
      : '';
    if (target === this.self) return { sent: false, reason: 'self' };
    const live = await this.peers();
    if (typeof live === 'string' || !live.some((peer) => peer.windowId === target)) {
      return { sent: false, reason: 'unknown-recipient' };
    }
    if (this.sends >= MAX_WINDOW_SENDS) return { sent: false, reason: 'sender-quota' };
    return this.deliver(target, fromAddress, text);
  }

  private async deliver(
    target: string,
    fromAddress: string,
    text: string,
  ): Promise<WindowSendResult> {
    const clean = redactText(text.trim()).slice(0, MAX_WINDOW_MESSAGE_LENGTH);
    const dir = this.inboxDir(target);
    if (await this.hasDuplicate(dir, clean)) return { sent: false, reason: 'duplicate' };
    const id = randomUUID();
    const message: WindowMessage = {
      id,
      fromWindowId: this.self,
      fromWorkspace: this.options.identity.workspaceName,
      fromAddress,
      text: clean,
      createdAt: this.now(),
    };
    const body = JSON.stringify(message);
    if (!(await this.fits(dir, body.length))) return { sent: false, reason: 'inbox-full' };
    try {
      if (!(await writeAtomic(dir, id, body))) return { sent: false, reason: 'write-failed' };
    } catch {
      return { sent: false, reason: 'write-failed' };
    }
    // Concurrent writers can both pass the pre-check; the loser withdraws.
    if (!(await this.fits(dir, 0))) {
      await remove(join(dir, `${id}${MAILBOX_FILE_SUFFIX}`));
      return { sent: false, reason: 'inbox-full' };
    }
    this.sends += 1;
    return { sent: true, id };
  }

  private async hasDuplicate(dir: string, text: string): Promise<boolean> {
    for (const name of await listFinal(dir)) {
      const parsed = windowMessageSchema.safeParse(await readJson(join(dir, name)));
      if (parsed.success && parsed.data.fromWindowId === this.self && parsed.data.text === text) {
        return true;
      }
    }
    return false;
  }

  /** Whether the inbox is within its count and byte limits, counting `extra` new bytes. */
  private async fits(dir: string, extra: number): Promise<boolean> {
    const names = await listFinal(dir);
    if (names.length + (extra > 0 ? 1 : 0) > MAX_WINDOW_INBOX_MESSAGES) return false;
    let bytes = extra;
    for (const name of names) bytes += await fileSize(join(dir, name));
    return bytes <= MAX_WINDOW_INBOX_BYTES;
  }

  /** Reads and discards this window's mail, oldest first, each id once. */
  async receive(): Promise<readonly WindowMessage[] | WindowRefusal> {
    const refusal = this.options.refusal();
    if (refusal !== undefined) return refusal;
    const dir = this.inboxDir(this.self);
    const messages: WindowMessage[] = [];
    for (const name of await listFinal(dir)) {
      const path = join(dir, name);
      const parsed = windowMessageSchema.safeParse(await readJson(path));
      await remove(path);
      if (!parsed.success || this.now() - parsed.data.createdAt > MESSAGE_TTL_MS) continue;
      if (this.seen.has(parsed.data.id)) continue;
      if (this.seen.size >= MAX_SEEN_IDS) this.seen.clear();
      this.seen.add(parsed.data.id);
      messages.push(parsed.data);
    }
    return messages.sort((a, b) => a.createdAt - b.createdAt);
  }
}
