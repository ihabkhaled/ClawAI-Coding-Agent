import { z } from 'zod';

import { boundedRuntimeJsonObject, type RuntimeJsonObject } from './runtime-json-value';
import {
  CAPABILITY_RISK_CLASSES,
  RUNTIME_ID_PATTERN,
  RUNTIME_PROTOCOL_V2,
  SHA256_PATTERN,
} from './runtime-protocol.constants';

const TOOL_ARGUMENT_BYTES = 262_144;
const TOOL_RESULT_BYTES = 1_048_576;
const TOOL_ERROR_DETAIL_BYTES = 32_768;
const TOOL_NAME_PATTERN = /^[a-z][a-z0-9_.-]+$/u;
const OPERATION_PATTERN = /^[a-z][a-z0-9_.-]*$/u;
const ERROR_CODE_PATTERN = /^[A-Z][A-Z0-9_]{2,79}$/u;

const runtimeEpochsSchema = z
  .object({
    account: z.number().int().nonnegative(),
    workspace: z.number().int().nonnegative(),
    target: z.number().int().nonnegative(),
    policy: z.number().int().nonnegative(),
  })
  .strict();

function addDuplicateIssue(
  values: readonly string[],
  label: string,
  path: PropertyKey[],
  context: z.core.$RefinementCtx,
): void {
  if (new Set(values).size !== values.length) {
    context.addIssue({ code: 'custom', message: `Duplicate ${label}`, path });
  }
}

export const toolDefinitionSchema = z
  .object({
    schemaVersion: z.literal(RUNTIME_PROTOCOL_V2),
    name: z.string().min(2).max(80).regex(TOOL_NAME_PATTERN),
    version: z.string().min(1).max(40),
    description: z.string().trim().min(1).max(2_000),
    operations: z.array(z.string().min(1).max(80).regex(OPERATION_PATTERN)).min(1).max(100),
    riskClasses: z.array(z.enum(CAPABILITY_RISK_CLASSES)).min(1).max(13),
    targetIds: z.array(z.string().regex(RUNTIME_ID_PATTERN)).min(1).max(32),
    inputSchema: boundedRuntimeJsonObject(TOOL_ARGUMENT_BYTES),
  })
  .strict()
  .superRefine((definition, context) => {
    addDuplicateIssue(definition.operations, 'operation', ['operations'], context);
    addDuplicateIssue(definition.riskClasses, 'risk class', ['riskClasses'], context);
    addDuplicateIssue(definition.targetIds, 'target', ['targetIds'], context);
  });

export const toolInvocationSchema = z
  .object({
    schemaVersion: z.literal(RUNTIME_PROTOCOL_V2),
    invocationId: z.string().regex(RUNTIME_ID_PATTERN),
    runId: z.string().regex(RUNTIME_ID_PATTERN),
    turnId: z.string().regex(RUNTIME_ID_PATTERN),
    toolName: z.string().min(2).max(80).regex(TOOL_NAME_PATTERN),
    toolVersion: z.string().min(1).max(40),
    operation: z.string().min(1).max(80).regex(OPERATION_PATTERN),
    arguments: boundedRuntimeJsonObject(TOOL_ARGUMENT_BYTES),
    targetId: z.string().regex(RUNTIME_ID_PATTERN),
    epochs: runtimeEpochsSchema,
    idempotencyKey: z.string().regex(RUNTIME_ID_PATTERN),
    requestedAt: z.iso.datetime({ offset: true }),
  })
  .strict();

export const toolErrorSchema = z
  .object({
    code: z.string().regex(ERROR_CODE_PATTERN),
    message: z.string().trim().min(1).max(2_000),
    retryable: z.boolean(),
    redactionApplied: z.boolean(),
    details: boundedRuntimeJsonObject(TOOL_ERROR_DETAIL_BYTES).optional(),
  })
  .strict();

export const toolReceiptSchema = z
  .object({
    schemaVersion: z.literal(RUNTIME_PROTOCOL_V2),
    receiptId: z.string().regex(RUNTIME_ID_PATTERN),
    invocationId: z.string().regex(RUNTIME_ID_PATTERN),
    argumentHash: z.string().regex(SHA256_PATTERN),
    resultHash: z.string().regex(SHA256_PATTERN).optional(),
    startedAt: z.iso.datetime({ offset: true }),
    completedAt: z.iso.datetime({ offset: true }),
    durationMs: z.number().int().nonnegative().max(86_400_000),
    outputBytes: z.number().int().nonnegative().max(16_777_216),
    truncated: z.boolean(),
    redactionApplied: z.boolean(),
  })
  .strict()
  .superRefine((receipt, context) => {
    if (Date.parse(receipt.completedAt) < Date.parse(receipt.startedAt)) {
      context.addIssue({
        code: 'custom',
        message: 'Receipt completedAt cannot precede startedAt',
        path: ['completedAt'],
      });
    }
  });

