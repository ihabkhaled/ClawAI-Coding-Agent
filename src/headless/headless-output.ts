import { describeHeadlessOutcome } from '../core/headless-outcome';
import { redactText } from '../core/redaction';

import type { HeadlessIo, HeadlessOutputFormat } from './headless-args.types';
import type { AgentEvent, AgentResult } from '../sdk/create-agent.types';

const CONTINUE_WHY: Readonly<
  Record<Extract<AgentEvent, { type: 'run.continued' }>['reason'], string>
> = {
  'checks-failed': 'the completion checks failed',
  'plan-incomplete': 'the task plan still has open steps',
  'run-lost': 'the runtime lost the run',
  'session-expired': 'the sign-in expired and was renewed',
  'unknown-tool': 'the model named a tool that does not exist',
  'budget-exhausted': 'the server budget was used up',
  stuck: 'the run got stuck repeating a call',
};

/**
 * What the runner prints for one event while the run happens.
 *
 * `text` streams the answer to stdout and tool activity to stderr, so a pipe
 * receives only the answer. `stream-json` writes every event as one JSON line.
 * `json` prints nothing until the end: one object is the whole contract.
 */
export function writeEvent(format: HeadlessOutputFormat, event: AgentEvent, io: HeadlessIo): void {
  if (format === 'stream-json') {
    io.stdout(`${redactText(JSON.stringify(event))}\n`);
    return;
  }
  if (format !== 'text') return;
  const line = textLine(event);
  if (event.type === 'text') io.stdout(redactText(event.text));
  else if (line !== undefined) io.stderr(redactText(line));
}

/** The closing output, after the last event. */
export function writeResult(
  format: HeadlessOutputFormat,
  result: AgentResult,
  io: HeadlessIo,
): void {
  if (format === 'json') {
    io.stdout(`${redactText(JSON.stringify(result))}\n`);
    return;
  }
  if (format === 'stream-json') return;
  if (result.text.length > 0 && !result.text.endsWith('\n')) io.stdout('\n');
  io.stderr(
    `${describeHeadlessOutcome(result.outcome)} ${String(result.toolCalls)} tool call(s). exit ${String(result.exitCode)}\n`,
  );
  if (result.threadId !== undefined) io.stderr(`thread ${result.threadId}\n`);
  if (result.error !== undefined) io.stderr(`${redactText(result.error)}\n`);
}

/** The stderr line a person watching a text run sees for a non-text event. */
export function textLine(event: AgentEvent): string | undefined {
  if (event.type === 'context.collected') {
    return `[context] ${event.mode}: ${String(event.included)} included, ${String(event.excluded)} left out${event.truncated ? ', cut to the limit' : ''}\n`;
  }
  if (event.type === 'tool.call') return `[tool] ${event.toolName}.${event.operation}\n`;
  if (event.type === 'tool.denied') {
    return `[denied] ${event.toolName}.${event.operation}\n`;
  }
  if (event.type === 'tool.result' && !event.ok) {
    return `[tool failed] ${event.toolName}.${event.operation}: ${event.message ?? ''}\n`;
  }
  if (event.type === 'budget.exhausted') {
    return `[budget] ${event.budget} limit ${String(event.limit)} reached\n`;
  }
  return recoveryLine(event);
}

/** The stderr line for the events that report the run recovering from something. */
function recoveryLine(event: AgentEvent): string | undefined {
  if (event.type === 'run.continued') {
    const why = CONTINUE_WHY[event.reason];
    return `[continue] run ${String(event.attempt)}: ${why}; continuing on the same thread\n`;
  }
  if (event.type === 'write-scope.violation') {
    return `[write-scope] ${event.tool}: ${event.paths.join(', ')}
`;
  }
  if (event.type === 'run.checks') {
    const failed = event.checks.filter((check) => !check.ok).map((check) => check.label);
    return event.passed
      ? `[checks] all ${String(event.checks.length)} passed
`
      : `[checks] failed: ${failed.join(', ')}
`;
  }
  if (event.type === 'run.plan') {
    return `[plan] ${String(event.done)}/${String(event.total)} done, ${String(event.doing)} in progress, ${String(event.blocked)} blocked
`;
  }
  if (event.type === 'run.stuck') {
    return `[stuck] ${event.tool}.${event.operation} repeated ${String(event.times)} times with nothing changing; ending the run\n`;
  }
  return noticeLine(event);
}

/** The stderr line for the events that are notices about the run's environment. */
function noticeLine(event: AgentEvent): string | undefined {
  if (event.type === 'images.not-delivered') {
    return `[images] the backend kept ${String(event.delivered)} of ${String(event.sent)} attached image(s), so the model may not see them; vision.describe can still read workspace images
`;
  }
  if (event.type.startsWith('agent.')) return agentLine(event);
  if (event.type === 'thread.memory-unchanged') {
    return `[memory] the backend refused the setting (HTTP ${String(event.status)}); account memories stay on\n`;
  }
  if (event.type === 'model.fallback') {
    return `[model] ${event.from} is rate limited; continuing on ${event.to}
`;
  }
  if (event.type === 'run.retrying') {
    const cause =
      event.status === undefined ? (event.code ?? 'network error') : `HTTP ${String(event.status)}`;
    const seconds = String(Math.round(event.waitMs / 1_000));
    return `[retry] ${cause}: attempt ${String(event.attempt)}, waiting ${seconds}s\n`;
  }
  return undefined;
}

/** The stderr line for the sub-agent events; every other event is not one. */
function agentLine(event: AgentEvent): string | undefined {
  if (event.type === 'agent.spawned') {
    return `[agent] ${event.name} started by ${event.parent} (${event.tools.join(',')}; ${String(event.maxToolCalls)} calls, ${String(event.maxDurationSec)}s)
`;
  }
  if (event.type === 'agent.message') {
    return `[agent] ${event.from} -> ${event.to}: ${String(event.chars)} chars
`;
  }
  if (event.type === 'agent.finished') {
    const why = event.error === undefined ? '' : `: ${event.error}`;
    return `[agent] ${event.name} ${event.state}, ${String(event.toolCalls)} call(s), ${String(Math.round(event.durationMs / 1_000))}s${why}
`;
  }
  return undefined;
}
