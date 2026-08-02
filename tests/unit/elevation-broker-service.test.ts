import { realpath } from 'node:fs/promises';

import { describe, expect, it, vi } from 'vitest';

import { elevationDigest } from '../../src/core/elevation-contract';
import { ElevationBrokerService } from '../../src/services/elevation-broker-service';

import type { ElevationEnvelope } from '../../src/core/elevation-contract';

const workspaceRoot = process.cwd();
const command = {
  executable: process.execPath,
  arguments: ['--version'],
  cwdRootKey: 'workspace-root',
  cwd: '.',
  environment: {},
  timeoutMs: 10_000,
  outputLimitBytes: 4_096,
  expectedEffect: 'local-mutation' as const,
  targetId: 'target:workspace',
  elevation: true,
};
const verification = {
  ...command,
  expectedEffect: 'read' as const,
  elevation: false,
};

describe('ElevationBrokerService', () => {
  it('binds a one-shot native receipt and requires read-only post-verification', async () => {
    const native = nativePort();
    const verify = vi.fn(async () => ({
      executablePath: process.execPath,
      executableHash: `sha256:${'0'.repeat(64)}`,
      stdout: '',
      stderr: '',
      exitCode: 0,
      signal: null,
      startedAt: '2026-08-02T12:00:00.000Z',
      durationMs: 1,
      timedOut: false,
      cancelled: false,
      truncated: false,
    }));
    const broker = new ElevationBrokerService(
      native,
      { confirm: vi.fn(async () => true) },
      { execute: verify },
      () => Date.parse('2026-08-02T12:00:00.000Z'),
    );

    const receipt = await broker.execute(
      {
        recipeId: 'permission-repair',
        command,
        explanation: 'Repair this one workspace permission.',
        verification,
      },
      {
        runId: 'runtime:elevation-test',
        workspaceId: 'workspace-root',
        workspaceRoot,
        targetId: 'target:workspace',
        parentPid: process.pid,
      },
    );

    expect(receipt.status).toBe('succeeded');
    expect(native.execute).toHaveBeenCalledWith(
      expect.objectContaining({
        argumentsHash: elevationDigest(command.arguments),
        cwd: await realpath(workspaceRoot),
        environmentHash: elevationDigest({}),
      }),
      undefined,
    );
    expect(verify).toHaveBeenCalled();
  });

  it('rejects a helper receipt that changes the approved target binding', async () => {
    const native = nativePort('target:other');
    const broker = new ElevationBrokerService(
      native,
      { confirm: async () => true },
      { execute: vi.fn() },
      () => Date.parse('2026-08-02T12:00:00.000Z'),
    );

    await expect(
      broker.execute(
        {
          recipeId: 'permission-repair',
          command,
          explanation: 'Repair this one workspace permission.',
          verification,
        },
        {
          runId: 'runtime:elevation-test',
          workspaceId: 'workspace-root',
          workspaceRoot,
          targetId: 'target:workspace',
          parentPid: process.pid,
        },
      ),
    ).rejects.toThrow(/does not match/iu);
  });
});

function nativePort(receiptTarget = 'target:workspace') {
  let request: ElevationEnvelope | undefined;
  return {
    platform: 'windows' as const,
    interactive: true,
    helperIdentity: vi.fn(async () => ({
      identity: 'helper:test',
      binaryHash: `sha256:${'1'.repeat(64)}`,
      trusted: true,
    })),
    signRequest: vi.fn(async () => 'a'.repeat(43)),
    execute: vi.fn(async (envelope: ElevationEnvelope) => {
      request = envelope;
      return {
        schemaVersion: '1',
        receiptId: 'receipt:elevation-test',
        requestId: envelope.requestId,
        nonce: envelope.nonce,
        executableHash: envelope.executableHash,
        argumentsHash: envelope.argumentsHash,
        targetId: receiptTarget,
        exitCode: 0,
        startedAt: '2026-08-02T12:00:00.000Z',
        completedAt: '2026-08-02T12:00:01.000Z',
        status: 'succeeded',
        helperIdentity: 'helper:test',
        helperSignature: 'b'.repeat(43),
      };
    }),
    verifyReceipt: vi.fn(async () => request !== undefined),
  };
}
