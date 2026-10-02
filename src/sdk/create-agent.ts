import path from 'node:path';
import { env } from 'node:process';

import { effortBudget } from '../core/effort-mode';
import { headlessExitCode, outcomeFromError } from '../core/headless-outcome';
import { redactText } from '../core/redaction';
import { headlessStateDirectory } from '../headless/headless-session-store';
import { HeadlessTransport } from '../headless/headless-transport';
import { RuntimeHttpError } from '../headless/runtime-http-error';

import { contextProblem, promptWithContext } from './agent-context';
import { agentEventFrom } from './agent-events';
import { assertAgentInputs, promptWithInstructions, withoutInstructions } from './agent-inputs';
import { runAgent } from './agent-sdk';
import { AGENT_SDK_DEFAULTS } from './agent-sdk.constants';
import { createTeam } from './agent-team';
import { maxAgentsProblem } from './agent-team-args';
import { teamBinding } from './agent-team-binding';
import { agentToolkit } from './agent-toolkit';
import { runWithContinuations } from './auto-continue';
import { resolveRunBudget, resultByteLimit } from './budget-profiles';
import { doneCheckRunner, doneChecksProblem } from './done-checks';
import { promptWithKnowledge } from './knowledge-preamble';
import { createNotesStore } from './notes-store';
import { promptWithNotes } from './notes-tool';
import { observedToolkit } from './observed-toolkit';
import { loadPromptImages } from './prompt-images';
import { createRepetitionGuard } from './repetition-guard';
import { guardedOutcome, stuckEvent, stuckFields } from './repetition-guard-result';
import { assertRunLimits, createRunGuard, describeBudgetTrip } from './run-budget';
import { isRunLostError } from './run-lost';
import { failureFields, runtimeFailureReason } from './runtime-failure';
import { isServerBudgetError, isServerBudgetEvent, withResultBudgetNotes } from './server-budget';
import { openPlan } from './task-plan-agent';
import { planGateReport, promptWithPlan } from './task-plan-prompt';
import { summarize } from './task-plan-steps';
import { describeTools } from './tool-alias';
import { spentToolAllowance } from './tool-allowance';

import type { AgentBudgetField, AgentRunResult } from './agent-sdk.types';
import type { AgentTeam } from './agent-team-tool.types';
import type {
  Agent,
  AgentConfig,
  AgentEvent,
  AgentResult,
  AgentRunCallOptions,
} from './create-agent.types';
import type { NotesStore } from './notes-tool.types';
import type { StuckInfo } from './repetition-guard.types';
import type { RunBudgetTrip } from './run-budget.types';
import type { PlanStore } from './task-plan-tool.types';
import type { VisionImage } from './vision-tool.types';
import type { HeadlessOutcome } from '../core/headless-outcome.types';

/** What one agent remembers between runs: its thread, its tool list, and images not yet sent. */
interface AgentSession {
  threadId: string | undefined;
  tools: string;
  images: readonly VisionImage[];
}

/**
 * A host-free agent bound to one workspace and one identity.
 *
 * `run` never throws for a run that went wrong: it resolves with an outcome and
 * the exit code the headless contract promises for it, so a caller can branch
 * on a value instead of guessing what an exception meant. Local tools — files,
 * a bounded command, read-only git, and MCP servers when configured — execute
 * on this machine, and only within `permissions`.
 *
 * The agent is one conversation: the first run's thread (or the `threadId`
 * given) is reused by every later run, and is readable as `agent.threadId`.
 */
