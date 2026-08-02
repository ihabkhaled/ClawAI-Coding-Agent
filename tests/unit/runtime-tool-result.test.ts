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
});
