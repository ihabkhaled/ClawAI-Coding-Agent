import { describe, expect, it } from 'vitest';

import {
  createRuntimeSnapshot,
  reduceRuntimeEvent,
} from '../../src/core/runtime/runtime-event-reducer';
import { parseRuntimeEvent } from '../../src/core/runtime/runtime-protocol.schemas';
import { toPublicChatState, toPublicRuntimeState } from '../../src/webview/chat-public-state';

import type { ExtensionSnapshot } from '../../src/core/extension-state';

function requireDefined<T>(value: T | undefined): T {
  if (value === undefined) throw new Error('Expected test projection to be defined');
  return value;
}

const snapshot: ExtensionSnapshot = {
  agentRun: {
    files: [{ operation: 'update', path: 'src/app.ts' }],
    phase: 'reviewing',
    summary: 'Update the app',
  },
  agentRuns: {
    'request-1': {
      files: [{ operation: 'update', path: 'src/app.ts' }],
      phase: 'reviewing',
      summary: 'Update the app',
    },
  },
  agentMode: 'PLAN',
  effortMode: 'ULTRA',
  approvalRequest: undefined,
  backendStatus: 'connected',
  backendUrl: 'https://claw.local',
  busy: false,
  connected: true,
  generationQueue: {
    active: [
      {
        concurrencyKey: 'chat-a',
        id: 'request-1',
        kind: 'agent',
        modelLabel: 'Claude Sonnet',
        prompt: 'Create a file',
        startedAt: 1,
      },
    ],
    capacity: 2,
    pending: [
      {
        concurrencyKey: 'chat-a',
        id: 'request-2',
        kind: 'chat',
        modelLabel: 'Qwen 3',
        prompt: 'Explain the result',
      },
    ],
  },
  contextReceipt: {
    excluded: [{ path: '.env', reason: 'sensitive' }],
    included: ['src/app.ts'],
    totalBytes: 42,
    truncated: false,
  },
  entitlements: undefined,
  history: [
    {
      _count: { messages: 3 },
      createdAt: new Date('2026-07-29T10:00:00.000Z'),
      id: 'thread-1',
      preferredModel: 'secret-model-choice',
      preferredProvider: 'SECRET_PROVIDER',
      routingMode: 'MANUAL_MODEL',
      title: 'Create loop file',
      updatedAt: '2026-07-29T10:05:00.000Z',
    },
  ],
  lastError: undefined,
  models: [],
  modelWarnings: ['Ollama is unavailable'],
  permissionMode: 'MANUAL',
  routingMode: 'AUTO',
  runtime: createRuntimeSnapshot(),
  selectedModel: '',
  usage: undefined,
  user: undefined,
  workspaceReadiness: {
    hasActiveFile: false,
    hasSelection: false,
    hasWorkspace: true,
    trusted: true,
    workspaceName: 'ClawAI',
  },
  workspaceScope: {
    folders: [
      { key: 'api-key', name: 'api' },
      { key: 'web-key', name: 'web' },
    ],
    selectedFolderKey: 'web-key',
    selectedFolderName: 'web',
  },
};

