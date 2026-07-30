import { createAgentRunSnapshot } from '../core/agent-run';
import { EMPTY_CONTEXT } from '../core/empty-context';
import { addTokenReceipts } from '../core/token-telemetry';

import {
  enforcePostEditCancellation,
  hasNoPlannedActions,
  shouldRunCommands,
} from './agent-run-guards';
import { buildToolResultPrompt, isDiagnosticToolPlan } from './tool-result-prompt';
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
  CommandExecutionResult,
} from './agent-run-service.types';
import type { CollectedContext } from '../core/context-collector';
import type { EditPlan } from '../core/edit-plan';

interface CommandExecutionOutcome {
  commandError?: string;
  commandsCompleted?: number;
  commandsExecuted?: boolean;
  commandsTotal?: number;
  commandResults?: CommandExecutionResult[];
}

function commandMetadata(
  outcome: CommandExecutionOutcome,
): Partial<
  Pick<
    AgentRunResult,
    'commandError' | 'commandResults' | 'commandsCompleted' | 'commandsExecuted' | 'commandsTotal'
  >
> {
  return {
    ...(outcome.commandError === undefined ? {} : { commandError: outcome.commandError }),
    ...(outcome.commandResults === undefined ? {} : { commandResults: outcome.commandResults }),
    ...(outcome.commandsCompleted === undefined
      ? {}
      : { commandsCompleted: outcome.commandsCompleted }),
    ...(outcome.commandsExecuted === undefined
      ? {}
      : { commandsExecuted: outcome.commandsExecuted }),
    ...(outcome.commandsTotal === undefined ? {} : { commandsTotal: outcome.commandsTotal }),
  };
}

function commandOutcomeApplied(outcome: CommandExecutionOutcome): boolean {
  return outcome.commandsExecuted === true || (outcome.commandsCompleted ?? 0) > 0;
}

function runMetadata(
  threadId: string | undefined,
  tokens: AgentRunResult['tokens'],
): Partial<Pick<AgentRunResult, 'threadId' | 'tokens'>> {
  return {
    ...(threadId === undefined ? {} : { threadId }),
    ...(tokens === undefined ? {} : { tokens }),
  };
}

function combineTokens(
  first: AgentRunResult['tokens'],
  second: AgentRunResult['tokens'],
): AgentRunResult['tokens'] {
  if (first === undefined) {
    return second;
  }
  if (second === undefined) {
    return first;
  }
  return addTokenReceipts(first, second);
}

function transportedContext(
  context: CollectedContext,
  response: Awaited<ReturnType<AgentRunChatPort['send']>>,
): CollectedContext {
  return response.contextReceipt === undefined
    ? context
    : { ...context, receipt: response.contextReceipt };
}

function isConversationalRequest(content: string): boolean {
  return /^(?:(?:please\s+)?say\s+(?:hi|hello|hey)(?:\s+(?:back|to\s+me))?|(?:hi|hello|hey)(?:\s+(?:clawai|there))?|good\s+(?:morning|afternoon|evening)|thanks|thank\s+you)[!,.?\s]*$/iu.test(
    content.trim(),
  );
}

async function collectContext(
  input: AgentRunInput,
  context: AgentRunContextPort,
  session: AgentRunSessionPort,
): Promise<CollectedContext> {
  const resolvedMode = context.resolve(input.contextMode);
  if (
    resolvedMode === 'workspace' &&
    !(await session.authorize('workspaceContext', undefined, input.signal))
  ) {
    throw new Error('Workspace context access was not approved.');
  }
  input.signal.throwIfAborted();
  const collected = await context.collect(resolvedMode, input.configuration);
  input.signal.throwIfAborted();
  return collected;
}

