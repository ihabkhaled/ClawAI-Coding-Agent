import { outcomeFromTerminalEvent } from '../core/headless-outcome';

import { HEADLESS_TERMINAL_EVENTS } from './headless-session.constants';

import type {
  HeadlessRunReport,
  HeadlessSessionPorts,
  HeadlessStreamEvent,
} from './headless-session.types';
import type { HeadlessOutcome } from '../core/headless-outcome.types';

/**
 * Drives one non-interactive run to its end.
 *
 * This is the loop a pipeline needs and a person does not: start a run, execute
 * whatever tools the model asks for, hand each result back, and stop when the
 * run stops. Everything that would normally ask a human — an approval, a model
 * choice, a retry prompt — has to have been decided before this is called, or
 * the run blocks and says so.
 *
 * Every side is injected. The point of a headless runner is that it has no
 * host, so it takes its transport and its tool execution as ports rather than
 * reaching for a VS Code API that will not be there. That also makes the loop
 * testable without a backend, which matters because the interesting cases —
 * a run that ends on nothing, a tool that throws, a deadline that passes — are
 * the ones a live test is worst at producing on demand.
 */
export async function runHeadlessSession(ports: HeadlessSessionPorts): Promise<HeadlessRunReport> {
  const deadline = ports.now() + ports.deadlineMs;
  const state: { toolCalls: number; terminal?: string } = { toolCalls: 0 };

  try {
    await consume(ports, deadline, state);
  } catch (error) {
    // An aborted stream throws from inside the fetch. That exception is the
    // cancel arriving, not a second failure, so it must not be reported as one.
    if (ports.signal?.aborted !== true) throw error;
  }

  const outcome: HeadlessOutcome =
    ports.signal?.aborted === true && state.terminal === undefined
      ? 'cancelled'
      : outcomeFor(state.terminal, ports.now() >= deadline);
  return {
    outcome,
    toolCalls: state.toolCalls,
    ...(state.terminal === undefined ? {} : { terminalEvent: state.terminal }),
  };
}

async function consume(
  ports: HeadlessSessionPorts,
  deadline: number,
  state: { toolCalls: number; terminal?: string },
): Promise<void> {
  for await (const event of ports.events()) {
    if (ports.signal?.aborted === true) return;
    ports.onEvent?.(event);
    if (isToolRequest(event)) {
      state.toolCalls += 1;
      await ports.answerTool(event);
    }
    if (HEADLESS_TERMINAL_EVENTS.includes(event.type)) {
      state.terminal = event.type;
      return;
    }
    // Checked after the event rather than before, so a run that finishes in the
    // same moment the deadline passes is reported as finished. A deadline is a
    // limit on waiting, not a reason to discard an answer already in hand.
    if (ports.now() >= deadline) return;
  }
}

/**
 * A run with no terminal event that also ran out of time is `exhausted`, not
 * `failed`.
 *
 * The two need different responses. A failure means the work went wrong; a
 * deadline means the work was bigger than the allowance, and the same run with
 * more time may be fine. Reporting both as failure is what makes people raise
 * timeouts blindly instead of reading them.
 */
function outcomeFor(terminal: string | undefined, pastDeadline: boolean): HeadlessOutcome {
  if (terminal === undefined && pastDeadline) return 'exhausted';
  return outcomeFromTerminalEvent(terminal);
}

function isToolRequest(event: HeadlessStreamEvent): boolean {
  return event.type === 'tool.requested';
}