describe('toPublicChatState', () => {
  it('allow-lists bounded runtime metadata without raw timeline or capability data', () => {
    const created = reduceRuntimeEvent(
      createRuntimeSnapshot(),
      parseRuntimeEvent({
        schemaVersion: '2.0',
        eventId: 'event-id-0001',
        runId: 'run-id-0001',
        sequence: 0,
        timestamp: '2026-08-02T10:00:00.000Z',
        type: 'run.created',
        visibility: 'user',
        sensitivity: 'workspace',
        epochs: { account: 1, workspace: 2, target: 3, policy: 4 },
        payload: {},
      }),
    );
    const requested = reduceRuntimeEvent(
      created,
      parseRuntimeEvent({
        schemaVersion: '2.0',
        eventId: 'event-id-0002',
        runId: 'run-id-0001',
        sequence: 1,
        timestamp: '2026-08-02T10:00:01.000Z',
        type: 'tool.requested',
        visibility: 'user',
        sensitivity: 'workspace',
        epochs: { account: 1, workspace: 2, target: 3, policy: 4 },
        payload: {
          invocationId: 'invocation-id-0001',
          operation: 'read',
          toolName: 'fixture.workspace-summary',
        },
      }),
    );
    const started = reduceRuntimeEvent(
      requested,
      parseRuntimeEvent({
        schemaVersion: '2.0',
        eventId: 'event-id-0003',
        runId: 'run-id-0001',
        sequence: 2,
        timestamp: '2026-08-02T10:00:02.000Z',
        type: 'tool.started',
        visibility: 'user',
        sensitivity: 'workspace',
        epochs: { account: 1, workspace: 2, target: 3, policy: 4 },
        payload: { invocationId: 'invocation-id-0001' },
      }),
    );
    const runtime = reduceRuntimeEvent(
      started,
      parseRuntimeEvent({
        schemaVersion: '2.0',
        eventId: 'event-id-0004',
        runId: 'run-id-0001',
        sequence: 3,
        timestamp: '2026-08-02T10:00:03.000Z',
        type: 'tool.completed',
        visibility: 'user',
        sensitivity: 'workspace',
        epochs: { account: 1, workspace: 2, target: 3, policy: 4 },
        payload: {
          invocationId: 'invocation-id-0001',
          status: 'succeeded',
          receipt: {
            receiptId: 'receipt-id-0001',
            durationMs: 12,
            outputBytes: 42,
            truncated: false,
            redactionApplied: true,
          },
        },
      }),
    );

    const publicRuntime = toPublicRuntimeState(runtime);
    expect(publicRuntime).toMatchObject({
      activeRunId: 'run-id-0001',
      runs: {
        'run-id-0001': {
          invocations: {
            'invocation-id-0001': { receipt: { outputBytes: 42 }, status: 'succeeded' },
          },
        },
      },
    });
    const serialized = JSON.stringify(publicRuntime);
    expect(serialized).not.toContain('capabilityManifest');
    expect(serialized).not.toContain('timeline');
    expect(serialized).not.toContain('arguments');
    expect(serialized).not.toContain('resultHash');

    const publicInvocation = publicRuntime.runs['run-id-0001']?.invocations['invocation-id-0001'];
    const sourceInvocation = runtime.runs['run-id-0001']?.invocations['invocation-id-0001'];
    expect(publicInvocation).not.toBe(sourceInvocation);
    expect(publicInvocation?.receipt).not.toBe(sourceInvocation?.receipt);
    if (publicInvocation?.receipt !== undefined) {
      Reflect.set(publicInvocation.receipt, 'outputBytes', 0);
      expect(sourceInvocation?.receipt?.outputBytes).toBe(42);
    }
  });

  it('rebuilds budget, turn, invocation, and steering projections without nested aliases', () => {
    const baseEvent = {
      schemaVersion: '2.0' as const,
      runId: 'run-id-0001',
      visibility: 'user' as const,
      sensitivity: 'workspace' as const,
      epochs: { account: 1, workspace: 2, target: 3, policy: 4 },
    };
    const reduce = (
      runtime: ReturnType<typeof createRuntimeSnapshot>,
      sequence: number,
      type: string,
      payload: Record<string, unknown>,
      turnId?: string,
    ) =>
      reduceRuntimeEvent(
        runtime,
        parseRuntimeEvent({
          ...baseEvent,
          eventId: `event-id-${String(sequence).padStart(4, '0')}`,
          sequence,
          timestamp: new Date(Date.UTC(2026, 7, 2, 10, 0, sequence)).toISOString(),
          type,
          payload,
          ...(turnId === undefined ? {} : { turnId }),
        }),
      );
    let runtime = reduce(createRuntimeSnapshot(), 0, 'run.created', {});
    runtime = reduce(runtime, 1, 'run.budget.updated', {
      limits: {
        maxModelTurns: 2,
        maxOutputBytes: 4_096,
        maxRepairAttempts: 1,
        maxRuntimeMs: 10_000,
        maxToolCalls: 2,
        maxToolResultBytes: 2_048,
        maxToolRounds: 2,
      },
      usage: {
        modelTurns: 1,
        outputBytes: 0,
        repairAttempts: 0,
        toolCalls: 1,
        toolResultBytes: 0,
        toolRounds: 1,
      },
    });
    runtime = reduce(runtime, 2, 'model.turn.started', { turnId: 'turn-id-0001' }, 'turn-id-0001');
    runtime = reduce(
      runtime,
      3,
      'model.summary',
      { summary: 'Safe summary.', turnId: 'turn-id-0001' },
      'turn-id-0001',
    );
    runtime = reduce(runtime, 4, 'tool.requested', {
      invocationId: 'invocation-id-0001',
      operation: 'read',
      toolName: 'fixture.workspace-summary',
    });
    runtime = reduce(runtime, 5, 'run.steering.received', {
      sequence: 0,
      steeringId: 'steering-id-0001',
    });
    runtime = reduce(runtime, 6, 'run.steering.rejected', {
      reason: 'stale-epochs',
      sequence: 1,
      steeringId: 'steering-id-0002',
    });

    const publicRuntime = toPublicRuntimeState(runtime);
    const publicRun = requireDefined(publicRuntime.runs['run-id-0001']);
    const sourceRun = requireDefined(runtime.runs['run-id-0001']);
    const publicBudget = requireDefined(publicRun.budget);
    const sourceBudget = requireDefined(sourceRun.budget);
    expect(publicRun).toMatchObject({
      budget: { usage: { modelTurns: 1 } },
      invocations: { 'invocation-id-0001': { receipt: undefined, status: 'requested' } },
      steering: {
        'steering-id-0001': { reason: undefined, status: 'received' },
        'steering-id-0002': { reason: 'stale-epochs', status: 'rejected' },
      },
      turns: { 'turn-id-0001': { summary: 'Safe summary.', textBytes: 0 } },
    });
    expect(publicBudget).not.toBe(sourceBudget);
    expect(publicBudget.limits).not.toBe(sourceBudget.limits);
    expect(publicBudget.usage).not.toBe(sourceBudget.usage);
    expect(publicRun.turns['turn-id-0001']).not.toBe(sourceRun.turns['turn-id-0001']);
    expect(publicRun.steering['steering-id-0002']).not.toBe(sourceRun.steering['steering-id-0002']);
    Reflect.set(publicBudget.usage, 'modelTurns', 0);
    Reflect.set(publicBudget.limits, 'maxModelTurns', 99);
    Reflect.set(requireDefined(publicRun.turns['turn-id-0001']), 'summary', 'Changed.');
    Reflect.set(requireDefined(publicRun.steering['steering-id-0002']), 'reason', 'run-terminal');
    expect(sourceBudget.usage.modelTurns).toBe(1);
    expect(sourceBudget.limits.maxModelTurns).toBe(2);
    expect(sourceRun.turns['turn-id-0001']?.summary).toBe('Safe summary.');
    expect(sourceRun.steering['steering-id-0002']?.reason).toBe('stale-epochs');
  });

  it('exposes the workbench state and sanitized conversation history needed by the webview', () => {
    expect(toPublicChatState(snapshot)).toMatchObject({
      agentRun: {
        files: [{ operation: 'update', path: 'src/app.ts' }],
        phase: 'reviewing',
      },
      agentMode: 'PLAN',
      effortMode: 'ULTRA',
      backendStatus: 'connected',
      history: [
        {
          createdAt: '2026-07-29T10:00:00.000Z',
          id: 'thread-1',
          messageCount: 3,
          title: 'Create loop file',
          updatedAt: '2026-07-29T10:05:00.000Z',
        },
      ],
      modelWarnings: ['Ollama is unavailable'],
      permissionMode: 'MANUAL',
      workspaceReadiness: {
        hasActiveFile: false,
        hasWorkspace: true,
        trusted: true,
        workspaceName: 'ClawAI',
      },
      workspaceScope: {
        folders: [
          { key: 'api-key', name: 'api' },
          { key: 'web-key', name: 'web' },
        ],
        selectedFolderKey: 'web-key',
      },
    });
    expect(toPublicChatState(snapshot).history[0]).not.toHaveProperty('preferredProvider');
    expect(toPublicChatState(snapshot).history[0]).not.toHaveProperty('preferredModel');
  });

  it('normalizes absent history dates, blank titles, and defined entitlements', () => {
    const publicState = toPublicChatState({
      ...snapshot,
      entitlements: {
        allowedModels: [],
        allowedProviders: [],
        features: [],
        isAdmin: true,
        permissions: [],
        plan: null,
        quota: { dailyLimit: 0, remaining: 0, unlimited: true, used: 0 },
        role: 'admin',
        userId: 'user-id-0001',
      },
      history: [{ id: 'thread-blank', title: '   ' }],
    });

    expect(publicState.history).toEqual([
      {
        createdAt: undefined,
        id: 'thread-blank',
        messageCount: 0,
        title: 'Untitled conversation',
        updatedAt: undefined,
      },
    ]);
    expect(publicState.entitlements).toMatchObject({ isAdmin: true, plan: null });
  });
});
