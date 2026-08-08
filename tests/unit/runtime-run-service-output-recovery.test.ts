import { describe, expect, it, vi } from 'vitest';

import {
  parseToolResult,
  type ToolDefinition,
  type ToolInvocation,
  type ToolResult,
} from '../../src/core/runtime/runtime-tool-contracts';
import { RuntimeRunService } from '../../src/services/runtime-run-service';

import type { RuntimeToolExecutionOutput } from '../../src/services/runtime-tool-dispatcher';

const epochs = { account: 1, workspace: 2, target: 3, policy: 4 };
const definition: ToolDefinition = {
  schemaVersion: '2.0',
  name: 'workspace.files',
  version: '1.0',
  description: 'Find bounded workspace paths.',
  operations: ['glob'],
  riskClasses: ['inspect'],
  targetIds: ['target:workspace'],
  inputSchema: {
    type: 'object',
    additionalProperties: false,
    properties: { pattern: { type: 'string' } },
  },
};
const start = {
  budget: {
    maxModelTurns: 2,
    maxOutputBytes: 4_096,
    maxRepairAttempts: 1,
    maxRuntimeMs: 10_000,
    maxToolCalls: 2,
    maxToolResultBytes: 2_048,
    maxToolRounds: 2,
  },
  definitions: [definition],
  epochs,
  threadId: 'thread_output_recovery',
  clientRequestId: 'request_output_recovery',
  idempotencyKey: 'start_output_recovery',
  prompt: 'Find the relevant files.',
  manifestHash: `sha256:${'1'.repeat(64)}`,
  toolCatalogHash: `sha256:${'2'.repeat(64)}`,
  provider: 'fixture',
  model: 'fixture-model',
  runId: 'run_output_recovery',
  turnId: 'turn_output_initial',
};
const invocation: ToolInvocation = {
  schemaVersion: '2.0',
  invocationId: 'inv_output_oversized',
  runId: start.runId,
  turnId: start.turnId,
  toolName: definition.name,
  toolVersion: definition.version,
  operation: 'glob',
  arguments: { pattern: '**/*.ts' },
  targetId: 'target:workspace',
  epochs,
  idempotencyKey: 'idem_output_oversized',
  requestedAt: '2026-08-08T16:07:37.239Z',
};

describe('RuntimeRunService invalid executor output recovery', () => {
  it('submits a canonical failure, stays active, and submits the corrected next turn', async () => {
    let execution = 0;
    const execute = vi.fn(async (): Promise<RuntimeToolExecutionOutput> => {
      execution += 1;
      return execution === 1
        ? {
            structured: {
              paths: Array.from({ length: 101 }, (_entry, index) => `src/file-${String(index)}.ts`),
              truncated: false,
            },
          }
        : {
            modelText: 'Found one path.',
            structured: { paths: ['src/index.ts'], truncated: false },
          };
    });
    const submitted: ToolResult[] = [];
    let now = 1_000;
    let receipt = 0;
    const service = new RuntimeRunService({
      clock: {
        now: () => {
          now += 10;
          return now;
        },
      },
      currentEpochs: () => epochs,
      eventSink: { publishBatch: () => undefined },
      executor: { execute },
      policy: {
        evaluate: async () => ({ code: 'ALLOW', decision: 'allow', message: 'Allowed.' }),
      },
      receiptId: () => `receipt_output_${String(++receipt)}`,
      transport: {
        cancel: async () => undefined,
        start: async (input) => ({ runId: input.runId }),
        submitResult: async (_runId, result) => {
          submitted.push(result);
        },
      },
    });
    await service.start(start);

    const continuation = { action: 'continue' as const, nextTurnId: 'turn_output_corrected' };
    const failed = await service.dispatch(invocation, continuation);

    expect(failed).toMatchObject({
      schemaVersion: '2.0',
      invocationId: invocation.invocationId,
      status: 'failed',
      error: { code: 'TOOL_OUTPUT_INVALID', retryable: false },
      continuation,
      receipt: {
        schemaVersion: '2.0',
        invocationId: invocation.invocationId,
        truncated: false,
      },
    });
    expect(failed).not.toHaveProperty('structured');
    expect(parseToolResult(failed)).toEqual(failed);
    expect(Object.isFrozen(failed)).toBe(true);
    expect(submitted).toEqual([failed]);
    expect(service.hasActiveRun()).toBe(true);

    service.beginModelTurn(false, continuation.nextTurnId);
    const corrected = await service.dispatch(
      {
        ...invocation,
        invocationId: 'inv_output_corrected',
        idempotencyKey: 'idem_output_corrected',
        turnId: continuation.nextTurnId,
      },
      { action: 'final' },
    );

    expect(corrected).toMatchObject({
      status: 'succeeded',
      structured: { paths: ['src/index.ts'], truncated: false },
    });
    expect(parseToolResult(corrected)).toEqual(corrected);
    expect(submitted).toEqual([failed, corrected]);
    expect(execute).toHaveBeenCalledTimes(2);
    expect(service.hasActiveRun()).toBe(false);
  });
});
