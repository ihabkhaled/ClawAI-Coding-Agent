import { describeHeadlessOutcome } from '../core/headless-outcome';

import type { HeadlessIo, HeadlessOutputFormat } from './headless-args.types';
import type { AgentEvent, AgentResult } from '../sdk/create-agent.types';

/**
 * What the runner prints for one event while the run happens.
 *
 * `text` streams the answer to stdout and tool activity to stderr, so a pipe
 * receives only the answer. `stream-json` writes every event as one JSON line.
 * `json` prints nothing until the end: one object is the whole contract.
 */
export function writeEvent(format: HeadlessOutputFormat, event: AgentEvent, io: HeadlessIo): void {
  if (format === 'stream-json') {
    io.stdout(`${JSON.stringify(event)}\n`);
    return;
  }
  if (format !== 'text') return;
  const line = textLine(event);
  if (event.type === 'text') io.stdout(event.text);
  else if (line !== undefined) io.stderr(line);
}

/** The closing output, after the last event. */
export function writeResult(
  format: HeadlessOutputFormat,
  result: AgentResult,
  io: HeadlessIo,
): void {
  if (format === 'json') {
    io.stdout(`${JSON.stringify(result)}\n`);
    return;
  }
  if (format === 'stream-json') return;
  if (result.text.length > 0 && !result.text.endsWith('\n')) io.stdout('\n');
  io.stderr(
    `${describeHeadlessOutcome(result.outcome)} ${String(result.toolCalls)} tool call(s). exit ${String(result.exitCode)}\n`,
  );
  if (result.threadId !== undefined) io.stderr(`thread ${result.threadId}\n`);
  if (result.error !== undefined) io.stderr(`${result.error}\n`);
}

/** The stderr line a person watching a text run sees for a non-text event. */
export function textLine(event: AgentEvent): string | undefined {
  if (event.type === 'tool.call') return `[tool] ${event.toolName}.${event.operation}\n`;
  if (event.type === 'tool.denied') {
    return `[denied] ${event.toolName}.${event.operation}\n`;
  }
  if (event.type === 'tool.result' && !event.ok) {
    return `[tool failed] ${event.toolName}.${event.operation}: ${event.message ?? ''}\n`;
  }
  return undefined;
}