async function prepareFileIds(input: AgentRunInput): Promise<string[] | undefined> {
  const fileIds = input.prepareFileIds === undefined ? input.fileIds : await input.prepareFileIds();
  input.signal.throwIfAborted();
  return fileIds === undefined || fileIds.length === 0 ? undefined : fileIds;
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
      const session = input.session ?? this.session;
      input.signal.throwIfAborted();
      if (isConversationalRequest(input.content)) {
        return await this.runConversation(input, callbacks, session, await prepareFileIds(input));
      }
      callbacks.onPhase(createAgentRunSnapshot('reading'));
      const context = await collectContext(input, this.context, session);
      const rules = await this.context.projectRules();
      input.signal.throwIfAborted();
      if (session.isPlanMode()) {
        return await this.runPlan(
          input,
          context,
          rules,
          callbacks,
          session,
          await prepareFileIds(input),
        );
      }
      const editGenerationApproved = await session.authorize(
        'editGeneration',
        undefined,
        input.signal,
      );
      input.signal.throwIfAborted();
      if (!editGenerationApproved) {
        callbacks.onPhase(createAgentRunSnapshot('rejected'));
        return {
          status: 'rejected',
          content: '',
          context,
        };
      }
      return await this.runEdit(
        input,
        context,
        rules,
        callbacks,
        session,
        await prepareFileIds(input),
      );
    } catch (error: unknown) {
      const summary = error instanceof Error ? error.message : 'ClawAI coding run failed.';
      callbacks.onPhase(createAgentRunSnapshot('failed', undefined, summary));
      throw error;
    }
  }

  private async runConversation(
    input: AgentRunInput,
    callbacks: AgentRunCallbacks,
    session: AgentRunSessionPort,
    fileIds: string[] | undefined,
  ): Promise<AgentRunResult> {
    callbacks.onPhase(createAgentRunSnapshot('generating'));
    const response = await this.send(input, input.content, callbacks, session, fileIds);
    input.signal.throwIfAborted();
    callbacks.onPhase(createAgentRunSnapshot('planned'));
    return {
      status: 'planned',
      content: response.content,
      context: EMPTY_CONTEXT,
      threadId: response.threadId,
      tokens: response.tokens,
    };
  }

  private async runPlan(
    input: AgentRunInput,
    context: CollectedContext,
    rules: string,
    callbacks: AgentRunCallbacks,
    session: AgentRunSessionPort,
    fileIds: string[] | undefined,
  ): Promise<AgentRunResult> {
    callbacks.onPhase(createAgentRunSnapshot('generating'));
    const response = await this.send(
      input,
      buildAnalysisPrompt({
        context: [],
        kind: 'plan',
        request: input.content,
        ...(rules.length === 0 ? {} : { rules }),
      }),
      callbacks,
      session,
      fileIds,
      undefined,
      context,
    );
    input.signal.throwIfAborted();
    callbacks.onPhase(createAgentRunSnapshot('planned'));
    return {
      status: 'planned',
      content: response.content,
      context: transportedContext(context, response),
      threadId: response.threadId,
      tokens: response.tokens,
    };
  }

  private async runEdit(
    input: AgentRunInput,
    context: CollectedContext,
    rules: string,
    callbacks: AgentRunCallbacks,
    session: AgentRunSessionPort,
    fileIds: string[] | undefined,
  ): Promise<AgentRunResult> {
    callbacks.onPhase(createAgentRunSnapshot('generating'));
    let response = await this.send(
      input,
      buildWorkflowPrompt({
        context: [],
        kind: input.kind ?? 'generate',
        request: input.content,
        ...(rules.length === 0 ? {} : { rules }),
      }),
      callbacks,
      session,
      fileIds,
      undefined,
      context,
    );
    input.signal.throwIfAborted();
    const runContext = transportedContext(context, response);
    let plan: EditPlan;
    let tokens: AgentRunResult['tokens'] = response.tokens;
    callbacks.onPhase(createAgentRunSnapshot('validating'));
    try {
      plan = parseWorkflowEditPlan(response.content);
    } catch {
      callbacks.onPhase(createAgentRunSnapshot('repairing'));
      callbacks.onEvent({ type: 'AGENT_DRAFT_RESET' });
      const malformed = response;
      response = await this.send(
        input,
        buildEditPlanRepairPrompt(input.content, malformed.content),
        callbacks,
        session,
        fileIds,
        malformed.threadId,
      );
      input.signal.throwIfAborted();
      tokens = combineTokens(malformed.tokens, response.tokens);
      callbacks.onPhase(createAgentRunSnapshot('validating'));
      plan = parseWorkflowEditPlan(response.content);
    }
    for (let diagnosticRound = 0; diagnosticRound < 2; diagnosticRound += 1) {
      if (!isDiagnosticToolPlan(plan)) {
        break;
      }
      const diagnostic = await this.completeEditPlan(
        plan,
        response.content,
        response.threadId,
        tokens,
        runContext,
        input.signal,
        callbacks,
        session,
      );
      if (diagnostic.status !== 'applied' || diagnostic.commandResults === undefined) {
        return diagnostic;
      }
      callbacks.onEvent({ type: 'AGENT_DRAFT_RESET' });
      const next = await this.send(
        input,
        buildToolResultPrompt(input.content, plan.commands ?? [], diagnostic.commandResults),
        callbacks,
        session,
        fileIds,
        response.threadId,
      );
      tokens = combineTokens(tokens, next.tokens);
      response = next;
      callbacks.onPhase(createAgentRunSnapshot('validating'));
      plan = parseWorkflowEditPlan(response.content);
    }
    if (isDiagnosticToolPlan(plan)) {
      callbacks.onPhase(
        createAgentRunSnapshot(
          'failed',
          plan,
          'ClawAI reached the two-round diagnostic safety limit.',
        ),
      );
      return {
        status: 'planned',
        content: 'ClawAI reached the two-round diagnostic safety limit.',
        context: runContext,
        editPlan: plan,
        ...runMetadata(response.threadId, tokens),
      };
    }
    return this.completeEditPlan(
      plan,
      response.content,
      response.threadId,
      tokens,
      runContext,
      input.signal,
      callbacks,
      session,
    );
  }

  private async completeEditPlan(
    plan: EditPlan,
    content: string,
    threadId: string | undefined,
    tokens: AgentRunResult['tokens'],
    context: CollectedContext,
    signal: AbortSignal,
    callbacks: AgentRunCallbacks,
    session: AgentRunSessionPort,
  ): Promise<AgentRunResult> {
    signal.throwIfAborted();
    if (hasNoPlannedActions(plan)) {
      callbacks.onPhase(createAgentRunSnapshot('planned'));
      return {
        status: 'planned',
        content: plan.summary,
        context,
        ...runMetadata(threadId, tokens),
      };
    }
    callbacks.onPhase(createAgentRunSnapshot('reviewing', plan, plan.summary));
    const editResult =
      plan.files.length === 0
        ? { applied: true, previews: [] }
        : await this.edits.previewAndApply(plan, signal, session);
    const filesApplied = plan.files.length > 0 && editResult.applied;
    enforcePostEditCancellation(signal, filesApplied);
    const commandOutcome = await this.attemptCommands(
      plan,
      signal,
      editResult.applied,
      callbacks,
      session,
    );
    const status = filesApplied || commandOutcomeApplied(commandOutcome) ? 'applied' : 'rejected';
    if (commandOutcome.commandsExecuted !== true) {
      callbacks.onPhase(createAgentRunSnapshot(status, plan, plan.summary));
    }
    return {
      status,
      content,
      context,
      editPlan: plan,
      filesApplied,
      ...(editResult.previewId === undefined ? {} : { previewId: editResult.previewId }),
      ...commandMetadata(commandOutcome),
      ...runMetadata(threadId, tokens),
    };
  }

  private async attemptCommands(
    plan: EditPlan,
    signal: AbortSignal,
    applied: boolean,
    callbacks: AgentRunCallbacks,
    session: AgentRunSessionPort,
  ): Promise<CommandExecutionOutcome> {
    if (!shouldRunCommands(signal, plan, applied)) {
      return {};
    }
    try {
      return await this.runCommands(plan, signal, callbacks, session);
    } catch (error: unknown) {
      return {
        commandError: error instanceof Error ? error.message : 'ClawAI command execution failed.',
        commandsCompleted: 0,
        commandsExecuted: false,
        commandsTotal: plan.commands?.length ?? 0,
      };
    }
  }

  private async runCommands(
    plan: EditPlan,
    signal: AbortSignal,
    callbacks: AgentRunCallbacks,
    session: AgentRunSessionPort,
  ): Promise<CommandExecutionOutcome> {
    const commands = plan.commands ?? [];
    const approved = await session.authorize(
      'commandExecution',
      commands.map((entry) => `${entry.purpose}: ${entry.command}`),
      signal,
    );
    signal.throwIfAborted();
    if (!approved) {
      return {
        commandsCompleted: 0,
        commandsExecuted: false,
        commandsTotal: commands.length,
      };
    }
    callbacks.onPhase(createAgentRunSnapshot('executing', plan, plan.summary));
    let commandsCompleted = 0;
    const commandResults: CommandExecutionResult[] = [];
    try {
      for (const command of commands) {
        signal.throwIfAborted();
        callbacks.onEvent({
          type: 'TOOL_STARTED',
          label: command.purpose,
          description: command.command,
        });
        const result = await this.edits.execute(command, signal);
        commandResults.push(result);
        callbacks.onEvent({
          type: 'TOOL_OUTPUT',
          label: command.purpose,
          description: [result.stdout, result.stderr].filter(Boolean).join('\n').slice(0, 8_000),
          exitCode: result.exitCode,
          truncated: result.truncated,
        });
        signal.throwIfAborted();
        if (result.exitCode !== 0) {
          return {
            commandError: `Command failed with exit code ${String(
              result.exitCode ?? 'unknown',
            )}: ${command.command}`,
            commandsCompleted,
            commandsExecuted: false,
            commandsTotal: commands.length,
            commandResults,
          };
        }
        commandsCompleted += 1;
      }
    } catch (error: unknown) {
      return {
        commandError: error instanceof Error ? error.message : 'ClawAI command execution failed.',
        commandsCompleted,
        commandsExecuted: false,
        commandsTotal: commands.length,
      };
    }
    callbacks.onPhase(createAgentRunSnapshot('verified', plan, plan.summary));
    return {
      commandsCompleted,
      commandsExecuted: true,
      commandsTotal: commands.length,
      commandResults,
    };
  }

  private send(
    input: AgentRunInput,
    content: string,
    callbacks: AgentRunCallbacks,
    session: AgentRunSessionPort,
    fileIds: string[] | undefined,
    threadId?: string,
    context?: CollectedContext,
  ): ReturnType<AgentRunChatPort['send']> {
    const resolvedThreadId = threadId ?? input.threadId;
    return this.chat.send(
      {
        content: session.preparePrompt(content),
        clientIntent: input.content,
        context: context?.files ?? [],
        ...(context === undefined ? {} : { contextReceipt: context.receipt }),
        ...input.selection,
        ...(fileIds === undefined ? {} : { fileIds }),
        ...(resolvedThreadId === undefined ? {} : { threadId: resolvedThreadId }),
      },
      (event) => {
        callbacks.onEvent(event);
      },
      input.signal,
      (threadId) => {
        callbacks.onThread(threadId);
      },
      input.onAccepted,
    );
  }
}
