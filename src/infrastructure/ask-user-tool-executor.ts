import { runtimeToolInputSchemas } from '../core/runtime/runtime-tool-input-schemas';
import { describeQuestionAnswer, userQuestionInputSchema } from '../core/user-question';

import type { ToolDefinition, ToolInvocation } from '../core/runtime/runtime-tool-contracts';
import type { UserQuestionAnswer, UserQuestionInput } from '../core/user-question';
import type {
  RuntimeToolExecutionOutput,
  RuntimeToolExecutorPort,
} from '../services/runtime-tool-dispatcher';

export interface UserQuestionPort {
  ask(input: UserQuestionInput, signal?: AbortSignal): Promise<UserQuestionAnswer>;
}

export const askUserToolDefinition: ToolDefinition = {
  schemaVersion: '2.0',
  name: 'runtime.ask',
  version: '2.0.0',
  description:
    'Ask the user one multiple-choice question when a decision is genuinely theirs and the ' +
    'answer changes what you do next. Arguments: header is a chip of at most 24 characters, ' +
    'question is the full sentence, options is 2 to 4 entries of {label, description}, and ' +
    'allowOther defaults to true so they can type an answer the options miss. Prefer a sensible ' +
    'default and say what you chose; do not ask what the code or the request already answers. ' +
    'A dismissed question is reported as dismissed and is not a choice.',
  operations: ['ask'],
  riskClasses: ['inspect'],
  targetIds: ['target:workspace'],
  inputSchema: runtimeToolInputSchemas.ask,
};

/**
 * The agent's one way to put a decision back to the user mid-run.
 *
 * Before this, the only interruption available was a yes/no approval attached
 * to a side effect, so a model facing a real fork either guessed or wrote the
 * question into its prose and carried on without the answer. This rides the
 * same broker as approvals — one queue, one modal slot, one cancellation — so
 * a run that ends withdraws its question exactly as it withdraws its approvals.
 */
export class AskUserToolExecutor implements RuntimeToolExecutorPort {
  constructor(private readonly questions: UserQuestionPort) {}

  async execute(
    invocation: ToolInvocation,
    signal?: AbortSignal,
  ): Promise<RuntimeToolExecutionOutput> {
    if (invocation.toolName !== askUserToolDefinition.name) throw new Error('Unknown ask tool');
    if (invocation.operation !== 'ask') throw new Error('Unknown ask operation');
    const input = userQuestionInputSchema.parse(invocation.arguments);
    const answer = await this.questions.ask(input, signal);
    return {
      structured: {
        answered: answer.kind !== 'dismissed',
        kind: answer.kind,
        answer: describeQuestionAnswer(answer),
      },
    };
  }
}
