import { createAgentRunSnapshot } from '../core/agent-run';

import {
  buildAnalysisPrompt,
  buildEditPlanRepairPrompt,
  buildWorkflowPrompt,
  parseWorkflowEditPlan,
} from './workflow-service';

import type {
  AgentRunCallbacks,
  AgentRunChatPort,
  AgentRunContextPort,
  AgentRunEditPort,
  AgentRunInput,
  AgentRunResult,
  AgentRunSessionPort,
} from './agent-run-service.types';
import type { CollectedContext } from '../core/context-collector';
import type { EditPlan } from '../core/edit-plan';

async function collectContext(
  input: AgentRunInput,
  context: AgentRunContextPort,
  session: AgentRunSessionPort,
): Promise<CollectedContext> {
  const resolvedMode = context.resolve(input.contextMode);
  if (resolvedMode === 'workspace' && !(await session.authorize('workspaceContext'))) {
    throw new Error('Workspace context access was not approved.');
  }
  return context.collect(resolvedMode, input.configuration);
}

export class AgentRunService {
  constructor(
    private readonly context: AgentRunContextPort,
    private readonly session: AgentRunSessionPort,
    private readonly chat: AgentRunChatPort,
    private readonly edits: AgentRunEditPort,
  ) {}

  async run(input: AgentRunInput, callbacks: AgentRunCallbacks): Promise<AgentRunResult> {
    try {
      callbacks.onPhase(createAgentRunSnapshot('reading'));
      const context = await collectContext(input, this.context, this.session);
      const rules = await this.context.projectRules();
      if (this.session.isPlanMode()) {
        return await this.runPlan(input, context, rules, callbacks);
      }
      if (!(await this.session.authorize('editGeneration'))) {
        callbacks.onPhase(createAgentRunSnapshot('rejected'));
        return {
          status: 'rejected',
          content: '',
          context,
        };
      }
      return await this.runEdit(input, context, rules, callbacks);
    } catch (error: unknown) {
      const summary = error instanceof Error ? error.message : 'ClawAI coding run failed.';
      callbacks.onPhase(createAgentRunSnapshot('failed', undefined, summary));
      throw error;
    }
  }

  private async runPlan(
    input: AgentRunInput,
    context: CollectedContext,
    rules: string,
    callbacks: AgentRunCallbacks,
  ): Promise<AgentRunResult> {
    callbacks.onPhase(createAgentRunSnapshot('generating'));
    const response = await this.send(
      input,
      buildAnalysisPrompt({
        context: context.files,
        kind: 'plan',
        request: input.content,
        ...(rules.length === 0 ? {} : { rules }),
      }),
      callbacks,
    );
    callbacks.onPhase(createAgentRunSnapshot('planned'));
    return {
      status: 'planned',
      content: response.content,
      context,
      threadId: response.threadId,
    };
  }

  private async runEdit(
    input: AgentRunInput,
    context: CollectedContext,
    rules: string,
    callbacks: AgentRunCallbacks,
  ): Promise<AgentRunResult> {
    callbacks.onPhase(createAgentRunSnapshot('generating'));
    let response = await this.send(
      input,
      buildWorkflowPrompt({
        context: context.files,
        kind: input.kind ?? 'generate',
        request: input.content,
        ...(rules.length === 0 ? {} : { rules }),
      }),
      callbacks,
    );
    let plan: EditPlan;
    try {
      plan = parseWorkflowEditPlan(response.content);
    } catch {
      response = await this.send(input, buildEditPlanRepairPrompt(response.content), callbacks);
      plan = parseWorkflowEditPlan(response.content);
    }
    callbacks.onPhase(createAgentRunSnapshot('reviewing', plan, plan.summary));
    const editResult = await this.edits.previewAndApply(plan);
    const status = editResult.applied ? 'applied' : 'rejected';
    callbacks.onPhase(createAgentRunSnapshot(status, plan, plan.summary));
    let commandsExecuted: boolean | undefined;
    if (editResult.applied && (plan.commands?.length ?? 0) > 0) {
      commandsExecuted = await this.runCommands(plan, input.signal, callbacks);
    }
    return {
      status,
      content: response.content,
      context,
      editPlan: plan,
      ...(commandsExecuted === undefined ? {} : { commandsExecuted }),
      threadId: response.threadId,
    };
  }

  private async runCommands(
    plan: EditPlan,
    signal: AbortSignal,
    callbacks: AgentRunCallbacks,
  ): Promise<boolean> {
    const commands = plan.commands ?? [];
    const approved = await this.session.authorize(
      'commandExecution',
      commands.map((entry) => `${entry.purpose}: ${entry.command}`),
    );
    if (!approved) {
      return false;
    }
    callbacks.onPhase(createAgentRunSnapshot('executing', plan, plan.summary));
    for (const command of commands) {
      const result = await this.edits.execute(command, signal);
      if (result.exitCode !== 0) {
        throw new Error(
          `Command failed with exit code ${String(result.exitCode ?? 'unknown')}: ${command.command}`,
        );
      }
    }
    callbacks.onPhase(createAgentRunSnapshot('verified', plan, plan.summary));
    return true;
  }

  private send(
    input: AgentRunInput,
    content: string,
    callbacks: AgentRunCallbacks,
    threadId?: string,
  ): ReturnType<AgentRunChatPort['send']> {
    return this.chat.send(
      {
        content: this.session.preparePrompt(content),
        context: [],
        ...input.selection,
        ...(threadId === undefined ? {} : { threadId }),
      },
      (event) => {
        callbacks.onEvent(event);
      },
      input.signal,
      (threadId) => {
        callbacks.onThread(threadId);
      },
    );
  }
}
