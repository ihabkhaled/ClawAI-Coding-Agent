import { redactText } from '../core/redaction';

import {
  TEAM_MAILBOX_LIMIT,
  TEAM_MESSAGE_MAX_CHARS,
  TEAM_SENDER_LIMIT,
} from './agent-team-tool.constants';

import type { TeamBus, TeamMessage } from './agent-team-tool.types';

/**
 * The in-process message bus of one run.
 *
 * `post` takes the sender from the caller, which is the tool bound to one agent,
 * never from anything the model wrote, so a message cannot claim to come from
 * someone else. Text is redacted and cut; a mailbox holds a few messages and
 * refuses the next, so a chatty agent is told rather than silently dropped on
 * or allowed to grow memory; and one sender has a total allowance.
 */
export function createTeamBus(): TeamBus {
  const boxes = new Map<string, TeamMessage[]>();
  const closed = new Set<string>();
  const sent = new Map<string, number>();
  const listeners = new Set<(to: string) => void>();
  let next = 1;
  return {
    register: (name) => {
      if (!boxes.has(name)) boxes.set(name, []);
      closed.delete(name);
    },
    close: (name) => {
      closed.add(name);
    },
    post: (from, to, text) => {
      const box = boxes.get(to);
      if (box === undefined) throw new Error(`No agent named "${to}" is on this team.`);
      if (closed.has(to)) throw new Error(`"${to}" has finished and no longer reads messages.`);
      if (to === from) throw new Error('A message to yourself is not delivered; use notes.');
      const body = redactText(text.trim()).slice(0, TEAM_MESSAGE_MAX_CHARS);
      if (body.length === 0) throw new Error('A message needs a non-empty "text".');
      if ((sent.get(from) ?? 0) >= TEAM_SENDER_LIMIT) {
        throw new Error(
          `You have sent ${String(TEAM_SENDER_LIMIT)} messages; no more are accepted.`,
        );
      }
      if (box.length >= TEAM_MAILBOX_LIMIT) {
        throw new Error(
          `"${to}" has ${String(box.length)} unread messages; wait for it to read them.`,
        );
      }
      sent.set(from, (sent.get(from) ?? 0) + 1);
      const message: TeamMessage = { id: next, from, to, text: body };
      next += 1;
      box.push(message);
      for (const listener of listeners) listener(to);
      return message;
    },
    drain: (name, limit) => {
      const box = boxes.get(name) ?? [];
      const taken: TeamMessage[] = [];
      let used = 0;
      while (box.length > 0) {
        const head = box[0];
        if (head === undefined || (taken.length > 0 && used + head.text.length > limit)) break;
        taken.push(head);
        used += head.text.length;
        box.shift();
      }
      return taken;
    },
    pending: (name) => boxes.get(name)?.length ?? 0,
    onPost: (listener) => {
      listeners.add(listener);
      return () => listeners.delete(listener);
    },
  };
}