export function createAgent(config: AgentConfig): Agent {
  assertAgentInputs(config);
  assertSomeToolRemains(config);
  const checkProblem = doneChecksProblem(config.doneChecks ?? []);
  if (checkProblem !== undefined) throw new RangeError(checkProblem);
  const contextIssue = config.context === undefined ? undefined : contextProblem(config.context);
  if (contextIssue !== undefined) throw new RangeError(contextIssue);
  const teamIssue = maxAgentsProblem(config.maxAgents);
  if (teamIssue !== undefined) throw new RangeError(teamIssue);
  const checkDone = doneCheckRunner(config.doneChecks, path.resolve(config.workspaceRoot));
  const session: AgentSession = {
    threadId: config.threadId,
    tools: '',
    images:
      config.images === undefined ? [] : loadPromptImages(config.images, config.workspaceRoot),
  };
  const notes = createNotesStore({
    workspace: path.resolve(config.workspaceRoot),
    threadId: () => session.threadId,
    stateDirectory: headlessStateDirectory(env),
  });
  // A new conversation starts with a blank notebook: notes kept from an earlier
  // task in this workspace once steered a fresh run into the wrong feature.
  if (config.threadId === undefined) notes.clear();
  const opened = openPlan(config, () => session.threadId);
  const { plan } = opened;
  let preloaded = opened.preloaded;
  // A resumed conversation starts with what its last run wrote down.
  let resumed = config.threadId !== undefined;
  return {
    get threadId() {
      return session.threadId;
    },
    run: async (prompt, options = {}) => {
      const built = await contextualized(config, prompt, options);
      if (typeof built !== 'string') return built;
      const known =
        config.loadKnowledge === true && session.threadId === undefined
          ? promptWithKnowledge(config.workspaceRoot, built)
          : built;
      const noted = resumed ? promptWithNotes(known, notes) : known;
      const first = resumed || preloaded ? promptWithPlan(noted, plan) : noted;
      if (preloaded) options.onEvent?.({ type: 'run.plan', ...summarize(plan.list()) });
      resumed = false;
      preloaded = false;
      // The team lives for this run: its children are cancelled when the run is over.
      const team = createTeam(config, createAgent);
      try {
        return await runWithContinuations({
          prompt: first,
          options,
          hasThread: () => session.threadId !== undefined,
          withNotes: (text) => promptWithPlan(promptWithNotes(text, notes), plan),
          planGate: () => planGateReport(plan, config.requirePlan === true),
          toolList: () => session.tools,
          checkDone,
          runOne: (text, callOptions) =>
            runOnce({ config, session, notes, plan, team }, text, callOptions),
        });
      } finally {
        await team?.close();
      }
    },
  };
}

/**
 * A tool filter that removes everything is a usage mistake. Left alone the run
 * would send an empty tool list and die on the server's own validation, so it
 * is refused here, before anything is sent.
 */
function assertSomeToolRemains(config: AgentConfig): void {
  if ((config.allowedTools ?? []).length + (config.disallowedTools ?? []).length === 0) return;
  const probe = agentToolkit(config);
  const none = probe.definitions.length === 0;
  probe.dispose?.();
  if (none) {
    throw new RangeError(
      'No tool is left for the agent: --allowed-tools and --disallowed-tools together remove every tool. Allow at least one tool.',
    );
  }
}

