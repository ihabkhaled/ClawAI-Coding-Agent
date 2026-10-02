import { headlessExitCode } from '../core/headless-outcome';
import { redactText } from '../core/redaction';

import {
  checkSummaries,
  checkTail,
  doneChecksPrompt,
  failingLabels,
  failureSignature,
} from './done-checks';
import { DONE_CHECKS_FAILED_CODE, DONE_CHECKS_REASON } from './done-checks.constants';
import { stuckPrompt } from './repetition-guard-result';
import { assertRunLimits } from './run-budget';
import {
  AUTO_CONTINUE_MAX,
  CONTINUATION_PROMPT,
  CONTINUATION_REASON,
  RUN_LOST_PROMPT,
  RUN_LOST_REASON,
  SESSION_EXPIRED_PROMPT,
  SESSION_EXPIRED_REASON,
} from './server-budget.constants';
import { PLAN_INCOMPLETE_CODE, PLAN_INCOMPLETE_REASON } from './task-plan-tool.constants';
import { describeTools } from './tool-alias';
import {
  UNKNOWN_TOOL_PROMPT_HEAD,
  UNKNOWN_TOOL_PROMPT_TAIL,
  UNKNOWN_TOOL_REASON,
} from './tool-alias.constants';

import type { AgentEvent, AgentResult, AgentRunCallOptions } from './create-agent.types';
import type { DoneCheckRunner, DoneChecksReport } from './done-checks.types';
import type { PlanGate, PlanGateReport } from './task-plan-tool.types';

interface ContinuationInput {
  readonly prompt: string;
  readonly options: AgentRunCallOptions;
  readonly runOne: (prompt: string, options: AgentRunCallOptions) => Promise<AgentResult>;
  /** A continuation needs the thread the first run started. */
  readonly hasThread: () => boolean;
  /** Adds what the agent has noted to a continuation prompt. */
  readonly withNotes?: ((prompt: string) => string) | undefined;
  /** The offered tools, one per line, for the prompt after an unknown-tool failure. */
  readonly toolList?: (() => string) | undefined;
  /** The orchestrator's completion checks, run when a run ends `completed`. */
  readonly checkDone?: DoneCheckRunner | undefined;
  /** The task plan's completion gate: a run that ends `completed` with the plan unfinished is continued. */
  readonly planGate?: PlanGate | undefined;
}

/** What `finalResult` needs to know about how the loop ended. */
interface EndState {
  readonly attempt: number;
  readonly spent: boolean;
  /** The last checks that ran, and the ones of the final run when they failed. */
  readonly checks: DoneChecksReport | undefined;
  readonly failing: DoneChecksReport | undefined;
  /** The plan gate's report for the final run, when it still blocked completion. */
  readonly plan: PlanGateReport | undefined;
  readonly aborted: boolean;
}

interface Totals {
  toolCalls: number;
  deniedCalls: number;
  text: string;
}

interface GuardsLeft {
  readonly calls: number | undefined;
  readonly ms: number | undefined;
  readonly spent: boolean;
}

/** Throws when `autoContinue` is unusable, before any run starts. */
export function assertAutoContinue(value: number | undefined): void {
  if (value === undefined) return;
  if (!Number.isInteger(value) || value < 0 || value > AUTO_CONTINUE_MAX) {
    throw new RangeError(
      `autoContinue must be a whole number from 0 to ${String(AUTO_CONTINUE_MAX)}.`,
    );
  }
}

/**
 * Runs the task, and starts a new run on the same thread each time one ends
 * because the runtime's own budget was used up.
 *
 * The runtime bills tool calls and result bytes cumulatively per run and stops
 * the run when they are gone, whatever the caller allowed. That is not a
 * failure of the task, only of the allowance, so the work goes on in a fresh
 * run with a prompt that tells the model to look at what it already changed.
 * The caller's own guards are totals: each run gets only what is left of them,
 * and when nothing is left the work stops as `exhausted`. A run that failed for
 * any other reason, was cancelled or was denied is never continued.
 */
