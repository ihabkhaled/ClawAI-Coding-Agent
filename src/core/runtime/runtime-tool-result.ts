import { createHash } from 'node:crypto';

import { redactText, redactValue } from '../redaction';

import { runtimeJsonObjectSchema, type RuntimeJsonObject } from './runtime-json-value';
import {
  parseToolInvocation,
  parseToolResult,
  type Continuation,
  type ToolError,
  type ToolInvocation,
  type ToolResult,
} from './runtime-tool-contracts';

function freezeDeep<T>(value: T): T {
  if (value !== null && typeof value === 'object') {
    for (const entry of Object.values(value)) freezeDeep(entry);
    Object.freeze(value);
  }
  return value;
}

export interface RuntimeToolResultInput {
  readonly invocation: ToolInvocation;
  /**
   * The arguments the BACKEND admitted, when they differ from the ones this
   * invocation executes with. Only workspace.command 2.0.0 differs today: its
   * `targetId` is stripped from `arguments` so the strict input schema accepts
   * it, while the backend hashed the model's original request. Omit it and the
   * executing arguments are hashed, which is correct for every other tool.
   */
  readonly receiptArguments?: ToolInvocation['arguments'];
  readonly receiptId: string;
  readonly startedAt: string;
  readonly completedAt: string;
  readonly continuation: Continuation;
  readonly maxOutputBytes: number;
  readonly status: ToolResult['status'];
  readonly structured?: RuntimeJsonObject;
  readonly modelText?: string;
  readonly error?: ToolError;
}

function canonicalJson(value: unknown): string {
  if (value === null || typeof value === 'boolean' || typeof value === 'number') {
    return JSON.stringify(value);
  }
  if (typeof value === 'string') {
    return JSON.stringify(value);
  }
  if (Array.isArray(value)) {
    return `[${value.map((entry) => canonicalJson(entry)).join(',')}]`;
  }
  if (typeof value === 'object') {
    return `{${Object.entries(value)
      .sort(([left], [right]) => left.localeCompare(right))
      .map(([key, entry]) => `${JSON.stringify(key)}:${canonicalJson(entry)}`)
      .join(',')}}`;
  }
  throw new Error('Runtime tool result contains non-JSON data');
}

function sha256(value: unknown): string {
  return `sha256:${createHash('sha256').update(canonicalJson(value)).digest('hex')}`;
}

function utf8Bytes(value: string): number {
  return new TextEncoder().encode(value).byteLength;
}

function truncateText(value: string, maxBytes: number): string {
  let output = '';
  for (const character of value) {
    if (utf8Bytes(output + character) > maxBytes) return `${output}…`;
    output += character;
  }
  return output;
}

function sanitizeError(error: ToolError | undefined): ToolError | undefined {
  if (error === undefined) return undefined;
  const message = redactText(error.message);
  const details =
    error.details === undefined
      ? undefined
      : runtimeJsonObjectSchema.parse(redactValue(error.details));
  const redactionApplied =
    message !== error.message ||
    (error.details !== undefined && canonicalJson(error.details) !== canonicalJson(details));
  return {
    code: error.code,
    message: truncateText(message, 512),
    retryable: error.retryable,
    redactionApplied,
    ...(details === undefined ? {} : { details }),
  };
}

function sanitizeOutput(
  structured: RuntimeJsonObject | undefined,
  modelText: string | undefined,
  error: ToolError | undefined,
): {
  readonly error: ToolError | undefined;
  readonly modelText: string | undefined;
  readonly redactionApplied: boolean;
  readonly structured: RuntimeJsonObject | undefined;
} {
  const safeStructured =
    structured === undefined ? undefined : runtimeJsonObjectSchema.parse(redactValue(structured));
  const safeText = modelText === undefined ? undefined : redactText(modelText);
  const safeError = sanitizeError(error);
  return {
    structured: safeStructured,
    modelText: safeText,
    error: safeError,
    redactionApplied:
      (structured !== undefined && canonicalJson(structured) !== canonicalJson(safeStructured)) ||
      safeText !== modelText ||
      (error !== undefined && safeError?.redactionApplied === true),
  };
}

