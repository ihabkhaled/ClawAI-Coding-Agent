import { randomUUID } from 'node:crypto';

import { canonicalJson, sha256 } from '../headless/headless-transport';

import { guardToolResult } from './tool-result-guard';

import type { AgentToolCall, AgentToolkit, ToolAttempt } from './agent-sdk.types';
import type { ToolRequestPayload } from '../headless/headless-main.types';
import type { HeadlessStreamEvent } from '../headless/headless-session.types';

/**
 * Turns one tool request into the result the backend will accept.
 *
 * Separated from the run loop because it is the part callers get wrong. The
 * receipt is verified, not merely recorded: `resultHash` and `outputBytes` must
 * match a canonical serialization of exactly `{error, modelText, structured}`,
 * and any mismatch comes back as a server error with no explanation attached.
 * Writing that once here is the difference between an SDK and a description of
 * one.
 *
 * A toolkit that throws produces a failed result rather than ending the run.
 * The model can read a failure and try something else; an exception out of the
 * loop only tells the operator that something went wrong somewhere.
 */
export async function toolResultFor(
  event: HeadlessStreamEvent,
  toolkit: AgentToolkit,
  denial?: string,
  signal?: AbortSignal,
): Promise<unknown> {
  const payload = (event.payload ?? {}) as ToolRequestPayload;
  const invocationId = payload.invocationId ?? 'invocation.unknown';
  const args = payload.invocation?.arguments ?? {};
  const startedAt = new Date().toISOString();
  const attempt = await attemptFor(event, toolkit, denial, signal);
  const modelText =
    attempt.structured === undefined ? null : JSON.stringify(attempt.structured).slice(0, 2_000);
  const canonical = canonicalJson({
    error: attempt.failure ?? null,
    modelText,
    structured: attempt.structured ?? null,
  });
  return {
    schemaVersion: '2.0',
    invocationId,
    status: attempt.failure === undefined ? 'succeeded' : 'failed',
    ...(attempt.structured === undefined ? {} : { structured: attempt.structured }),
    ...(modelText === null ? {} : { modelText }),
    ...(attempt.failure === undefined ? {} : { error: attempt.failure }),
    receipt: {
      schemaVersion: '2.0',
      receiptId: `receipt.${randomUUID()}`,
      invocationId,
      argumentHash: sha256(canonicalJson(args)),
      resultHash: sha256(canonical),
      startedAt,
      completedAt: startedAt,
      durationMs: 0,
      outputBytes: Buffer.byteLength(canonical, 'utf8'),
      truncated: false,
      redactionApplied: false,
    },
    continuation: { action: 'continue', nextTurnId: `turn.${randomUUID()}` },
  };
}

/** The call a tool request names, as a toolkit receives it. */
export function toolCallOf(event: HeadlessStreamEvent): AgentToolCall {
  const payload = (event.payload ?? {}) as ToolRequestPayload;
  return {
    toolName: payload.toolName ?? '',
    operation: payload.operation ?? '',
    arguments: payload.invocation?.arguments ?? {},
  };
}

/**
 * A refused call is a result the model reads, not an exception. It can then
 * try something it is allowed to do, rather than the run ending on a tool the
 * operator deliberately withheld.
 */
function denied(message: string): ToolAttempt {
  return {
    failure: { code: 'PERMISSION_DENIED', message, retryable: false, redactionApplied: false },
  };
}

async function attemptFor(
  event: HeadlessStreamEvent,
  toolkit: AgentToolkit,
  denial: string | undefined,
  signal: AbortSignal | undefined,
): Promise<ToolAttempt> {
  return denial === undefined ? attempt_(toolkit, toolCallOf(event), signal) : denied(denial);
}

async function attempt_(
  toolkit: AgentToolkit,
  call: AgentToolCall,
  signal: AbortSignal | undefined,
): Promise<ToolAttempt> {
  try {
    // The signal is passed only when there is one, so a toolkit written before
    // it existed sees the call it always saw.
    // Guarded here as well as in the workspace executor: an MCP or custom
    // toolkit is bounded by the same ceiling the backend enforces.
    const result = await (signal === undefined
      ? toolkit.execute(call)
      : toolkit.execute(call, signal));
    return { structured: guardToolResult(result) };
  } catch (error) {
    return {
      failure: {
        code: 'TOOL_FAILED',
        message: (error instanceof Error ? error.message : 'Tool failed').slice(0, 400),
        retryable: false,
        redactionApplied: false,
      },
    };
  }
}
