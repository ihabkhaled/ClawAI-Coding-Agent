import {
  MAIN_ADDRESS,
  MAX_MAILBOX_MESSAGES,
  MAX_MESSAGE_LENGTH,
  MAX_SENT_PER_SENDER,
  MAX_UNREAD_PER_RECIPIENT,
} from './agent-mailbox.constants';
import { redactText } from './redaction';

import type { AgentMailbox, AgentMessage, AgentSendResult } from './agent-mailbox.types';

export const EMPTY_MAILBOX: AgentMailbox = {
  addresses: [],
  messages: [],
  nextSequence: 1,
  sent: {},
};

/**
 * Makes an agent addressable.
 *
 * Steering was scoped to one run: a coordinator could tell a child something,
 * and nothing could tell a sibling or the session that started the work. An
 * address exists only while its agent is live, so a message can never be
 * accepted for a reader that will not come back.
 */
export function registerAddress(mailbox: AgentMailbox, address: string): AgentMailbox {
  if (address === MAIN_ADDRESS || mailbox.addresses.includes(address)) return mailbox;
  return { ...mailbox, addresses: [...mailbox.addresses, address] };
}

/** Removes an address and everything still waiting for it, which nobody will read. */
export function retireAddress(mailbox: AgentMailbox, address: string): AgentMailbox {
  if (!mailbox.addresses.includes(address)) return mailbox;
  return {
    ...mailbox,
    addresses: mailbox.addresses.filter((candidate) => candidate !== address),
    messages: mailbox.messages.filter((message) => message.to !== address),
  };
}

/** Who a caller can write to: the main session and every live agent but itself. */
export function peersOf(mailbox: AgentMailbox, caller: string): readonly string[] {
  return [MAIN_ADDRESS, ...mailbox.addresses].filter((address) => address !== caller);
}

/**
 * Sends one message, or says which limit refused it.
 *
 * The sender comes from the host, never from the arguments: an agent that could
 * name itself could write as the security reviewer, and a warning attributed to
 * the reviewer carries weight the sender did not earn. Text is redacted before
 * it is stored, so a secret one agent saw does not travel to another.
 *
 * Refusals are reported rather than thrown. "Your quota is spent" and "their
 * inbox is full" call for different responses, and an agent told only "no"
 * retries the same message.
 */
export function sendMessage(
  mailbox: AgentMailbox,
  from: string,
  to: string,
  text: string,
): AgentSendResult {
  if (from === to) return { sent: false, reason: 'self' };
  if (!peersOf(mailbox, from).includes(to)) return { sent: false, reason: 'unknown-recipient' };
  const clean = redactText(text.trim()).slice(0, MAX_MESSAGE_LENGTH);
  if (mailbox.messages.length >= MAX_MAILBOX_MESSAGES) {
    return { sent: false, reason: 'mailbox-full' };
  }
  if ((mailbox.sent[from] ?? 0) >= MAX_SENT_PER_SENDER) {
    return { sent: false, reason: 'sender-quota' };
  }
  if (mailbox.messages.filter((message) => message.to === to).length >= MAX_UNREAD_PER_RECIPIENT) {
    return { sent: false, reason: 'inbox-full' };
  }
  if (mailbox.messages.some((m) => m.from === from && m.to === to && m.text === clean)) {
    return { sent: false, reason: 'duplicate' };
  }
  const sequence = mailbox.nextSequence;
  const message: AgentMessage = { sequence, from, to, text: clean };
  return {
    sent: true,
    sequence,
    mailbox: {
      ...mailbox,
      messages: [...mailbox.messages, message],
      nextSequence: sequence + 1,
      sent: { ...mailbox.sent, [from]: (mailbox.sent[from] ?? 0) + 1 },
    },
  };
}

/** What is waiting for one address after `since`. Other addresses' mail is never returned. */
export function inboxFor(
  mailbox: AgentMailbox,
  address: string,
  since = 0,
): readonly AgentMessage[] {
  return mailbox.messages.filter((message) => message.to === address && message.sequence > since);
}

/**
 * Drops what an address has read, up to and including `through`.
 *
 * Reading with a cursor is also the acknowledgement: without it the main
 * session, which is never retired, would fill its inbox once and refuse every
 * later sender for the rest of the workspace.
 */
export function acknowledge(mailbox: AgentMailbox, address: string, through: number): AgentMailbox {
  const remaining = mailbox.messages.filter(
    (message) => !(message.to === address && message.sequence <= through),
  );
  return remaining.length === mailbox.messages.length
    ? mailbox
    : { ...mailbox, messages: remaining };
}
