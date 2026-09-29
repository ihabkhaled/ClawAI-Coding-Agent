import { z } from 'zod';

import { acknowledge, inboxFor, peersOf, sendMessage } from '../core/agent-mailbox';
import { MAX_MESSAGE_LENGTH } from '../core/agent-mailbox.constants';
import { runtimeToolInputSchemas } from '../core/runtime/runtime-tool-input-schemas';

import type { AgentMailboxPort } from './agent-mailbox-tool-executor.types';
import type { ToolDefinition, ToolInvocation } from '../core/runtime/runtime-tool-contracts';
import type {
  RuntimeToolExecutionOutput,
  RuntimeToolExecutorPort,
} from '../services/runtime-tool-dispatcher';

const sendSchema = z.object({
  to: z.string().trim().min(1).max(200),
  text: z.string().trim().min(1).max(MAX_MESSAGE_LENGTH),
});

const receiveSchema = z.object({
  since: z.number().int().nonnegative().max(1_000_000).default(0),
});

export const agentMailboxToolDefinition: ToolDefinition = {
  schemaVersion: '2.0',
  name: 'runtime.messages',
  version: '2.0.0',
  description:
    'Direct messages between agents and the main session. peers lists who you can write to. ' +
    'send takes to (an address from peers) and text; the sender is you, always. receive takes ' +
    'since, the highest sequence you have already read, and returns only newer messages ' +
    'addressed to you, then discards what you have read. Use it to hand off or ask one agent ' +
    'something; use runtime.board for a note every agent should see. Quotas are bounded and a ' +
    'refused send names the limit.',
  operations: ['send', 'receive', 'peers'],
  riskClasses: ['inspect'],
  targetIds: ['target:workspace'],
  inputSchema: runtimeToolInputSchemas.messages,
};

/**
 * Addressed messaging between the sessions of one workspace: the main session
 * and every live sub-agent. Steering is the parent-to-child channel scoped to a
 * single run; this is the one that lets a sibling or the main session be told
 * something too.
 */
export class AgentMailboxToolExecutor implements RuntimeToolExecutorPort {
  constructor(private readonly port: AgentMailboxPort) {}

  execute(invocation: ToolInvocation): Promise<RuntimeToolExecutionOutput> {
    if (invocation.toolName !== agentMailboxToolDefinition.name) {
      throw new Error('Unknown messages tool');
    }
    if (invocation.operation === 'send') return Promise.resolve(this.send(invocation.arguments));
    if (invocation.operation === 'receive') {
      return Promise.resolve(this.receive(invocation.arguments));
    }
    if (invocation.operation === 'peers') return Promise.resolve(this.peers());
    throw new Error('Unknown messages operation');
  }

  private send(args: unknown): RuntimeToolExecutionOutput {
    const { to, text } = sendSchema.parse(args);
    const caller = this.port.callerAddress();
    const result = sendMessage(this.port.read(), caller, to, text);
    if (!result.sent) {
      // Reported, not thrown: a full inbox is a fact about the recipient, and
      // failing the call would end a run over a message.
      return {
        structured: {
          sent: false,
          reason: result.reason,
          peers: [...peersOf(this.port.read(), caller)],
        },
      };
    }
    this.port.write(result.mailbox);
    return { structured: { sent: true, sequence: result.sequence } };
  }

  private receive(args: unknown): RuntimeToolExecutionOutput {
    const { since } = receiveSchema.parse(args);
    const caller = this.port.callerAddress();
    const mailbox = this.port.read();
    const messages = inboxFor(mailbox, caller, since);
    // Reading is the acknowledgement, so the inbox does not fill for good.
    this.port.write(acknowledge(mailbox, caller, messages.at(-1)?.sequence ?? since));
    return {
      structured: {
        messages: messages.map((message) => ({
          from: message.from,
          text: message.text,
          sequence: message.sequence,
        })),
        latest: messages.at(-1)?.sequence ?? since,
      },
    };
  }

  private peers(): RuntimeToolExecutionOutput {
    return { structured: { peers: [...peersOf(this.port.read(), this.port.callerAddress())] } };
  }
}
