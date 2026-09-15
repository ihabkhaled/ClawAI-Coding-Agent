import { describe, expect, it } from 'vitest';

import {
  statusLineActivity,
  statusLineModel,
  statusLineQueueDepth,
} from '../../src/core/status-line';

import type { ExtensionSnapshot } from '../../src/core/extension-state';

function pendingRequest(id: string) {
  return {
    concurrencyKey: 'thread-1',
    id,
    kind: 'agent' as const,
    modelLabel: 'AUTO',
    prompt: 'p',
  };
}

function snapshot(overrides: Partial<ExtensionSnapshot> = {}): ExtensionSnapshot {
  return {
    connected: true,
    backendStatus: 'connected',
    busy: false,
    approvalRequest: undefined,
    questionRequest: undefined,
    generationQueue: { active: [], capacity: 2, pending: [] },
    routingMode: 'AUTO',
    models: [],
    selectedModel: '',
    ...overrides,
  } as ExtensionSnapshot;
}

describe('statusLineActivity', () => {
  it('says disconnected before anything else', () => {
    expect(statusLineActivity(snapshot({ connected: false, backendStatus: 'disconnected' }))).toBe(
      'disconnected',
    );
  });

  it('distinguishes connecting from disconnected', () => {
    expect(statusLineActivity(snapshot({ connected: false, backendStatus: 'loading' }))).toBe(
      'connecting',
    );
  });

  it('puts a waiting question above work in flight', () => {
    const waiting = snapshot({
      busy: true,
      questionRequest: { id: 'q1' } as ExtensionSnapshot['questionRequest'],
    });

    expect(statusLineActivity(waiting)).toBe('awaiting-you');
  });

  it('puts a waiting approval above work in flight', () => {
    const waiting = snapshot({
      busy: true,
      approvalRequest: { id: 'a1' } as ExtensionSnapshot['approvalRequest'],
    });

    expect(statusLineActivity(waiting)).toBe('awaiting-you');
  });

  it('reports running work', () => {
    expect(statusLineActivity(snapshot({ busy: true }))).toBe('running');
  });

  it('reports queued work when nothing is running yet', () => {
    const queued = snapshot({
      generationQueue: { active: [], capacity: 2, pending: [pendingRequest('r1')] },
    });

    expect(statusLineActivity(queued)).toBe('queued');
  });

  it('is idle when there is nothing to say', () => {
    expect(statusLineActivity(snapshot())).toBe('idle');
  });
});

describe('statusLineModel', () => {
  it('reports automatic routing as automatic rather than naming last time’s model', () => {
    expect(statusLineModel(snapshot({ routingMode: 'AUTO', selectedModel: 'X' }))).toEqual({
      automatic: true,
    });
  });

  it('names the chosen model', () => {
    const manual = snapshot({
      routingMode: 'MANUAL_MODEL',
      selectedModel: 'ANTHROPIC:sonnet',
      models: [{ key: 'ANTHROPIC:sonnet', displayName: 'Claude Sonnet' }],
    } as Partial<ExtensionSnapshot>);

    expect(statusLineModel(manual)).toEqual({ automatic: false, name: 'Claude Sonnet' });
  });

  it('falls back to the key when the catalog has not caught up', () => {
    const manual = snapshot({ routingMode: 'MANUAL_MODEL', selectedModel: 'NEW:model' });

    expect(statusLineModel(manual)).toEqual({ automatic: false, name: 'NEW:model' });
  });

  it('reports automatic when manual mode has nothing chosen yet', () => {
    expect(statusLineModel(snapshot({ routingMode: 'MANUAL_MODEL' }))).toEqual({ automatic: true });
  });
});

describe('statusLineQueueDepth', () => {
  it('counts what is waiting behind the current request', () => {
    const queued = snapshot({
      generationQueue: {
        active: [{ ...pendingRequest('r0'), startedAt: 1 }],
        capacity: 2,
        pending: [pendingRequest('r1'), pendingRequest('r2')],
      },
    });

    expect(statusLineQueueDepth(queued)).toBe(2);
  });

  it('is zero when nothing is waiting', () => {
    expect(statusLineQueueDepth(snapshot())).toBe(0);
  });
});