async function runOnce(
  agent: {
    config: AgentConfig;
    session: AgentSession;
    notes: NotesStore;
    plan: PlanStore;
    team: AgentTeam | undefined;
  },
  prompt: string,
  options: AgentRunCallOptions,
): Promise<AgentResult> {
  const { config, session, notes, plan, team } = agent;
  assertRunLimits(options);
  const emit = (event: AgentEvent): void => options.onEvent?.(event);
  const guard = createRunGuard(options, options.signal);
  const tally = {
    denied: 0,
    calls: 0,
    text: '',
    signingIn: true,
    runId: '',
    serverBudget: false,
    failure: '',
  };
  // Calls wait out a runtime that is briefly away, and stop when the guard's
  // signal does, so a cancel or --max-duration ends a wait as well as a run.
  const transport =
    config.transport ??
    new HeadlessTransport(config.backendUrl ?? AGENT_SDK_DEFAULTS.backendUrl, {
      ...config.retry,
      signal: guard.signal,
      onRetry: (notice) => {
        emit({ type: 'run.retrying', ...notice });
      },
    });
  const credential = { token: 'token' in config.auth ? config.auth.token : undefined };
  const inner = agentToolkit(
    config,
    {
      store: notes,
      plan,
      onPlanChanged: (summary) => {
        emit({ type: 'run.plan', ...summary });
      },
      onNoteAdded: (info) => {
        emit({ type: 'note.added', ...info });
      },
      onWriteScopeViolation: (violation) => {
        emit({ type: 'write-scope.violation', ...violation });
      },
    },
    () => credential.token,
    team,
  );
  team?.attach(
    teamBinding({
      signal: guard.signal,
      emit,
      callsSoFar: () => tally.calls,
      guardCalls: options.maxToolCalls,
      serverCalls: toolCallLimit(config, options),
      maxDurationMs: options.maxDurationMs,
      token: () => credential.token,
    }),
  );
  session.tools = describeTools(inner.definitions);
  const noted = withResultBudgetNotes(
    inner,
    config.effort === undefined
      ? resultByteLimit(options.budgetProfile)
      : effortBudget(config.effort).maxToolResultBytes,
  );
  // A run that loops on one call is ended here: `stop` aborts the stream, and the
  // guard's own signal (when a limit is set) still ends it as `exhausted`.
  const stop = new AbortController();
  const repetition = createRepetitionGuard({
    onStuck: (info) => {
      emit(stuckEvent(info));
      stop.abort();
    },
  });
  const runSignal =
    guard.signal === undefined ? stop.signal : AbortSignal.any([guard.signal, stop.signal]);
  const toolkit = guard.guard(observedToolkit(repetition.guard(noted), emit, tally));
  try {
    // Signed in here rather than inside runAgent, so a refusal can be told
    // apart from a later one: during sign-in any client error is the credential.
    const token = 'token' in config.auth ? config.auth.token : await transport.signIn(config.auth);
    tally.signingIn = false;
    credential.token = token;
    const report = await runAgent({
      prompt: promptWithInstructions(prompt, config.systemPrompt),
      toolkit,
      token,
      provider: config.provider,
      model: config.model,
      title: options.title,
      budgetProfile: options.budgetProfile,
      threadId: session.threadId,
      images: session.images,
      useMemory: config.useMemory,
      onImagesNotDelivered: (info) => {
        emit({ type: 'images.not-delivered', ...info });
      },
      onMemoryUnchanged: (info) => {
        emit({ type: 'thread.memory-unchanged', ...info });
      },
      deadlineMs: config.deadlineMs ?? effortDeadlineMs(config),
      transport,
      signal: runSignal,
      ...budgetFor(config, options),
      onStarted: (run) => {
        tally.runId = run.runId;
        session.threadId = run.threadId;
        // The images belong to the first prompt only; later runs on the thread carry them in context.
        session.images = [];
        emit({ type: 'run.started', ...run });
      },
      onEvent: (raw) => {
        if (isServerBudgetEvent(raw)) tally.serverBudget = true;
        if (raw.type === 'run.failed') {
          tally.failure = redacted(runtimeFailureReason(raw), config);
        }
        const event = agentEventFrom(raw);
        if (event?.type === 'text') tally.text += event.text;
        if (event !== undefined) emit(event);
      },
    });
    return finishReport(emit, report, tally, {
      trip: guard.tripped(),
      stuck: repetition.stuck(),
      limit: toolCallLimit(config, options),
    });
  } catch (error) {
    const trip = guard.tripped();
    const aborted = options.signal?.aborted === true;
    return finish(
      emit,
      failedResult(error, { trip, aborted, tally, session, config, stuck: repetition.stuck() }),
      trip,
    );
  } finally {
    guard.dispose();
    inner.dispose?.();
  }
}

/** Ends a run the loop reported: a guard trip wins, then a stuck loop, then a spent tool allowance. */
function finishReport(
  emit: (event: AgentEvent) => void,
  report: AgentRunResult,
  tally: FailureContext['tally'],
  seen: {
    trip: RunBudgetTrip | undefined;
    stuck: StuckInfo | undefined;
    limit: number | undefined;
  },
): AgentResult {
  const { trip } = seen;
  const stuck = trip === undefined ? seen.stuck : undefined;
  const spent = spentAllowance(report, { trip, stuck }, seen.limit);
  return finish(emit, reportedResult(report, tally, { trip, stuck, spent }), trip ?? spent);
}