function boundedOutput(
  structured: RuntimeJsonObject | undefined,
  modelText: string | undefined,
  error: ToolError | undefined,
  maxOutputBytes: number,
): {
  readonly structured: RuntimeJsonObject | undefined;
  readonly modelText: string | undefined;
  readonly error: ToolError | undefined;
  readonly outputBytes: number;
  readonly redactionApplied: boolean;
  readonly truncated: boolean;
} {
  if (!Number.isInteger(maxOutputBytes) || maxOutputBytes < 1_024) {
    throw new Error('Runtime tool result output limit must be an integer of at least 1024 bytes');
  }
  const sanitized = sanitizeOutput(structured, modelText, error);
  const outputBytes = utf8Bytes(
    canonicalJson({
      structured: sanitized.structured ?? null,
      modelText: sanitized.modelText ?? null,
      error: sanitized.error ?? null,
    }),
  );
  if (outputBytes <= maxOutputBytes) {
    return {
      structured: sanitized.structured,
      modelText: sanitized.modelText,
      error: sanitized.error,
      outputBytes,
      redactionApplied: sanitized.redactionApplied,
      truncated: false,
    };
  }
  const marker: RuntimeJsonObject = { truncated: true };
  const truncationError =
    sanitized.error === undefined
      ? undefined
      : {
          ...sanitized.error,
          details: undefined,
          message: 'Tool outcome was truncated.',
          redactionApplied: true,
        };
  return {
    structured: marker,
    modelText: undefined,
    error: truncationError,
    outputBytes: utf8Bytes(
      canonicalJson({ structured: marker, modelText: null, error: truncationError ?? null }),
    ),
    redactionApplied: sanitized.redactionApplied,
    truncated: true,
  };
}

export function buildRuntimeToolResult(input: RuntimeToolResultInput): ToolResult {
  const invocation = parseToolInvocation(input.invocation);
  const startedAtMs = Date.parse(input.startedAt);
  const completedAtMs = Date.parse(input.completedAt);
  if (
    !Number.isFinite(startedAtMs) ||
    !Number.isFinite(completedAtMs) ||
    completedAtMs < startedAtMs
  ) {
    throw new Error('Runtime tool result time range is invalid');
  }
  const output = boundedOutput(
    input.structured,
    input.modelText,
    input.error,
    input.maxOutputBytes,
  );
  const resultBody = {
    structured: output.structured ?? null,
    modelText: output.modelText ?? null,
    error: output.error ?? null,
  };
  return freezeDeep(
    parseToolResult({
      schemaVersion: '2.0',
      invocationId: invocation.invocationId,
      status: input.status,
      ...(output.structured === undefined ? {} : { structured: output.structured }),
      ...(output.modelText === undefined ? {} : { modelText: output.modelText }),
      ...(output.error === undefined ? {} : { error: output.error }),
      receipt: {
        schemaVersion: '2.0',
        receiptId: input.receiptId,
        invocationId: invocation.invocationId,
        // Hashes the arguments AS ADMITTED, which is not always the arguments
        // this invocation executes with. `normalizeToolInvocationForAdmission`
        // strips `targetId` out of `arguments` for workspace.command 2.0.0 so
        // the strict input schema accepts it — but the backend recorded its own
        // hash from the model's ORIGINAL request, `targetId` included. Hashing
        // the stripped copy made every workspace.command receipt fail the
        // backend's equality check with RECEIPT_ARGUMENT_MISMATCH, so the agent
        // could read files but never run a command. The receipt attests what was
        // admitted; normalisation is an execution detail and must not change it.
        argumentHash: sha256(input.receiptArguments ?? invocation.arguments),
        resultHash: sha256(resultBody),
        startedAt: input.startedAt,
        completedAt: input.completedAt,
        durationMs: completedAtMs - startedAtMs,
        outputBytes: output.outputBytes,
        truncated: output.truncated,
        redactionApplied: output.redactionApplied,
      },
      continuation: input.continuation,
    }),
  );
}
