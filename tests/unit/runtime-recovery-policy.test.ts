import { describe, expect, it } from 'vitest';

import {
  affectedReplanTaskIds,
  classifyRuntimeFailure,
} from '../../src/services/runtime-recovery-policy';

import type { RuntimeRecoveryRecord } from '../../src/services/runtime-recovery-policy';

function history(...classes: readonly string[]): RuntimeRecoveryRecord[] {
  return classes.map((failureClass) => ({
    failureClass: failureClass as RuntimeRecoveryRecord['failureClass'],
    strategy: 'retry-same' as const,
    reason: 'prior attempt',
  }));
}

describe('classifyRuntimeFailure', () => {
  it.each([
    {
      label: 'malformed tool output',
      blocker: 'Nested runtime failed: bad JSON (MODEL_TOOL_REQUEST_UNREPAIRABLE)',
      failureClass: 'malformed-tool-output',
      strategy: 'retry-constrained',
    },
    {
      label: 'empty provider response',
      blocker: 'Nested runtime failed: no content (CLOUD_PROVIDER_EMPTY_RESPONSE)',
      failureClass: 'empty-response',
      strategy: 'retry-same',
    },
    {
      label: 'runtime budget timeout',
      blocker: 'Sub-agent runtime budget exhausted',
      failureClass: 'timeout',
      strategy: 'retry-constrained',
    },
    {
      label: 'discovery loop',
      blocker: 'Nested runtime failed: run scope exceeded its discovery allowance',
      failureClass: 'discovery-loop',
      strategy: 'retry-constrained',
    },
    {
      label: 'acceptance gate failure',
      blocker: 'Mandatory gate project:unit:0 failed',
      failureClass: 'gate-failure',
      strategy: 'replan',
    },
  ])(
    'classifies $label and opens the ladder at $strategy',
    ({ blocker, failureClass, strategy }) => {
      expect(classifyRuntimeFailure({ blocker, thrown: false, mutating: true }, [])).toMatchObject({
        failureClass,
        strategy,
      });
    },
  );

  it('never replays an ambiguous mutation, whatever the ladder would otherwise allow', () => {
    expect(
      classifyRuntimeFailure({ blocker: 'response lost', thrown: true, mutating: true }, []),
    ).toMatchObject({ failureClass: 'ambiguous-mutation', strategy: 'abandon' });
  });

  it('retries a thrown failure when the task cannot have mutated anything', () => {
    expect(
      classifyRuntimeFailure({ blocker: 'response lost', thrown: true, mutating: false }, []),
    ).toMatchObject({ strategy: 'retry-same' });
  });

  it('escalates a repeating hypothesis instead of repeating it forever', () => {
    const context = {
      blocker: 'Nested runtime failed: bad JSON (MODEL_TOOL_REQUEST_UNREPAIRABLE)',
      thrown: false,
      mutating: true,
    };

    expect(classifyRuntimeFailure(context, history('malformed-tool-output'))).toMatchObject({
      strategy: 'retry-fallback-model',
    });
    expect(
      classifyRuntimeFailure(context, history('malformed-tool-output', 'malformed-tool-output')),
    ).toMatchObject({ strategy: 'replan' });
    expect(
      classifyRuntimeFailure(
        context,
        history('malformed-tool-output', 'malformed-tool-output', 'malformed-tool-output'),
      ),
    ).toMatchObject({ strategy: 'abandon' });
  });

  it.each([
    { blocker: 'Nested runtime failed: runtime output exceeded max bytes', expected: 'unknown' },
    { blocker: 'Nested runtime failed: runtime outage detected', expected: 'unknown' },
    { blocker: 'Quality gates failed', expected: 'gate-failure' },
    { blocker: 'Mandatory gates project:unit:0 failed', expected: 'gate-failure' },
    { blocker: 'Acceptance check failed: the build timed out', expected: 'gate-failure' },
    { blocker: 'Connection to the gateway was refused', expected: 'unknown' },
    { blocker: 'Failed to propagate the change', expected: 'unknown' },
  ])('does not misclassify $blocker', ({ blocker, expected }) => {
    expect(classifyRuntimeFailure({ blocker, thrown: false, mutating: true }, [])).toMatchObject({
      failureClass: expected,
    });
  });

  it('counts only the same hypothesis toward that hypothesis ladder', () => {
    expect(
      classifyRuntimeFailure(
        {
          blocker: 'Nested runtime failed: bad JSON (MODEL_TOOL_REQUEST_UNREPAIRABLE)',
          thrown: false,
          mutating: true,
        },
        history('empty-response', 'timeout'),
      ),
    ).toMatchObject({ strategy: 'retry-constrained' });
  });
});

describe('affectedReplanTaskIds', () => {
  const graph = [
    { taskId: 'api', dependencies: [] },
    { taskId: 'ui', dependencies: [] },
    { taskId: 'wire', dependencies: ['api', 'ui'] },
    { taskId: 'docs', dependencies: ['wire'] },
  ];

  it('replans a failed node and everything downstream of it', () => {
    expect([...affectedReplanTaskIds(graph, ['api'])].sort()).toEqual(['api', 'docs', 'wire']);
  });

  it('retains independent successes outside the failed subtree', () => {
    expect(affectedReplanTaskIds(graph, ['api'])).not.toContain('ui');
  });

  it('returns nothing when no task failed', () => {
    expect(affectedReplanTaskIds(graph, [])).toEqual([]);
  });

  it('tolerates a failed identity that is not in the graph', () => {
    expect(affectedReplanTaskIds(graph, ['absent'])).toEqual([]);
  });
});