export const continuationSchema = z
  .object({
    action: z.enum(['continue', 'final', 'repair']),
    nextTurnId: z.string().regex(RUNTIME_ID_PATTERN).optional(),
    repairAttempt: z.literal(1).optional(),
  })
  .strict()
  .superRefine((continuation, context) => {
    if (continuation.action === 'repair' && continuation.repairAttempt !== 1) {
      context.addIssue({ code: 'custom', message: 'Repair requires attempt 1' });
    }
    if (continuation.action !== 'repair' && continuation.repairAttempt !== undefined) {
      context.addIssue({ code: 'custom', message: 'Repair attempt requires repair action' });
    }
    if (continuation.action === 'continue' && continuation.nextTurnId === undefined) {
      context.addIssue({ code: 'custom', message: 'Continue requires a next turn identifier' });
    }
    if (continuation.action !== 'continue' && continuation.nextTurnId !== undefined) {
      context.addIssue({ code: 'custom', message: 'Next turn requires continue action' });
    }
  });

export const toolResultSchema = z
  .object({
    schemaVersion: z.literal(RUNTIME_PROTOCOL_V2),
    invocationId: z.string().regex(RUNTIME_ID_PATTERN),
    status: z.enum(['succeeded', 'failed', 'denied', 'cancelled', 'timed-out']),
    structured: boundedRuntimeJsonObject(TOOL_RESULT_BYTES).optional(),
    modelText: z.string().max(65_536).optional(),
    error: toolErrorSchema.optional(),
    receipt: toolReceiptSchema,
    continuation: continuationSchema,
  })
  .strict()
  .superRefine((result, context) => {
    if (result.status === 'succeeded' && result.error !== undefined) {
      context.addIssue({ code: 'custom', message: 'Succeeded result cannot contain an error' });
    }
    if (result.status !== 'succeeded' && result.error === undefined) {
      context.addIssue({ code: 'custom', message: 'Non-succeeded result requires an error' });
    }
    if (result.receipt.invocationId !== result.invocationId) {
      context.addIssue({ code: 'custom', message: 'Result receipt invocation does not match' });
    }
  });

export const runBudgetSchema = z
  .object({
    maxModelTurns: z.number().int().min(1).max(100),
    maxToolCalls: z.number().int().min(0).max(500),
    maxToolRounds: z.number().int().min(0).max(100),
    maxRepairAttempts: z.number().int().min(0).max(1),
    maxRuntimeMs: z.number().int().min(1_000).max(7_200_000),
    maxOutputBytes: z.number().int().min(1_024).max(16_777_216),
    maxToolResultBytes: z.number().int().min(1_024).max(1_048_576),
  })
  .strict()
  .superRefine((budget, context) => {
    if (budget.maxToolRounds > budget.maxToolCalls) {
      context.addIssue({
        code: 'custom',
        message: 'Tool rounds cannot exceed tool calls',
        path: ['maxToolRounds'],
      });
    }
  });

export type ToolDefinition = z.infer<typeof toolDefinitionSchema>;
export type ToolInvocation = z.infer<typeof toolInvocationSchema>;
export type ToolError = z.infer<typeof toolErrorSchema>;
export type ToolReceipt = z.infer<typeof toolReceiptSchema>;
export type Continuation = z.infer<typeof continuationSchema>;
export type ToolResult = z.infer<typeof toolResultSchema>;
export type RunBudget = z.infer<typeof runBudgetSchema>;
export type { RuntimeJsonObject };

export const parseToolDefinition = (value: unknown): ToolDefinition =>
  toolDefinitionSchema.parse(value);
export const parseToolInvocation = (value: unknown): ToolInvocation =>
  toolInvocationSchema.parse(value);
export const parseToolError = (value: unknown): ToolError => toolErrorSchema.parse(value);
export const parseToolReceipt = (value: unknown): ToolReceipt => toolReceiptSchema.parse(value);
export const parseContinuation = (value: unknown): Continuation => continuationSchema.parse(value);
export const parseToolResult = (value: unknown): ToolResult => toolResultSchema.parse(value);
export const parseRunBudget = (value: unknown): RunBudget => runBudgetSchema.parse(value);
