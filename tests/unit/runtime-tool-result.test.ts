import { describe, expect, it } from 'vitest';

import { buildRuntimeToolResult } from '../../src/core/runtime/runtime-tool-result';

const invocation = {
  schemaVersion: '2.0' as const,
  invocationId: 'inv_01JZZZZZZZZZZZZZZZZZZZZZZZ',
  runId: 'run_01JZZZZZZZZZZZZZZZZZZZZZZZ',
  turnId: 'turn_01JZZZZZZZZZZZZZZZZZZZZZZ',
  toolName: 'workspace.context',
  toolVersion: '1.0',
  operation: 'read',
  arguments: { section: 'architecture' },
  targetId: 'target:primary',
  epochs: { account: 1, workspace: 2, target: 3, policy: 4 },
  idempotencyKey: 'idem_01JZZZZZZZZZZZZZZZZZZZZZZ',
  requestedAt: '2026-08-02T08:00:00.000Z',
};

const base = {
  invocation,
  receiptId: 'receipt_01JZZZZZZZZZZZZZZZZZZZZZ',
  startedAt: '2026-08-02T08:00:01.000Z',
  completedAt: '2026-08-02T08:00:02.000Z',
  continuation: { action: 'final' as const },
  maxOutputBytes: 2_048,
};

describe('runtime tool result builder', () => {
  it('builds deterministic bounded receipts for successful structured output', () => {
    const first = buildRuntimeToolResult({
      ...base,
      status: 'succeeded',
      structured: { files: 3, names: ['a.ts', 'b.ts'] },
      modelText: 'Three admitted files were inspected.',
    });
    const second = buildRuntimeToolResult({
      ...base,
      status: 'succeeded',
      structured: { files: 3, names: ['a.ts', 'b.ts'] },
      modelText: 'Three admitted files were inspected.',
    });

    expect(first).toEqual(second);
    expect(first.receipt.argumentHash).toMatch(/^sha256:[a-f0-9]{64}$/u);
    expect(first.receipt.resultHash).toMatch(/^sha256:[a-f0-9]{64}$/u);
    expect(first.receipt).toMatchObject({ durationMs: 1_000, truncated: false });
  });

  it('redacts secret-shaped fields before hashing or returning output', () => {
    const result = buildRuntimeToolResult({
      ...base,
      status: 'succeeded',
      structured: {
        authorization: 'Bearer sensitive-value',
        nested: { apiKey: 'sensitive-value', safe: 'visible' },
      },
    });

    expect(result.structured).toEqual({
      authorization: '[REDACTED]',
      nested: { apiKey: '[REDACTED]', safe: 'visible' },
    });
    expect(result.receipt.redactionApplied).toBe(true);
    expect(JSON.stringify(result)).not.toContain('sensitive-value');
  });

  it('redacts model text and error details and counts them in the bounded receipt', () => {
    const result = buildRuntimeToolResult({
      ...base,
      status: 'failed',
      modelText: 'Bearer model-secret',
      error: {
        code: 'TOOL_EXECUTION_FAILED',
        message: 'Bearer error-secret',
        retryable: false,
        redactionApplied: false,
        details: { apiKey: 'details-secret' },
      },
    });

    expect(result.modelText).toBe('Bearer [REDACTED]');
    expect(result.error).toMatchObject({
      message: 'Bearer [REDACTED]',
      details: { apiKey: '[REDACTED]' },
      redactionApplied: true,
    });
    expect(result.receipt.outputBytes).toBeGreaterThan(100);
  });

  it('includes safe error details in receipt byte accounting', () => {
    const concise = buildRuntimeToolResult({
      ...base,
      status: 'failed',
      error: {
        code: 'TOOL_EXECUTION_FAILED',
        message: 'The trusted tool executor failed.',
        retryable: false,
        redactionApplied: false,
      },
    });
    const detailed = buildRuntimeToolResult({
      ...base,
      status: 'failed',
      error: {
        code: 'TOOL_EXECUTION_FAILED',
        message: 'The trusted tool executor failed.',
        retryable: false,
        redactionApplied: false,
        details: { reason: 'x'.repeat(300) },
      },
    });

    expect(detailed.receipt.outputBytes).toBeGreaterThan(concise.receipt.outputBytes);
  });

  it('returns an immutable result snapshot', () => {
    const result = buildRuntimeToolResult({
      ...base,
      status: 'succeeded',
      structured: { nested: { files: ['a.ts'] } },
    });

    expect(Object.isFrozen(result)).toBe(true);
    expect(Object.isFrozen(result.receipt)).toBe(true);
    expect(Object.isFrozen(result.structured)).toBe(true);
    expect(Object.isFrozen(result.structured?.nested)).toBe(true);
  });

  it('replaces oversized output with a bounded truncation marker', () => {
    const result = buildRuntimeToolResult({
      ...base,
      status: 'succeeded',
      structured: { content: 'x'.repeat(4_000) },
      modelText: 'y'.repeat(4_000),
      maxOutputBytes: 1_024,
    });

    expect(result.structured).toEqual({ truncated: true });
    expect(result.modelText).toBeUndefined();
    expect(result.receipt.truncated).toBe(true);
    expect(result.receipt.outputBytes).toBeLessThanOrEqual(1_024);
  });

  it('requires a safe canonical error for non-success outcomes', () => {
    const result = buildRuntimeToolResult({
      ...base,
      status: 'denied',
      error: {
        code: 'TOOL_POLICY_DENIED',
        message: 'The current policy denied this tool.',
        retryable: false,
        redactionApplied: true,
      },
    });
    expect(result).toMatchObject({ status: 'denied', error: { code: 'TOOL_POLICY_DENIED' } });
    expect(() => buildRuntimeToolResult({ ...base, status: 'failed' })).toThrow(/error/i);
  });

  it('rejects invalid timing and output limits', () => {
    expect(() =>
      buildRuntimeToolResult({
        ...base,
        status: 'succeeded',
        startedAt: '2026-08-02T08:00:03.000Z',
      }),
    ).toThrow(/time/i);
    expect(() =>
      buildRuntimeToolResult({ ...base, status: 'succeeded', maxOutputBytes: 0 }),
    ).toThrow(/limit/i);
  });

  /**
   * Redis 7.4's Lua cjson cannot represent an empty array — both `[]` and `{}`
   * decode to a table with no entries and `cjson.encode` writes `{}` for
   * either. Every runtime event is decoded and re-encoded inside the Lua state
   * machine on its way here, so an argument admitted as `[]` arrives at this
   * extension as `{}`. Hashing the two differently broke `runtime.agents`
   * outright: its graph carries empty `integrationSeams` arrays, the backend
   * hashed `[]` at admission, this extension hashed the `{}` it received, and
   * every completed sub-agent graph was rejected as RECEIPT_ARGUMENT_MISMATCH
   * — no parallel run could ever report back.
   */
  it('hashes an empty array identically to an empty object', () => {
    const withArray = buildRuntimeToolResult({
      ...base,
      invocation: { ...invocation, arguments: { integrationSeams: [] } },
      status: 'succeeded',
    });
    const withObject = buildRuntimeToolResult({
      ...base,
      invocation: { ...invocation, arguments: { integrationSeams: {} } },
      status: 'succeeded',
    });

    expect(withArray.receipt.argumentHash).toBe(withObject.receipt.argumentHash);
  });

  it('still distinguishes a non-empty array from an object', () => {
    const withArray = buildRuntimeToolResult({
      ...base,
      invocation: { ...invocation, arguments: { seams: ['a'] } },
      status: 'succeeded',
    });
    const withObject = buildRuntimeToolResult({
      ...base,
      invocation: { ...invocation, arguments: { seams: { 0: 'a' } } },
      status: 'succeeded',
    });

    expect(withArray.receipt.argumentHash).not.toBe(withObject.receipt.argumentHash);
  });
});