/** The tool allowance a run spent in full, unless a guard or the repetition check already ended it. */
function spentAllowance(
  report: AgentRunResult,
  ended: { trip: RunBudgetTrip | undefined; stuck: StuckInfo | undefined },
  limit: number | undefined,
): RunBudgetTrip | undefined {
  return ended.trip === undefined && ended.stuck === undefined
    ? spentToolAllowance(report, limit)
    : undefined;
}

/** The result of a run that ended on its own or on a guard, from the loop's report. */
function reportedResult(
  report: AgentRunResult,
  tally: FailureContext['tally'],
  guards: {
    trip: RunBudgetTrip | undefined;
    stuck: StuckInfo | undefined;
    spent: RunBudgetTrip | undefined;
  },
): AgentResult {
  const { trip, stuck, spent } = guards;
  const outcome =
    spent === undefined
      ? guardedOutcome(withDenials(report.outcome, tally.denied), guards)
      : 'exhausted';
  return {
    ...report,
    outcome,
    exitCode: headlessExitCode(outcome),
    deniedCalls: tally.denied,
    text: tally.text,
    ...failureFields(report, tally.failure),
    ...tripFields(trip, report.toolCalls),
    ...(spent === undefined ? {} : { error: describeBudgetTrip(spent) }),
    ...stuckFields(stuck),
    ...((tally.serverBudget || spent !== undefined) && trip === undefined && stuck === undefined
      ? { budgetExhausted: true as const }
      : {}),
  };
}

interface FailureContext {
  readonly trip: RunBudgetTrip | undefined;
  readonly aborted: boolean;
  readonly tally: {
    denied: number;
    calls: number;
    text: string;
    signingIn: boolean;
    runId: string;
    serverBudget: boolean;
    failure: string;
  };
  readonly session: { threadId: string | undefined };
  readonly config: AgentConfig;
  readonly stuck: StuckInfo | undefined;
}

/** The result of a run that threw: an exhausted guard, a cancel, a stuck loop, or a failure with a redacted reason. */
function failedResult(error: unknown, context: FailureContext): AgentResult {
  const { trip, tally, session } = context;
  const stuck = context.aborted ? undefined : context.stuck;
  const outcome = guardedOutcome(
    trip === undefined
      ? withDenials(
          outcomeFromError(error, { aborted: context.aborted, signingIn: tally.signingIn }),
          tally.denied,
        )
      : 'exhausted',
    { trip, stuck },
  );
  const reason = error instanceof Error ? error.message : 'Agent run failed';
  const plain = trip === undefined && stuck === undefined;
  return {
    outcome,
    exitCode: headlessExitCode(outcome),
    toolCalls: tally.calls,
    deniedCalls: tally.denied,
    text: tally.text,
    ...(tally.runId.length === 0 ? {} : { runId: tally.runId }),
    ...(session.threadId === undefined ? {} : { threadId: session.threadId }),
    error: trip === undefined ? redacted(reason, context.config) : describeBudgetTrip(trip),
    ...(plain ? endedFlags(error, tally.serverBudget) : {}),
    ...(plain && expiredSession(error, outcome, context) ? { sessionExpired: true as const } : {}),
    ...stuckFields(stuck),
  };
}

/**
 * A 401 after the run started, with a password to sign in again: the access
 * token simply outlived a long run, so a continuation can renew it.
 */
function expiredSession(
  error: unknown,
  outcome: HeadlessOutcome,
  context: FailureContext,
): boolean {
  return (
    outcome === 'unauthenticated' &&
    !context.tally.signingIn &&
    'password' in context.config.auth &&
    error instanceof RuntimeHttpError &&
    error.status === 401
  );
}

