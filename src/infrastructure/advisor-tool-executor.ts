import { advisorInputSchema, buildAdvicePrompt, pickAdvisor, recordAdvice } from '../core/advisor';
import { runtimeToolInputSchemas } from '../core/runtime/runtime-tool-input-schemas';

import type { AdvisorPort } from './advisor-tool-executor.types';
import type { ToolDefinition, ToolInvocation } from '../core/runtime/runtime-tool-contracts';
import type {
  RuntimeToolExecutionOutput,
  RuntimeToolExecutorPort,
} from '../services/runtime-tool-dispatcher';

export const advisorToolDefinition: ToolDefinition = {
  schemaVersion: '2.0',
  name: 'runtime.advisor',
  version: '2.0.0',
  description:
    'Ask a DIFFERENT model for a second opinion on one question. Arguments: question is what ' +
    'you want judged, context is the facts it needs in your own words. The advisor cannot act, ' +
    'read the workspace, or see this conversation — it answers the question you write and ' +
    'nothing else. Its reply is advice, never a decision: you remain responsible for what ' +
    'happens next, and disagreeing with it is a valid outcome. Use it where a second reading ' +
    'genuinely changes your confidence, not to confirm what you already concluded.',
  operations: ['consult'],
  riskClasses: ['inspect'],
  targetIds: ['target:workspace'],
  inputSchema: runtimeToolInputSchemas.advisor,
};

/**
 * A second opinion, on request, from a model that is not the one running.
 *
 * Delegation already existed: a sub-agent can be given work. What did not exist
 * was consultation — asking, mid-run, whether a conclusion holds, without
 * handing over the task or the workspace.
 *
 * The advisor gets the question and the asker's own summary, and nothing else.
 * It has no tools, no root key and no sight of the conversation, so the worst a
 * bad advisor can do is give bad advice, which the run is free to reject. A
 * consultant with the workspace would be a second agent nobody scoped.
 */
export class AdvisorToolExecutor implements RuntimeToolExecutorPort {
  constructor(private readonly port: AdvisorPort) {}

  async execute(
    invocation: ToolInvocation,
    signal?: AbortSignal,
  ): Promise<RuntimeToolExecutionOutput> {
    if (invocation.toolName !== advisorToolDefinition.name) throw new Error('Unknown advisor tool');
    if (invocation.operation !== 'consult') throw new Error('Unknown advisor operation');
    const { question, context } = advisorInputSchema.parse(invocation.arguments);
    const advisor = pickAdvisor(this.port.catalog(), this.port.runningModelKey());
    if (advisor === undefined) {
      // Reported rather than thrown. One model being reachable is a fact about
      // the account, not a fault in the call, and a run that fails here would
      // be failing for asking a reasonable question.
      return {
        structured: {
          consulted: false,
          reason: 'no-second-model',
          binding: false,
        },
      };
    }
    const advice = await this.port.consult(advisor, buildAdvicePrompt(question, context), signal);
    return { structured: { consulted: true, ...recordAdvice(advisor, question, advice) } };
  }
}
