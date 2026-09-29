import { describe, expect, it } from 'vitest';

import {
  EMPTY_MAILBOX,
  acknowledge,
  inboxFor,
  peersOf,
  registerAddress,
  retireAddress,
  sendMessage,
} from '../../src/core/agent-mailbox';
import {
  MAIN_ADDRESS,
  MAX_MAILBOX_MESSAGES,
  MAX_MESSAGE_LENGTH,
  MAX_SENT_PER_SENDER,
  MAX_UNREAD_PER_RECIPIENT,
} from '../../src/core/agent-mailbox.constants';
import {
  AgentMailboxToolExecutor,
  agentMailboxToolDefinition,
} from '../../src/infrastructure/agent-mailbox-tool-executor';

import type { AgentMailbox } from '../../src/core/agent-mailbox.types';
import type { ToolInvocation } from '../../src/core/runtime/runtime-tool-contracts';

function live(...addresses: string[]): AgentMailbox {
  return addresses.reduce(registerAddress, EMPTY_MAILBOX);
}

function delivered(mailbox: AgentMailbox, from: string, to: string, text: string): AgentMailbox {
  const result = sendMessage(mailbox, from, to, text);
  if (!result.sent) throw new Error(`refused: ${result.reason}`);
  return result.mailbox;
}

describe('agent mailbox core', () => {
  it('lists the main session and every live agent except the caller', () => {
    const mailbox = live('a', 'b');
    expect(peersOf(mailbox, 'a')).toEqual([MAIN_ADDRESS, 'b']);
    expect(peersOf(mailbox, MAIN_ADDRESS)).toEqual(['a', 'b']);
  });

  it('does not register main or a duplicate address', () => {
    expect(registerAddress(EMPTY_MAILBOX, MAIN_ADDRESS)).toBe(EMPTY_MAILBOX);
    const once = live('a');
    expect(registerAddress(once, 'a')).toBe(once);
  });

  it('delivers a message with a resumable sequence', () => {
    const result = sendMessage(live('a', 'b'), 'a', 'b', 'hello');
    expect(result).toMatchObject({ sent: true, sequence: 1 });
    if (result.sent) {
      expect(inboxFor(result.mailbox, 'b')).toEqual([
        { sequence: 1, from: 'a', to: 'b', text: 'hello' },
      ]);
    }
  });

  it('refuses each unsendable case with its own reason', () => {
    const mailbox = live('a', 'b');
    expect(sendMessage(mailbox, 'a', 'a', 'x')).toEqual({ sent: false, reason: 'self' });
    expect(sendMessage(mailbox, 'a', 'ghost', 'x')).toEqual({
      sent: false,
      reason: 'unknown-recipient',
    });
    const once = delivered(mailbox, 'a', 'b', 'same');
    expect(sendMessage(once, 'a', 'b', 'same')).toEqual({ sent: false, reason: 'duplicate' });
  });

  it('stops a sender at its quota', () => {
    const mailbox: AgentMailbox = { ...live('a', 'b'), sent: { a: MAX_SENT_PER_SENDER } };
    expect(sendMessage(mailbox, 'a', 'b', 'more')).toEqual({
      sent: false,
      reason: 'sender-quota',
    });
  });

  it('stops a full inbox and a full mailbox', () => {
    const messages = Array.from({ length: MAX_UNREAD_PER_RECIPIENT }, (_, index) => ({
      sequence: index + 1,
      from: 'c',
      to: 'b',
      text: `m${String(index)}`,
    }));
    const full: AgentMailbox = { ...live('a', 'b', 'c'), messages, nextSequence: 100 };
    expect(sendMessage(full, 'a', 'b', 'x')).toEqual({ sent: false, reason: 'inbox-full' });

    const crowded: AgentMailbox = {
      ...live('a', 'b'),
      messages: Array.from({ length: MAX_MAILBOX_MESSAGES }, (_, index) => ({
        sequence: index + 1,
        from: 'c',
        to: 'z',
        text: `m${String(index)}`,
      })),
    };
    expect(sendMessage(crowded, 'a', 'b', 'x')).toEqual({ sent: false, reason: 'mailbox-full' });
  });

  it('redacts a secret and truncates long text', () => {
    const secret = delivered(live('a', 'b'), 'a', 'b', 'Authorization: Bearer sk-live-9');
    expect(inboxFor(secret, 'b')[0]?.text).not.toContain('sk-live-9');
    const long = delivered(live('a', 'b'), 'a', 'b', 'x'.repeat(MAX_MESSAGE_LENGTH + 50));
    expect(inboxFor(long, 'b')[0]?.text).toHaveLength(MAX_MESSAGE_LENGTH);
  });

  it('returns only mail after the cursor and never another address', () => {
    let mailbox = live('a', 'b');
    mailbox = delivered(mailbox, 'a', 'b', 'one');
    mailbox = delivered(mailbox, 'a', 'b', 'two');
    mailbox = delivered(mailbox, 'b', 'a', 'reply');
    expect(inboxFor(mailbox, 'b', 1).map((m) => m.text)).toEqual(['two']);
    expect(inboxFor(mailbox, 'a').map((m) => m.text)).toEqual(['reply']);
  });

  it('acknowledge drops read mail but keeps the sender quota spent', () => {
    const mailbox = delivered(live('a', 'b'), 'a', 'b', 'one');
    const read = acknowledge(mailbox, 'b', 1);
    expect(read.messages).toHaveLength(0);
    expect(read.sent.a).toBe(1);
    expect(acknowledge(read, 'b', 1)).toBe(read);
  });

  it('retiring an address drops it and its unread mail', () => {
    const mailbox = delivered(live('a', 'b'), 'a', 'b', 'never read');
    const retired = retireAddress(mailbox, 'b');
    expect(retired.addresses).toEqual(['a']);
    expect(retired.messages).toHaveLength(0);
    expect(retireAddress(retired, 'b')).toBe(retired);
    expect(sendMessage(retired, 'a', 'b', 'late')).toEqual({
      sent: false,
      reason: 'unknown-recipient',
    });
  });
});

