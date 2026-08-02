import { describe, expect, it } from 'vitest';

import {
  parseContinuation,
  parseRunBudget,
  parseToolDefinition,
  parseToolError,
  parseToolInvocation,
  parseToolReceipt,
  parseToolResult,
} from '../../src/core/runtime/runtime-tool-contracts';

const epochs = { account: 1, workspace: 2, target: 3, policy: 4 };
const definition = {
  schemaVersion: '2.0',
  name: 'workspace.context',
  version: '1.0',
  description: 'Read the already admitted workspace context.',
  operations: ['read'],
  riskClasses: ['inspect'],
  targetIds: ['target:primary'],
  inputSchema: {
    type: 'object',
    additionalProperties: false,
    properties: { section: { type: 'string' } },
  },
};
const invocation = {
  schemaVersion: '2.0',
  invocationId: 'inv_01JZZZZZZZZZZZZZZZZZZZZZZZ',
  runId: 'run_01JZZZZZZZZZZZZZZZZZZZZZZZ',
  turnId: 'turn_01JZZZZZZZZZZZZZZZZZZZZZZ',
  toolName: 'workspace.context',
  toolVersion: '1.0',
  operation: 'read',
  arguments: { section: 'architecture' },
  targetId: 'target:primary',
  epochs,
  idempotencyKey: 'idem_01JZZZZZZZZZZZZZZZZZZZZZZ',
  requestedAt: '2026-08-02T08:00:00.000Z',
};
const receipt = {
  schemaVersion: '2.0',
  receiptId: 'receipt_01JZZZZZZZZZZZZZZZZZZZZZ',
  invocationId: invocation.invocationId,
  argumentHash: `sha256:${'a'.repeat(64)}`,
  resultHash: `sha256:${'b'.repeat(64)}`,
  startedAt: '2026-08-02T08:00:01.000Z',
  completedAt: '2026-08-02T08:00:02.000Z',
  durationMs: 1_000,
  outputBytes: 120,
  truncated: false,
  redactionApplied: true,
};
const continuation = { action: 'continue', nextTurnId: 'turn_01K00000000000000000000000' };
const error = {
  code: 'TOOL_EXECUTION_FAILED',
  message: 'The bounded read failed.',
  retryable: false,
  redactionApplied: true,
};
const budget = {
  maxModelTurns: 20,
  maxToolCalls: 50,
  maxToolRounds: 20,
  maxRepairAttempts: 1,
  maxRuntimeMs: 900_000,
  maxOutputBytes: 1_048_576,
  maxToolResultBytes: 262_144,
};

