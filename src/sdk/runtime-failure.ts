import { FAILURE_REASON_FIELDS, FAILURE_REASON_MAX_CHARS } from './runtime-failure.constants';
import { UNKNOWN_TOOL_PATTERN } from './tool-alias.constants';

import type { AgentResult } from './create-agent.types';
import type { HeadlessStreamEvent } from '../headless/headless-session.types';

function textOf(value: unknown): string | undefined {
  if (typeof value === 'string' && value.length > 0) return value;
  if (typeof value === 'object' && value !== null) {
    const nested = (value as Record<string, unknown>).message;
    return typeof nested === 'string' && nested.length > 0 ? nested : undefined;
  }
  return undefined;
}

/**
 * Why the runtime ended a run as failed, from the `run.failed` event's payload:
 * the first of `message`, `error`, `reason`, `detail`, `code` that has text,
 * else the payload itself. Not yet redacted.
 */
export function runtimeFailureReason(event: HeadlessStreamEvent): string {
  const payload = event.payload ?? {};
  const parts = FAILURE_REASON_FIELDS.map((field) => textOf(payload[field])).filter(
    (part): part is string => part !== undefined,
  );
  const reason = parts.length > 0 ? parts.join(': ') : JSON.stringify(payload);
  return reason.slice(0, FAILURE_REASON_MAX_CHARS);
}

/** The platform error code of a failure payload: its `code`, or the `code` of a nested `reason` or `error`. */
export function failurePayloadCode(payload: unknown): string | undefined {
  const record =
    typeof payload === 'object' && payload !== null ? (payload as Record<string, unknown>) : {};
  for (const value of [record, record.reason, record.error]) {
    const code =
      typeof value === 'object' && value !== null ? (value as { code?: unknown }).code : undefined;
    if (typeof code === 'string') return code;
  }
  return undefined;
}

/** What a runtime failure adds to a result: its reason as `error`, and `unknownTool` when the model named a missing tool. */
export function failureFields(
  report: { readonly terminalEvent?: string },
  failure: string,
): Pick<AgentResult, 'error' | 'unknownTool'> {
  if (report.terminalEvent !== 'run.failed' || failure.length === 0) return {};
  return {
    error: failure,
    ...(UNKNOWN_TOOL_PATTERN.test(failure) ? { unknownTool: true as const } : {}),
  };
}
