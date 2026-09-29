import { describe, expect, it, vi } from 'vitest';

vi.mock('vscode', () => ({
  l10n: {
    t: (message: string) => message,
  },
}));

import { createRuntimeSnapshot } from '../../src/core/runtime/runtime-event-reducer';
import { ZERO_RETENTION_OFF } from '../../src/core/zero-retention.constants';
import { retentionTooltip, statusBarText } from '../../src/views/status-bar-controller';

import type { ExtensionSnapshot } from '../../src/core/extension-state';

function snapshot(patch: Partial<ExtensionSnapshot> = {}): ExtensionSnapshot {
  return {
    agentMode: 'AUTO',
    viewDensity: 'full',
    effortMode: 'ULTRA',
    speedMode: '1X',
    agentRun: undefined,
    agentRuns: {},
    approvalRequest: undefined,
    questionRequest: undefined,
    findings: [],
    tasks: [],
    artifacts: [],
    organizationPolicy: undefined,
    backendStatus: 'disconnected',
    backendUrl: 'https://claw.local',
    busy: false,
    connected: false,
    contextReceipt: undefined,
    entitlements: undefined,
    generationQueue: { active: [], capacity: 2, pending: [] },
    history: [],
    lastError: undefined,
    models: [],
    modelWarnings: [],
    permissionMode: 'MANUAL',
    routingMode: 'AUTO',
    runtime: createRuntimeSnapshot(),
    selectedModel: '',
    usage: undefined,
    user: undefined,
    workspaceReadiness: undefined,
    workspaceScope: { folders: [] },
    ...patch,
  };
}

describe('zero data retention in the status line', () => {
  it('says nothing about retention while it is normal', () => {
    expect(statusBarText(snapshot())).not.toContain('Zero retention');
    expect(statusBarText(snapshot(), ZERO_RETENTION_OFF)).not.toContain('Zero retention');
    expect(retentionTooltip(ZERO_RETENTION_OFF)).toBe('');
  });

  it('marks the status line when disconnected and when connected', () => {
    const on = { active: true, source: 'setting' } as const;
    expect(statusBarText(snapshot(), on)).toContain('$(shield) Zero retention');
    expect(statusBarText(snapshot({ backendStatus: 'connected', connected: true }), on)).toContain(
      '$(shield) Zero retention',
    );
  });

  it('says in the tooltip when the organization requires it', () => {
    expect(retentionTooltip({ active: true, source: 'setting' })).toBe('Zero data retention: on');
    expect(retentionTooltip({ active: true, source: 'organization' })).toContain(
      'required by your organization',
    );
  });
});