export async function runWithContinuations(input: ContinuationInput): Promise<AgentResult> {
  const { options } = input;
  assertAutoContinue(options.autoContinue);
  // The loop narrows the guards for each run, which would hide a bad value the single run refused.
  assertRunLimits(options);
  const allowed = options.autoContinue ?? 0;
  if (runsOnce(allowed, input)) return input.runOne(input.prompt, options);
  const emit = (event: AgentEvent): void => options.onEvent?.(event);
  const inner = (event: AgentEvent): void => {
    if (event.type !== 'run.finished') emit(event);
  };
  const started = Date.now();
  const totals: Totals = { toolCalls: 0, deniedCalls: 0, text: '' };
  let prompt = input.prompt;
  let attempt = 0;
  let checks: DoneChecksReport | undefined;
  let previousFailure: string | undefined;
  for (;;) {
    const left = guardsLeft(options, totals, Date.now() - started);
    const last = await input.runOne(prompt, { ...options, onEvent: inner, ...runGuards(left) });
    add(totals, last);
    const report = await checkedDone(last, input.checkDone, emit, options.signal);
    checks = report ?? checks;
    const room = guardsLeft(options, totals, Date.now() - started);
    const { failing, blocked, aborted, goOn } = verdictOf(last, report, input, {
      room,
      attempt,
      allowed,
    });
    if (!goOn) {
      if (allowed === 0 && input.checkDone === undefined && blocked === undefined) {
        emit({ type: 'run.finished', result: last });
        return last;
      }
      const end: EndState = { attempt, spent: room.spent, checks, failing, plan: blocked, aborted };
      return finalResult(last, totals, end, emit);
    }
    attempt += 1;
    const context = continuationContext(failing, previousFailure, input.toolList, blocked);
    previousFailure = context.signature;
    const next = continuation(last, context, input.withNotes);
    prompt = next.prompt;
    emit({ type: 'run.continued', attempt, reason: next.reason });
  }
}

/** Whether the run that just ended is unfinished, and whether another run may start. */
function verdictOf(
  last: AgentResult,
  report: DoneChecksReport | undefined,
  input: ContinuationInput,
  state: { room: GuardsLeft; attempt: number; allowed: number },
): {
  failing: DoneChecksReport | undefined;
  blocked: PlanGateReport | undefined;
  aborted: boolean;
  goOn: boolean;
} {
  const failing = failedReport(report);
  const blocked = failing === undefined ? planBlock(last, input.planGate) : undefined;
  const aborted = input.options.signal?.aborted === true;
  const unfinished = isContinuable(last) || failing !== undefined || blocked !== undefined;
  const open = input.hasThread() && !aborted && !state.room.spent && state.attempt < state.allowed;
  return { failing, blocked, aborted, goOn: unfinished && open };
}

/** Nothing to continue and nothing to check: the run is the one the caller asked for. */
function runsOnce(allowed: number, input: ContinuationInput): boolean {
  return allowed === 0 && input.checkDone === undefined && input.planGate === undefined;
}

/** What the plan gate says about a run that ended `completed` with nothing else to continue. */
function planBlock(last: AgentResult, gate: PlanGate | undefined): PlanGateReport | undefined {
  if (gate === undefined || last.outcome !== 'completed' || isContinuable(last)) return undefined;
  return gate();
}

function failedReport(report: DoneChecksReport | undefined): DoneChecksReport | undefined {
  return report !== undefined && !report.passed ? report : undefined;
}

/** What is left of the caller's guards, as the options one run is given. */
function runGuards(left: GuardsLeft): Pick<AgentRunCallOptions, 'maxToolCalls' | 'maxDurationMs'> {
  return {
    ...(left.calls === undefined ? {} : { maxToolCalls: Math.max(left.calls, 1) }),
    ...(left.ms === undefined ? {} : { maxDurationMs: Math.max(left.ms, 1) }),
  };
}

/** A run that ended on the server's budget, or that the runtime lost, is worth a new run. */
function isContinuable(result: AgentResult): boolean {
  return (
    result.budgetExhausted === true ||
    result.runLost === true ||
    result.sessionExpired === true ||
    result.unknownTool === true ||
    result.stuck !== undefined
  );
}

/** What a continuation prompt is built from, and whether this failure is the one that just failed before. */
function continuationContext(
  failing: DoneChecksReport | undefined,
  previous: string | undefined,
  toolList: (() => string) | undefined,
  plan: PlanGateReport | undefined,
): {
  failing: DoneChecksReport | undefined;
  repeated: boolean;
  signature: string | undefined;
  toolList: (() => string) | undefined;
  plan: PlanGateReport | undefined;
} {
  const signature = failing === undefined ? undefined : failureSignature(failing);
  return { failing, repeated: signature === previous, signature, toolList, plan };
}

type ContinuationReason = Extract<AgentEvent, { type: 'run.continued' }>['reason'];

function continuation(
  result: AgentResult,
  context: {
    failing: DoneChecksReport | undefined;
    repeated: boolean;
    toolList: (() => string) | undefined;
    plan: PlanGateReport | undefined;
  },
  withNotes: ((prompt: string) => string) | undefined,
): { prompt: string; reason: ContinuationReason } {
  const { failing, plan } = context;
  const next =
    failing !== undefined
      ? { prompt: doneChecksPrompt(failing, context.repeated), reason: DONE_CHECKS_REASON }
      : plan !== undefined
        ? { prompt: plan.prompt, reason: PLAN_INCOMPLETE_REASON }
        : basicContinuation(result, context.toolList?.());
  return withNotes === undefined ? next : { ...next, prompt: withNotes(next.prompt) };
}

