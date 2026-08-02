import { createHash } from 'node:crypto';

import { redactValue } from '../redaction';

import { runtimeJsonObjectSchema, type RuntimeJsonObject } from './runtime-json-value';
import {
  parseToolInvocation,
  parseToolResult,
  type Continuation,
  type ToolError,
  type ToolInvocation,
  type ToolResult,
} from './runtime-tool-contracts';

export interface RuntimeToolResultInput {
  readonly invocation: ToolInvocation;
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

function boundedOutput(
  structured: RuntimeJsonObject | undefined,
  modelText: string | undefined,
  maxOutputBytes: number,
): {
  readonly structured: RuntimeJsonObject | undefined;
  readonly modelText: string | undefined;
  readonly outputBytes: number;
  readonly redactionApplied: boolean;
  readonly truncated: boolean;
} {
  if (!Number.isInteger(maxOutputBytes) || maxOutputBytes < 1_024) {
    throw new Error('Runtime tool result output limit must be an integer of at least 1024 bytes');
  }
  const redacted =
    structured === undefined ? undefined : runtimeJsonObjectSchema.parse(redactValue(structured));
  const redactionApplied =
    structured !== undefined && canonicalJson(structured) !== canonicalJson(redacted);
  const outputBytes = utf8Bytes(
    canonicalJson({ structured: redacted ?? null, modelText: modelText ?? null }),
  );
  if (outputBytes <= maxOutputBytes) {
    return { structured: redacted, modelText, outputBytes, redactionApplied, truncated: false };
  }
  const marker: RuntimeJsonObject = { truncated: true };
  return {
    structured: marker,
    modelText: undefined,
    outputBytes: utf8Bytes(canonicalJson({ structured: marker, modelText: null })),
    redactionApplied,
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
  const output = boundedOutput(input.structured, input.modelText, input.maxOutputBytes);
  const resultBody = {
    structured: output.structured ?? null,
    modelText: output.modelText ?? null,
    error: input.error ?? null,
  };
  return parseToolResult({
    schemaVersion: '2.0',
    invocationId: invocation.invocationId,
    status: input.status,
    ...(output.structured === undefined ? {} : { structured: output.structured }),
    ...(output.modelText === undefined ? {} : { modelText: output.modelText }),
    ...(input.error === undefined ? {} : { error: input.error }),
    receipt: {
      schemaVersion: '2.0',
      receiptId: input.receiptId,
      invocationId: invocation.invocationId,
      argumentHash: sha256(invocation.arguments),
      resultHash: sha256(resultBody),
      startedAt: input.startedAt,
      completedAt: input.completedAt,
      durationMs: completedAtMs - startedAtMs,
      outputBytes: output.outputBytes,
      truncated: output.truncated,
      redactionApplied: output.redactionApplied || input.error?.redactionApplied === true,
    },
    continuation: input.continuation,
  });
}
