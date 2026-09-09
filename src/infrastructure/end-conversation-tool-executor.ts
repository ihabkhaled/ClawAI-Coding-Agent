import { conversationEndInputSchema, decideConversationEnd } from '../core/conversation-end';
import { runtimeToolInputSchemas } from '../core/runtime/runtime-tool-input-schemas';

import type { ConversationEndInput, PendingInterruptions } from '../core/conversation-end';
import type { ToolDefinition, ToolInvocation } from '../core/runtime/runtime-tool-contracts';
import type {
  RuntimeToolExecutionOutput,
  RuntimeToolExecutorPort,
} from '../services/runtime-tool-dispatcher';

export interface ConversationEndPort {
  /** What the user still owes an answer to, read at the moment of the call. */
  pending(): PendingInterruptions;
  /** Writes the terminal record. Resolves once it is durable. */
  finish(input: ConversationEndInput): Promise<void>;
}

export const endConversationToolDefinition: ToolDefinition = {
  schemaVersion: '2.0',
  name: 'runtime.end',
  version: '2.0.0',
  description:
    'Declare this run finished and write its terminal record. Arguments: reason is one or two ' +
    'sentences saying what was achieved or why it stopped, lifecycle is "completed" or ' +
    '"abandoned". Refused while an approval or a question is still open, and the refusal names ' +
    'which — resolve or withdraw it, then call again. Stop calling tools after this returns.',
  operations: ['end'],
  riskClasses: ['inspect'],
  targetIds: ['target:workspace'],
  inputSchema: runtimeToolInputSchemas.end,
};

/**
 * The agent's terminal action.
 *
 * A refusal comes back as a normal result rather than an error, because
 * "there is still an approval open" is something the model should read and
 * act on, not a failure to retry blindly.
 *
 * It records terminality; it does not kill the loop. Cancelling the run from
 * inside one of its own tool calls would abort the invocation that is writing
 * the record, so the one durable statement about how the run ended is the
 * thing that would be lost. The run ends the way it always has — the model
 * stops, or a budget stops it — and now leaves a terminal record behind.
 */
export class EndConversationToolExecutor implements RuntimeToolExecutorPort {
  constructor(private readonly conversation: ConversationEndPort) {}

  async execute(invocation: ToolInvocation): Promise<RuntimeToolExecutionOutput> {
    if (invocation.toolName !== endConversationToolDefinition.name) {
      throw new Error('Unknown end tool');
    }
    if (invocation.operation !== 'end') throw new Error('Unknown end operation');
    const input = conversationEndInputSchema.parse(invocation.arguments);
    const decision = decideConversationEnd(this.conversation.pending());
    if (!decision.allowed) {
      return { structured: { ended: false, refusal: decision.refusal } };
    }
    await this.conversation.finish(input);
    return { structured: { ended: true, lifecycle: input.lifecycle } };
  }
}
