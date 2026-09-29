import type { AgentMailbox } from '../core/agent-mailbox.types';

/**
 * The mailbox one workspace shares, and who is calling.
 *
 * The caller comes from the port because it cannot be trusted to state it: the
 * main session is `main`, a sub-agent is its task id.
 */
export interface AgentMailboxPort {
  read(): AgentMailbox;
  write(mailbox: AgentMailbox): void;
  callerAddress(): string;
}
