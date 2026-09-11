import { randomUUID } from 'node:crypto';

import { canonicalJson, sha256 } from '../headless/headless-transport';

import type { AgentToolkit } from './agent-sdk.types';
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
export function toolResultFor(event: HeadlessStreamEvent, toolkit: AgentToolkit): unknown {
  const payload = (event.payload ?? {}) as ToolRequestPayload;
  const invocationId = payload.invocationId ?? 'invocation.unknown';
  const args = payload.invocation?.arguments ?? {};
  const startedAt = new Date().toISOString();
  const attempt = attempt_(toolkit, payload, args);
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

function attempt_(
  toolkit: AgentToolkit,
  payload: ToolRequestPayload,
  args: Record<string, unknown>,
): { structured?: unknown; failure?: unknown } {
  try {
    return {
      structured: toolkit.execute({
        toolName: payload.toolName ?? '',
        operation: payload.operation ?? '',
        arguments: args,
      }),
    };
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
