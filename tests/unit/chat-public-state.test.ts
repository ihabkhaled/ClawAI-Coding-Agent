import { describe, expect, it } from 'vitest';

import {
  createRuntimeSnapshot,
  reduceRuntimeEvent,
} from '../../src/core/runtime/runtime-event-reducer';
import { parseRuntimeEvent } from '../../src/core/runtime/runtime-protocol.schemas';
import { toPublicChatState, toPublicRuntimeState } from '../../src/webview/chat-public-state';

import type { ExtensionSnapshot } from '../../src/core/extension-state';

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
    const runtime = reduceRuntimeEvent(
      reduceRuntimeEvent(
        reduceRuntimeEvent(
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
        ),
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
      ),
      parseRuntimeEvent({
        schemaVersion: '2.0',
        eventId: 'event-id-0003',
        runId: 'run-id-0001',
        sequence: 2,
        timestamp: '2026-08-02T10:00:02.000Z',
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
  });

  it('exposes the workbench state and sanitized conversation history needed by the webview', () => {
    expect(toPublicChatState(snapshot)).toMatchObject({
      agentRun: {
        files: [{ operation: 'update', path: 'src/app.ts' }],
        phase: 'reviewing',
      },
      agentMode: 'PLAN',
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
});
