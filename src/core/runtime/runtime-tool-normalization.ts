import { z } from 'zod';

import {
  parseToolInvocation,
  toolInvocationSchema,
  type ToolInvocation,
} from './runtime-tool-contracts';

const MAX_PLAIN_DOCUMENT_BYTES = 524_288;

const structuredToolInvocationEnvelopeSchema = z
  .object({
    toolInvocation: toolInvocationSchema,
  })
  .strict();

export type ToolInvocationNormalizationInput =
  | { readonly kind: 'native'; readonly value: unknown }
  | { readonly kind: 'structured-json'; readonly value: unknown }
  | { readonly kind: 'plain-json'; readonly value: string };

export type ToolInvocationRepairDecision =
  | {
      readonly action: 'repair';
      readonly repairAttempt: 1;
      readonly prompt: string;
    }
  | {
      readonly action: 'reject';
      readonly reason: 'repair-exhausted';
    };

const repairPrompt = [
  'Your previous tool invocation was invalid.',
  'Return exactly one JSON document with one top-level key named "toolInvocation".',
  'The value must match the supplied ToolInvocation schema exactly, including all required identity, target, epoch, and idempotency fields.',
  'Do not add unknown fields. No Markdown, code fence, commentary, prefix, or trailing text.',
].join(' ');

function parseStructuredEnvelope(value: unknown): ToolInvocation {
  return structuredToolInvocationEnvelopeSchema.parse(value).toolInvocation;
}

function parsePlainDocument(value: string): ToolInvocation {
  const bytes = new TextEncoder().encode(value).byteLength;
  if (bytes > MAX_PLAIN_DOCUMENT_BYTES) {
    throw new Error(
      `Plain tool invocation exceeds the ${String(MAX_PLAIN_DOCUMENT_BYTES)} bytes limit`,
    );
  }
  if (value.trim().length === 0) {
    throw new Error('Plain tool invocation JSON document is empty');
  }

  let document: unknown;
  try {
    document = JSON.parse(value);
  } catch {
    throw new Error('Plain tool invocation must be exactly one valid JSON document');
  }
  return parseStructuredEnvelope(document);
}

export function normalizeToolInvocation(input: ToolInvocationNormalizationInput): ToolInvocation {
  switch (input.kind) {
    case 'native':
      return parseToolInvocation(input.value);
    case 'structured-json':
      return parseStructuredEnvelope(input.value);
    case 'plain-json':
      return parsePlainDocument(input.value);
  }
}

export function normalizeToolInvocationForAdmission(value: unknown): ToolInvocation {
  const invocation = parseToolInvocation(value);
  if (
    invocation.toolName !== 'workspace.command' ||
    invocation.toolVersion !== '2.0.0' ||
    !Object.hasOwn(invocation.arguments, 'targetId')
  ) {
    return invocation;
  }
  return {
    ...invocation,
    arguments: Object.fromEntries(
      Object.entries(invocation.arguments).filter(([key]) => key !== 'targetId'),
    ),
  };
}

export function decideToolInvocationRepair(
  repairAttemptsUsed: number,
): ToolInvocationRepairDecision {
  if (!Number.isInteger(repairAttemptsUsed) || repairAttemptsUsed < 0 || repairAttemptsUsed > 1) {
    throw new Error('Tool invocation repair attempt must be 0 or 1');
  }
  if (repairAttemptsUsed === 1) {
    return { action: 'reject', reason: 'repair-exhausted' };
  }
  return { action: 'repair', repairAttempt: 1, prompt: repairPrompt };
}
