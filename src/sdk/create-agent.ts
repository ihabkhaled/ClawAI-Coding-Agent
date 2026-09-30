import path from 'node:path';
import { env } from 'node:process';

import { headlessExitCode, outcomeFromError } from '../core/headless-outcome';
import { redactText } from '../core/redaction';
import { headlessStateDirectory } from '../headless/headless-session-store';
import { HeadlessTransport } from '../headless/headless-transport';
import { RuntimeHttpError } from '../headless/runtime-http-error';

import { agentEventFrom } from './agent-events';
import { assertAgentInputs, promptWithInstructions, withoutInstructions } from './agent-inputs';
import { runAgent } from './agent-sdk';
import { AGENT_SDK_DEFAULTS } from './agent-sdk.constants';
import { agentToolkit } from './agent-toolkit';
import { runWithContinuations } from './auto-continue';
import { resultByteLimit } from './budget-profiles';
import { doneCheckRunner, doneChecksProblem } from './done-checks';
import { createNotesStore } from './notes-store';
import { promptWithNotes } from './notes-tool';
import { observedToolkit } from './observed-toolkit';
import { createRepetitionGuard } from './repetition-guard';
import { guardedOutcome, stuckEvent, stuckFields } from './repetition-guard-result';
import { assertRunLimits, createRunGuard, describeBudgetTrip } from './run-budget';
import { isRunLostError } from './run-lost';
import { isServerBudgetError, isServerBudgetEvent, withResultBudgetNotes } from './server-budget';

import type { AgentRunResult } from './agent-sdk.types';
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
import type { HeadlessOutcome } from '../core/headless-outcome.types';

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
  const checkProblem = doneChecksProblem(config.doneChecks ?? []);
  if (checkProblem !== undefined) throw new RangeError(checkProblem);
  const checkDone = doneCheckRunner(config.doneChecks, path.resolve(config.workspaceRoot));
  const session: { threadId: string | undefined } = { threadId: config.threadId };
  const notes = createNotesStore({
    workspace: path.resolve(config.workspaceRoot),
    threadId: () => session.threadId,
    stateDirectory: headlessStateDirectory(env),
  });
  // A new conversation starts with a blank notebook: notes kept from an earlier
  // task in this workspace once steered a fresh run into the wrong feature.
  if (config.threadId === undefined) notes.clear();
  // A resumed conversation starts with what its last run wrote down.
  let resumed = config.threadId !== undefined;
  return {
    get threadId() {
      return session.threadId;
    },
    run: (prompt, options = {}) => {
      const first = resumed ? promptWithNotes(prompt, notes) : prompt;
      resumed = false;
      return runWithContinuations({
        prompt: first,
        options,
        hasThread: () => session.threadId !== undefined,
        withNotes: (text) => promptWithNotes(text, notes),
        checkDone,
        runOne: (text, callOptions) => runOnce({ config, session, notes }, text, callOptions),
      });
    },
  };
}

async function runOnce(
  agent: {
    config: AgentConfig;
    session: { threadId: string | undefined };
    notes: NotesStore;
  },
  prompt: string,
  options: AgentRunCallOptions,
): Promise<AgentResult> {
  const { config, session, notes } = agent;
  assertRunLimits(options);
  const emit = (event: AgentEvent): void => options.onEvent?.(event);
  const guard = createRunGuard(options, options.signal);
  const tally = { denied: 0, calls: 0, text: '', signingIn: true, runId: '', serverBudget: false };
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
  const inner = agentToolkit(config, {
    store: notes,
    onNoteAdded: (info) => {
      emit({ type: 'note.added', ...info });
    },
    onWriteScopeViolation: (violation) => {
      emit({ type: 'write-scope.violation', ...violation });
    },
  });
  const noted = withResultBudgetNotes(inner, resultByteLimit(options.budgetProfile));
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
    const report = await runAgent({
      prompt: promptWithInstructions(prompt, config.systemPrompt),
      toolkit,
      token,
      provider: config.provider,
      model: config.model,
      title: options.title,
      budgetProfile: options.budgetProfile,
      threadId: session.threadId,
      useMemory: config.useMemory,
      onMemoryUnchanged: (info) => {
        emit({ type: 'thread.memory-unchanged', ...info });
      },
      deadlineMs: config.deadlineMs,
      transport,
      signal: runSignal,
      ...(options.maxTurns === undefined
        ? {}
        : { budget: { maxModelTurns: options.maxTurns, maxToolRounds: options.maxTurns } }),
      onStarted: (run) => {
        tally.runId = run.runId;
        session.threadId = run.threadId;
        emit({ type: 'run.started', ...run });
      },
      onEvent: (raw) => {
        if (isServerBudgetEvent(raw)) tally.serverBudget = true;
        const event = agentEventFrom(raw);
        if (event?.type === 'text') tally.text += event.text;
        if (event !== undefined) emit(event);
      },
    });
    const trip = guard.tripped();
    const stuck = trip === undefined ? repetition.stuck() : undefined;
    return finish(emit, reportedResult(report, tally, { trip, stuck }), trip);
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

/** The result of a run that ended on its own or on a guard, from the loop's report. */
function reportedResult(
  report: AgentRunResult,
  tally: FailureContext['tally'],
  guards: { trip: RunBudgetTrip | undefined; stuck: StuckInfo | undefined },
): AgentResult {
  const { trip, stuck } = guards;
  const outcome = guardedOutcome(withDenials(report.outcome, tally.denied), guards);
  return {
    ...report,
    outcome,
    exitCode: headlessExitCode(outcome),
    deniedCalls: tally.denied,
    text: tally.text,
    ...tripFields(trip, report.toolCalls),
    ...stuckFields(stuck),
    ...(tally.serverBudget && trip === undefined && stuck === undefined
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
