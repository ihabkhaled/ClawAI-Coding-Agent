import { createHash } from 'node:crypto';

import { describe, expect, it } from 'vitest';

import { MAX_TOOL_RESULT_FILE_IDS } from '../../src/core/runtime/runtime-result-files.constants';
import { parseToolResult } from '../../src/core/runtime/runtime-tool-contracts';
import { buildRuntimeToolResult, canonicalJson } from '../../src/core/runtime/runtime-tool-result';
import {
  RuntimeToolDispatcher,
  type RuntimeToolExecutionOutput,
} from '../../src/services/runtime-tool-dispatcher';

import type { ToolDefinition, ToolInvocation } from '../../src/core/runtime/runtime-tool-contracts';

// F030: a tool result may name uploaded images for the next model turn. The
// ids are covered by the receipt exactly the way claw-chat-service's
// `canonicalResultOutput` covers them.

const epochs = { account: 1, workspace: 2, target: 3, policy: 4 };
const definition: ToolDefinition = {
  schemaVersion: '2.0',
  name: 'workspace.browser',
  version: '2.0.0',
  description: 'Observe a page.',
  operations: ['observe'],
  riskClasses: ['browser'],
  targetIds: ['target:browser'],
  inputSchema: {
    type: 'object',
    additionalProperties: false,
    properties: { sessionId: { type: 'string' } },
  },
};
const invocation: ToolInvocation = {
  schemaVersion: '2.0',
  invocationId: 'inv_01JZZZZZZZZZZZZZZZZZZZZZZZ',
  runId: 'run_01JZZZZZZZZZZZZZZZZZZZZZZZ',
  turnId: 'turn_01JZZZZZZZZZZZZZZZZZZZZZZ',
  toolName: definition.name,
  toolVersion: definition.version,
  operation: 'observe',
  arguments: { sessionId: 'session-1' },
  targetId: 'target:browser',
  epochs,
  idempotencyKey: 'idem_01JZZZZZZZZZZZZZZZZZZZZZZ',
  requestedAt: '2026-09-30T08:00:00.000Z',
};
const base = {
  invocation,
  receiptId: 'receipt_01JZZZZZZZZZZZZZZZZZZZZZ',
  startedAt: '2026-09-30T08:00:01.000Z',
  completedAt: '2026-09-30T08:00:02.000Z',
  continuation: { action: 'final' as const },
  maxOutputBytes: 2_048,
  status: 'succeeded' as const,
  structured: { observed: true },
};
const sha256 = (value: string): string =>
  `sha256:${createHash('sha256').update(value).digest('hex')}`;

describe('runtime tool result fileIds', () => {
  it('hashes and counts the ids with the output, as the backend does', () => {
    const result = buildRuntimeToolResult({ ...base, fileIds: ['shot-1'] });
    const canonical = canonicalJson({
      error: null,
      modelText: null,
      structured: { observed: true },
      fileIds: ['shot-1'],
    });

    expect(result.fileIds).toEqual(['shot-1']);
    expect(result.receipt.resultHash).toBe(sha256(canonical));
    expect(result.receipt.outputBytes).toBe(new TextEncoder().encode(canonical).byteLength);
  });

  it('leaves a result without ids hashed exactly as before', () => {
    const result = buildRuntimeToolResult(base);
    const canonical = canonicalJson({
      error: null,
      modelText: null,
      structured: { observed: true },
    });

    expect(result).not.toHaveProperty('fileIds');
    expect(result.receipt.resultHash).toBe(sha256(canonical));
    expect(result.receipt.outputBytes).toBe(new TextEncoder().encode(canonical).byteLength);
  });

  it('rejects too many, empty or duplicate ids in the contract', () => {
    const valid = buildRuntimeToolResult({ ...base, fileIds: ['shot-1'] });
    const tooMany = Array.from(
      { length: MAX_TOOL_RESULT_FILE_IDS + 1 },
      (_entry, index) => `shot-${String(index)}`,
    );
    for (const fileIds of [tooMany, [], [''], ['shot-1', 'shot-1']]) {
      expect(() => parseToolResult({ ...valid, fileIds })).toThrow();
    }
  });
});

function dispatcherFor(output: RuntimeToolExecutionOutput): RuntimeToolDispatcher {
  let now = 1_000;
  return new RuntimeToolDispatcher({
    runId: invocation.runId,
    turnId: invocation.turnId,
    epochs,
    definitions: [definition],
    budget: {
      maxModelTurns: 4,
      maxToolCalls: 2,
      maxToolRounds: 2,
      maxRepairAttempts: 1,
      maxRuntimeMs: 10_000,
      maxOutputBytes: 262_144,
      maxToolResultBytes: 262_144,
    },
    startedAtMs: now,
    currentEpochs: () => epochs,
    policy: {
      evaluate: async () =>
        Promise.resolve({ decision: 'allow', code: 'ALLOW', message: 'Allowed.' }),
    },
    executor: { execute: async () => Promise.resolve(output) },
    now: () => {
      now += 10;
      return now;
    },
    receiptId: () => 'receipt_01JZZZZZZZZZZZZZZZZZZZZZ',
  });
}

describe('runtime tool dispatcher fileIds', () => {
  it('carries executor fileIds into the result', async () => {
    const dispatcher = dispatcherFor({ structured: { observed: true }, fileIds: ['shot-1'] });

    const result = await dispatcher.dispatch(invocation, { action: 'final' });

    expect(result).toMatchObject({ status: 'succeeded', fileIds: ['shot-1'] });
  });

  it('fails an executor output with too many fileIds as invalid output', async () => {
    const fileIds = Array.from(
      { length: MAX_TOOL_RESULT_FILE_IDS + 1 },
      (_entry, index) => `shot-${String(index)}`,
    );
    const dispatcher = dispatcherFor({ structured: { observed: true }, fileIds });

    const result = await dispatcher.dispatch(invocation, { action: 'final' });

    expect(result).toMatchObject({ status: 'failed', error: { code: 'TOOL_OUTPUT_INVALID' } });
    expect(result).not.toHaveProperty('fileIds');
  });
});