function basicContinuation(
  result: AgentResult,
  toolList: string | undefined,
): { prompt: string; reason: ContinuationReason } {
  if (result.unknownTool === true) {
    const names = toolList ?? describeTools([]);
    return {
      prompt: `${UNKNOWN_TOOL_PROMPT_HEAD}
${names}
${UNKNOWN_TOOL_PROMPT_TAIL}`,
      reason: UNKNOWN_TOOL_REASON,
    };
  }
  if (result.stuck !== undefined) return { prompt: stuckPrompt(result.stuck), reason: 'stuck' };
  if (result.sessionExpired === true) {
    return { prompt: SESSION_EXPIRED_PROMPT, reason: SESSION_EXPIRED_REASON };
  }
  return result.runLost === true
    ? { prompt: RUN_LOST_PROMPT, reason: RUN_LOST_REASON }
    : { prompt: CONTINUATION_PROMPT, reason: CONTINUATION_REASON };
}

function add(totals: Totals, result: AgentResult): void {
  totals.toolCalls += result.toolCalls;
  totals.deniedCalls += result.deniedCalls;
  totals.text = totals.text.length === 0 ? result.text : `${totals.text}\n${result.text}`;
}

function guardsLeft(options: AgentRunCallOptions, totals: Totals, elapsedMs: number): GuardsLeft {
  const calls =
    options.maxToolCalls === undefined ? undefined : options.maxToolCalls - totals.toolCalls;
  const ms = options.maxDurationMs === undefined ? undefined : options.maxDurationMs - elapsedMs;
  return {
    calls,
    ms,
    spent: (calls !== undefined && calls <= 0) || (ms !== undefined && ms <= 0),
  };
}

/**
 * Runs the completion checks when a run ended `completed` with nothing else
 * to continue, and reports them. Undefined when they did not run.
 */
async function checkedDone(
  last: AgentResult,
  run: DoneCheckRunner | undefined,
  emit: (event: AgentEvent) => void,
  signal: AbortSignal | undefined,
): Promise<DoneChecksReport | undefined> {
  if (run === undefined || last.outcome !== 'completed' || isContinuable(last)) return undefined;
  const report = await run(signal);
  emit({
    type: 'run.checks',
    passed: report.passed,
    checks: report.checks.map((outcome) => {
      const tail = checkTail(outcome);
      const { label, ok, exitCode, durationMs } = outcome;
      return { label, ok, exitCode, durationMs, ...(tail === undefined ? {} : { tail }) };
    }),
  });
  return report;
}

function planFields(state: EndState): Partial<AgentResult> {
  const { plan } = state;
  if (plan === undefined) return {};
  if (state.aborted) return { outcome: 'cancelled', exitCode: headlessExitCode('cancelled') };
  const what =
    plan.total === 0
      ? 'this run requires a plan and none was made'
      : `${String(plan.open)} of ${String(plan.total)} plan step(s) are not done`;
  return {
    outcome: 'failed',
    exitCode: headlessExitCode('failed'),
    errorCode: PLAN_INCOMPLETE_CODE,
    error: `${PLAN_INCOMPLETE_CODE}: the run reported the task done, but ${what} after ${String(state.attempt + 1)} run(s).`,
  };
}

function checksFields(state: EndState): Partial<AgentResult> {
  const { checks, failing } = state;
  if (checks === undefined) return {};
  const summary = { checks: checkSummaries(checks) };
  if (failing === undefined) return summary;
  if (state.aborted)
    return { ...summary, outcome: 'cancelled', exitCode: headlessExitCode('cancelled') };
  return {
    ...summary,
    outcome: 'failed',
    exitCode: headlessExitCode('failed'),
    errorCode: DONE_CHECKS_FAILED_CODE,
    error: redactText(
      `${DONE_CHECKS_FAILED_CODE}: the run reported the task done, but these completion checks still fail after ${String(state.attempt + 1)} run(s): ${failingLabels(failing).join(', ')}.`,
    ),
  };
}

function finalResult(
  last: AgentResult,
  totals: Totals,
  state: EndState,
  emit: (event: AgentEvent) => void,
): AgentResult {
  const result: AgentResult = {
    ...last,
    ...totals,
    continuations: state.attempt,
    ...(last.budgetExhausted === true
      ? {
          outcome: 'exhausted',
          exitCode: headlessExitCode('exhausted'),
          error: unfinishedMessage(state),
        }
      : {}),
    ...checksFields(state),
    ...planFields(state),
  };
  emit({ type: 'run.finished', result });
  return result;
}

function unfinishedMessage(state: EndState): string {
  const runs = `${String(state.attempt + 1)} run(s)`;
  return state.spent
    ? `The task is not finished: the runtime's budget ended ${runs} and the tool-call or time guard has no room left for another.`
    : `The task is not finished: the runtime's budget ended ${runs}, and every allowed continuation is used up.`;
}
