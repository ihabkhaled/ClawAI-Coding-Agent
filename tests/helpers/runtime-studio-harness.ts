import { createHash } from 'node:crypto';

import { executeRuntimeStudio } from '../../src/services/runtime-studio-execution';

import type { AgentMode } from '../../src/core/agent-mode.types';
import type { EffortMode } from '../../src/core/effort-mode';
import type { RunBudget } from '../../src/core/runtime/runtime-tool-contracts';
import type { RuntimeRunStart } from '../../src/services/runtime-run-service';

/** The journal schema accepts only `sha256:<64 hex>`. */
function digest(value: string): string {
  return `sha256:${createHash('sha256').update(value, 'utf8').digest('hex')}`;
}

export interface Capture {
  readonly starts: RuntimeRunStart[];
  readonly journals: { budget: RunBudget; policySnapshotHash: string; goal: string }[];
  readonly traces: Record<string, unknown>[];
}

/**
 * The studio builds its own RuntimeRunService, so the transport is the seam
 * where the budget becomes observable — it is the value the backend is asked
 * to admit and the value the tool dispatcher enforces.
 */
export function studioHarness(
  effortMode: EffortMode,
  agentMode: AgentMode = 'AUTO',
): { capture: Capture; run: () => Promise<void> } {
  const capture: Capture = { starts: [], journals: [], traces: [] };
  const manifest = { capabilities: [] } as never;
  const dependencies = {
    input: {
      prompt: 'add a test',
      threadId: 'thread-1',
      requestId: '5b1d0f0e-6b0a-4a1e-9c1a-2f3d4e5a6b7c',
      signal: new AbortController().signal,
      onEvent: () => undefined,
    },
    manifest,
    epochs: { account: 1, workspace: 1, target: 1, policy: 1 } as never,
    router: { definitions: () => [] },
    policy: {} as never,
    transport: {
      cancel: async () => undefined,
      start: async (start: RuntimeRunStart) => {
        capture.starts.push(start);
        return { runId: 'runtime:captured' };
      },
      submitResult: async () => undefined,
    } as never,
    stream: { follow: async () => undefined } as never,
    observability: {
      emit: (trace: Record<string, unknown>) => {
        capture.traces.push(trace);
      },
    } as never,
    journals: {
      save: async (candidate: { budget: RunBudget; policySnapshotHash: string; goal: string }) => {
        capture.journals.push(candidate);
      },
    } as never,
    flagship: { steerIfActive: () => undefined } as never,
    state: { applyRuntimeEvent: () => undefined } as never,
    configuration: () => ({ effortMode, agentMode, permissionMode: 'ASK' }) as never,
    targetRouter: () => ({}) as never,
    fingerprint: async () => ({
      account: digest('account'),
      workspace: digest('workspace'),
      target: digest('target'),
      policy: digest('policy'),
      files: digest('files'),
      gitHead: digest('gitHead'),
    }),
    hash: (value: unknown) => digest(JSON.stringify(value)),
    setActive: () => undefined,
    releaseApprovals: () => undefined,
  };
  return { capture, run: () => executeRuntimeStudio(dependencies as never) };
}