/** Flags for a run that threw on the runtime's own budget, or that the runtime lost. */
function endedFlags(
  error: unknown,
  serverBudget: boolean,
): { budgetExhausted?: true; runLost?: true } {
  return {
    ...(serverBudget || isServerBudgetError(error) ? { budgetExhausted: true as const } : {}),
    ...(isRunLostError(error) ? { runLost: true as const } : {}),
  };
}

/**
 * A guard that stopped the run says so in `error`, and its tool count never
 * exceeds the limit: the refused call past it was not run.
 */
function tripFields(
  trip: RunBudgetTrip | undefined,
  toolCalls: number,
): { error?: string; toolCalls?: number } {
  if (trip === undefined) return {};
  const capped = trip.budget === 'tool-calls' ? Math.min(toolCalls, trip.limit) : toolCalls;
  return { error: describeBudgetTrip(trip), toolCalls: capped };
}

function finish(
  emit: (event: AgentEvent) => void,
  result: AgentResult,
  trip?: RunBudgetTrip,
): AgentResult {
  if (trip !== undefined) emit({ type: 'budget.exhausted', ...trip });
  emit({ type: 'run.finished', result });
  return result;
}

/**
 * A run that failed after a tool was refused failed because of the refusal, and
 * the remedy is a permission, not a retry — so it is reported as blocked.
 */
function withDenials(outcome: HeadlessOutcome, denied: number): HeadlessOutcome {
  return outcome === 'failed' && denied > 0 ? 'blocked' : outcome;
}

/** An error message with the credential and the operator instructions removed. */
function redacted(message: string, config: AgentConfig): string {
  const secret = 'token' in config.auth ? config.auth.token : config.auth.password;
  const withoutSecret = secret.length === 0 ? message : message.split(secret).join('[redacted]');
  return redactText(withoutInstructions(withoutSecret, config.systemPrompt));
}

/** The wall clock the effort table gives, when an effort was named and no deadline was. */
function effortDeadlineMs(config: AgentConfig): number | undefined {
  return config.effort === undefined ? undefined : effortBudget(config.effort).maxRuntimeMs;
}

/** The tool calls the run is allowed: the effort table, else the profile's own limit. */
function toolCallLimit(config: AgentConfig, options: AgentRunCallOptions): number | undefined {
  return resolveRunBudget(options.budgetProfile, 0, budgetFor(config, options).budget).maxToolCalls;
}

/** The run budget fields this configuration sets: the effort's table, narrowed by `maxTurns`. */
function budgetFor(
  config: AgentConfig,
  options: AgentRunCallOptions,
): { budget?: Partial<Record<AgentBudgetField, number>> } {
  const base = config.effort === undefined ? {} : effortBudget(config.effort);
  const turns =
    options.maxTurns === undefined
      ? {}
      : { maxModelTurns: options.maxTurns, maxToolRounds: options.maxTurns };
  const budget = { ...base, ...turns };
  return Object.keys(budget).length === 0 ? {} : { budget };
}

/**
 * The prompt with the run's context, or a finished result when the context
 * cannot be built. A missing file or a bad range is a usage problem found
 * before any request, so it ends the run as `unusable` (exit 2) and nothing is sent.
 */
async function contextualized(
  config: AgentConfig,
  prompt: string,
  options: AgentRunCallOptions,
): Promise<string | AgentResult> {
  if (config.context === undefined) return prompt;
  try {
    const built = await promptWithContext(
      { workspaceRoot: config.workspaceRoot, context: config.context, speed: config.speed },
      prompt,
    );
    options.onEvent?.({
      type: 'context.collected',
      mode: built.resolved,
      included: built.receipt?.included.length ?? 0,
      excluded: built.receipt?.excluded.length ?? 0,
      truncated: built.receipt?.truncated ?? false,
    });
    return built.prompt;
  } catch (error: unknown) {
    const result: AgentResult = {
      outcome: 'unusable',
      exitCode: headlessExitCode('unusable'),
      toolCalls: 0,
      deniedCalls: 0,
      text: '',
      error: redactText(error instanceof Error ? error.message : 'The context could not be built.'),
    };
    options.onEvent?.({ type: 'run.finished', result });
    return result;
  }
}