describe('runtime tool contracts', () => {
  it('round-trips strict provider-neutral contracts', () => {
    expect(parseToolDefinition(definition)).toEqual(definition);
    expect(parseToolInvocation(invocation)).toEqual(invocation);
    expect(parseToolReceipt(receipt)).toEqual(receipt);
    expect(parseContinuation(continuation)).toEqual(continuation);
    expect(parseToolError(error)).toEqual(error);
    expect(parseRunBudget(budget)).toEqual(budget);
    expect(
      parseToolResult({
        schemaVersion: '2.0',
        invocationId: invocation.invocationId,
        status: 'succeeded',
        structured: { files: 3 },
        modelText: 'Three admitted files were inspected.',
        receipt,
        continuation,
      }),
    ).toMatchObject({ status: 'succeeded', structured: { files: 3 } });
  });

  it('rejects unknown and provider-specific top-level fields', () => {
    for (const [parse, value] of [
      [parseToolDefinition, { ...definition, provider: 'openai' }],
      [parseToolInvocation, { ...invocation, providerCallId: 'native-1' }],
      [parseToolReceipt, { ...receipt, rawEnvironment: {} }],
      [parseContinuation, { ...continuation, localRuntime: 'ollama' }],
      [parseToolError, { ...error, rawProviderError: 'secret' }],
      [parseRunBudget, { ...budget, unlimited: true }],
    ] as const) {
      expect(() => parse(value)).toThrow();
    }
  });

  it('rejects duplicate or semantically inconsistent definitions', () => {
    expect(() => parseToolDefinition({ ...definition, operations: ['read', 'read'] })).toThrow(
      /duplicate operation/i,
    );
    expect(() =>
      parseToolDefinition({ ...definition, targetIds: ['target:primary', 'target:primary'] }),
    ).toThrow(/duplicate target/i);
    expect(() =>
      parseToolDefinition({ ...definition, riskClasses: ['inspect', 'inspect'] }),
    ).toThrow(/duplicate risk/i);
  });

  it('accepts opaque secret references but rejects non-JSON and oversized arguments', () => {
    expect(
      parseToolInvocation({ ...invocation, arguments: { secretRef: 'db:local-postgres' } }),
    ).toMatchObject({ arguments: { secretRef: 'db:local-postgres' } });
    expect(() =>
      parseToolInvocation({ ...invocation, arguments: { execute: () => undefined } }),
    ).toThrow();
    expect(() =>
      parseToolInvocation({ ...invocation, arguments: { content: 'x'.repeat(300_000) } }),
    ).toThrow(/byte/i);
  });

  it('enforces result status, error, receipt, and continuation semantics', () => {
    expect(() =>
      parseToolResult({
        schemaVersion: '2.0',
        invocationId: invocation.invocationId,
        status: 'succeeded',
        error,
        receipt,
        continuation,
      }),
    ).toThrow(/succeeded/i);
    expect(() =>
      parseToolResult({
        schemaVersion: '2.0',
        invocationId: invocation.invocationId,
        status: 'failed',
        receipt,
        continuation,
      }),
    ).toThrow(/error/i);
    expect(() =>
      parseToolResult({
        schemaVersion: '2.0',
        invocationId: invocation.invocationId,
        status: 'failed',
        error,
        receipt: { ...receipt, invocationId: 'inv_01K11111111111111111111111' },
        continuation,
      }),
    ).toThrow(/receipt/i);
  });

  it('allows exactly one bounded repair continuation', () => {
    expect(parseContinuation({ action: 'repair', repairAttempt: 1 })).toEqual({
      action: 'repair',
      repairAttempt: 1,
    });
    expect(() => parseContinuation({ action: 'repair', repairAttempt: 2 })).toThrow();
    expect(() => parseContinuation({ action: 'repair' })).toThrow(/repair/i);
    expect(() => parseContinuation({ action: 'final', repairAttempt: 1 })).toThrow(/repair/i);
    expect(() => parseContinuation({ action: 'continue' })).toThrow(/next turn/i);
    expect(() =>
      parseContinuation({ action: 'final', nextTurnId: continuation.nextTurnId }),
    ).toThrow(/next turn/i);
  });

  it('enforces bounded coherent run budgets', () => {
    expect(() => parseRunBudget({ ...budget, maxRepairAttempts: 2 })).toThrow();
    expect(() => parseRunBudget({ ...budget, maxToolCalls: 0, maxToolRounds: 1 })).toThrow(
      /tool rounds/i,
    );
    expect(() => parseRunBudget({ ...budget, maxToolCalls: 2, maxToolRounds: 3 })).toThrow(
      /tool rounds/i,
    );
  });

  it('rejects non-finite JSON values and invalid receipt timing or hashes', () => {
    expect(() =>
      parseToolResult({
        schemaVersion: '2.0',
        invocationId: invocation.invocationId,
        status: 'succeeded',
        structured: { score: Number.POSITIVE_INFINITY },
        receipt,
        continuation,
      }),
    ).toThrow();
    expect(() => parseToolReceipt({ ...receipt, resultHash: 'md5:abc' })).toThrow();
    expect(() =>
      parseToolReceipt({
        ...receipt,
        startedAt: '2026-08-02T08:00:03.000Z',
        completedAt: '2026-08-02T08:00:02.000Z',
      }),
    ).toThrow(/completed/i);
  });
});
