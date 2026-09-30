import { z } from 'zod';

import { acknowledge, inboxFor, peersOf, sendMessage } from '../core/agent-mailbox';
import { MAIN_ADDRESS, MAX_MESSAGE_LENGTH } from '../core/agent-mailbox.constants';
import { WINDOW_ADDRESS_PREFIX } from '../core/cross-window-mailbox.constants';
import { runtimeToolInputSchemas } from '../core/runtime/runtime-tool-input-schemas';

import type { AgentMailboxPort, WindowMailView } from './agent-mailbox-tool-executor.types';
import type { CrossWindowMailboxPort } from '../core/cross-window-mailbox.types';
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
    'Direct messages between agents and the main session. peers lists who you can write to, ' +
    'including other live VS Code windows of this user (addresses starting window:). ' +
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
 * and every live sub-agent, plus, for the main session only, the main sessions
 * of the user's other VS Code windows. Steering is the parent-to-child channel
 * scoped to a single run; this is the one that lets a sibling or the main
 * session be told something too.
 */
export class AgentMailboxToolExecutor implements RuntimeToolExecutorPort {
  constructor(
    private readonly port: AgentMailboxPort,
    /** Other VS Code windows. Given to the main session's executor, never a sub-agent's. */
    private readonly windows?: CrossWindowMailboxPort,
  ) {}

  execute(invocation: ToolInvocation): Promise<RuntimeToolExecutionOutput> {
    if (invocation.toolName !== agentMailboxToolDefinition.name) {
      throw new Error('Unknown messages tool');
    }
    if (invocation.operation === 'send') return this.send(invocation.arguments);
    if (invocation.operation === 'receive') return this.receive(invocation.arguments);
    if (invocation.operation === 'peers') return this.peers();
    throw new Error('Unknown messages operation');
  }

  private async send(args: unknown): Promise<RuntimeToolExecutionOutput> {
    const { to, text } = sendSchema.parse(args);
    const caller = this.port.callerAddress();
    if (to.startsWith(WINDOW_ADDRESS_PREFIX)) return this.sendToWindow(to, caller, text);
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

  private async sendToWindow(
    to: string,
    caller: string,
    text: string,
  ): Promise<RuntimeToolExecutionOutput> {
    if (this.windows === undefined || caller !== MAIN_ADDRESS) {
      return { structured: { sent: false, reason: 'unknown-recipient' } };
    }
    const result = await this.windows.send(to, caller, text);
    return {
      structured: result.sent
        ? { sent: true, id: result.id }
        : { sent: false, reason: result.reason },
    };
  }

  private async receive(args: unknown): Promise<RuntimeToolExecutionOutput> {
    const { since } = receiveSchema.parse(args);
    const caller = this.port.callerAddress();
    const mailbox = this.port.read();
    const messages = inboxFor(mailbox, caller, since);
    // Reading is the acknowledgement, so the inbox does not fill for good.
    this.port.write(acknowledge(mailbox, caller, messages.at(-1)?.sequence ?? since));
    const remote = await this.receiveFromWindows(caller);
    return {
      structured: {
        ...(remote.length > 0 ? { windowMessages: remote } : {}),
        messages: messages.map((message) => ({
          from: message.from,
          text: message.text,
          sequence: message.sequence,
        })),
        latest: messages.at(-1)?.sequence ?? since,
      },
    };
  }

  private async receiveFromWindows(caller: string): Promise<readonly WindowMailView[]> {
    if (this.windows === undefined || caller !== MAIN_ADDRESS) return [];
    const mail = await this.windows.receive();
    if (typeof mail === 'string') return [];
    return mail.map((m) => ({
      id: m.id,
      from: `${m.fromWorkspace} [window ${m.fromWindowId.slice(0, 8)}] ${m.fromAddress}`,
      fromAddress: `${WINDOW_ADDRESS_PREFIX}${m.fromWindowId}`,
      text: m.text,
    }));
  }

  private async peers(): Promise<RuntimeToolExecutionOutput> {
    const caller = this.port.callerAddress();
    const local = [...peersOf(this.port.read(), caller)];
    if (this.windows === undefined || caller !== MAIN_ADDRESS) {
      return { structured: { peers: local } };
    }
    const others = await this.windows.peers();
    if (typeof others === 'string') {
      return { structured: { peers: local, windowsRefused: others } };
    }
    return {
      structured: {
        peers: [...local, ...others.map((peer) => peer.address)],
        windows: others.map((peer) => ({
          address: peer.address,
          workspace: peer.workspaceName,
          seenMsAgo: peer.ageMs,
        })),
      },
    };
  }
}