function harness(caller: string, initial: AgentMailbox) {
  const state = { mailbox: initial };
  const port = {
    read: () => state.mailbox,
    write: (mailbox: AgentMailbox) => {
      state.mailbox = mailbox;
    },
    callerAddress: () => caller,
  };
  const executor = new AgentMailboxToolExecutor(port);
  const call = (operation: string, args: Record<string, unknown>) =>
    executor.execute({
      toolName: agentMailboxToolDefinition.name,
      operation,
      arguments: args,
    } as ToolInvocation);
  return { state, call, port };
}

describe('runtime.messages executor', () => {
  it('stamps the sender from the host, ignoring any claimed sender', async () => {
    const { state, call } = harness('a', live('a', 'b'));
    const output = await call('send', { to: 'b', text: 'hi', from: 'security-reviewer' });
    expect(output.structured).toEqual({ sent: true, sequence: 1 });
    expect(state.mailbox.messages[0]?.from).toBe('a');
  });

  it('reports a refused send with the reason and peers instead of throwing', async () => {
    const { call } = harness('a', live('a', 'b'));
    const output = await call('send', { to: 'ghost', text: 'hi' });
    expect(output.structured).toEqual({
      sent: false,
      reason: 'unknown-recipient',
      peers: [MAIN_ADDRESS, 'b'],
    });
  });

  it('receive returns newer mail and discards what was read', async () => {
    const { state, call } = harness(MAIN_ADDRESS, delivered(live('a'), 'a', MAIN_ADDRESS, 'done'));
    const output = await call('receive', {});
    expect(output.structured).toEqual({
      messages: [{ from: 'a', text: 'done', sequence: 1 }],
      latest: 1,
    });
    expect(state.mailbox.messages).toHaveLength(0);
    expect((await call('receive', { since: 1 })).structured).toEqual({ messages: [], latest: 1 });
  });

  it('lists peers and rejects unknown operations and tools', async () => {
    const { call, port } = harness('a', live('a', 'b'));
    expect((await call('peers', {})).structured).toEqual({ peers: [MAIN_ADDRESS, 'b'] });
    expect(() => call('wipe', {})).toThrow('Unknown messages operation');
    expect(() =>
      new AgentMailboxToolExecutor(port).execute({
        toolName: 'other',
        operation: 'peers',
        arguments: {},
      } as ToolInvocation),
    ).toThrow('Unknown messages tool');
  });
});
