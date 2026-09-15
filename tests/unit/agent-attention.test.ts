import { describe, expect, it } from 'vitest';

import {
  agentAttentionQueue,
  attentionBadgeCount,
  SLOW_RUN_MS,
} from '../../src/core/agent-attention';

import type { AgentAttentionInput } from '../../src/core/agent-attention';

const NOW = 1_700_000_000_000;

function input(patch: Partial<AgentAttentionInput> = {}): AgentAttentionInput {
  return {
    approvalRequest: undefined,
    questionRequest: undefined,
    agentRuns: {},
    generationQueue: { active: [], capacity: 2, pending: [] },
    ...patch,
  };
}

function active(startedAt: number) {
  return {
    concurrencyKey: 'key',
    id: 'run-1',
    kind: 'agent' as const,
    modelLabel: 'model',
    prompt: 'a long job',
    startedAt,
  };
}

describe('agentAttentionQueue', () => {
  it('is empty when nothing is happening', () => {
    expect(agentAttentionQueue(input(), NOW)).toEqual([]);
  });

  it('lists an outstanding approval, which nothing else can unblock', () => {
    const queue = agentAttentionQueue(
      input({
        approvalRequest: {
          id: 'approval-1',
          kind: 'command',
          title: 'Run npm install',
          message: 'The agent wants to install dependencies.',
        },
      }),
      NOW,
    );

    expect(queue).toEqual([{ reason: 'approval', id: 'approval-1', title: 'Run npm install' }]);
  });

  it('puts what has stopped ahead of what has merely gone wrong', () => {
    const queue = agentAttentionQueue(
      input({
        questionRequest: {
          id: 'question-1',
          header: 'Target',
          question: 'Which package should this go in?',
          options: [{ label: 'core' }, { label: 'services' }],
          allowOther: true,
        },
        agentRuns: {
          'run-9': { phase: 'failed', files: [], commands: [], summary: 'Build broke.' },
        },
      }),
      NOW,
    );

    expect(queue.map((item) => item.reason)).toEqual(['question', 'failed']);
  });

  it('reports a failed run by its summary rather than its phase', () => {
    const queue = agentAttentionQueue(
      input({
        agentRuns: {
          'run-9': { phase: 'failed', files: [], commands: [], summary: 'Build broke.' },
        },
      }),
      NOW,
    );

    expect(queue[0]?.title).toBe('Build broke.');
  });

  it('falls back to the phase when a failed run reported no summary', () => {
    const queue = agentAttentionQueue(
      input({ agentRuns: { 'run-9': { phase: 'rejected', files: [], commands: [] } } }),
      NOW,
    );

    expect(queue[0]?.title).toBe('rejected');
  });

  it('leaves a run that is still going out of the list until it is slow', () => {
    const fresh = input({
      generationQueue: { active: [active(NOW - 1_000)], capacity: 2, pending: [] },
    });

    expect(agentAttentionQueue(fresh, NOW)).toEqual([]);
  });

  it('lists a run that has been going long enough to be worth asking about', () => {
    const slow = input({
      generationQueue: { active: [active(NOW - SLOW_RUN_MS)], capacity: 2, pending: [] },
    });

    expect(agentAttentionQueue(slow, NOW)).toEqual([
      { reason: 'slow', id: 'run-1', title: 'a long job', waitingMs: SLOW_RUN_MS },
    ]);
  });

  it('lists queued work last, because waiting a turn costs nothing', () => {
    const queue = agentAttentionQueue(
      input({
        approvalRequest: {
          id: 'approval-1',
          kind: 'command',
          title: 'Run npm install',
          message: 'why',
        },
        generationQueue: {
          active: [],
          capacity: 2,
          pending: [
            { concurrencyKey: 'k', id: 'run-2', kind: 'agent', modelLabel: 'm', prompt: 'next' },
          ],
        },
      }),
      NOW,
    );

    expect(queue.map((item) => item.reason)).toEqual(['approval', 'queued']);
  });
});

describe('attentionBadgeCount', () => {
  it('counts only what has actually stopped', () => {
    const items = agentAttentionQueue(
      input({
        approvalRequest: { id: 'a', kind: 'command', title: 't', message: 'm' },
        agentRuns: { 'run-9': { phase: 'failed', files: [], commands: [] } },
        generationQueue: {
          active: [],
          capacity: 2,
          pending: [
            { concurrencyKey: 'k', id: 'run-2', kind: 'agent', modelLabel: 'm', prompt: 'next' },
          ],
        },
      }),
      NOW,
    );

    expect(items).toHaveLength(3);
    expect(attentionBadgeCount(items)).toBe(2);
  });

  it('stays dark through an ordinary busy period', () => {
    const items = agentAttentionQueue(
      input({
        generationQueue: {
          active: [active(NOW - SLOW_RUN_MS)],
          capacity: 2,
          pending: [
            { concurrencyKey: 'k', id: 'run-2', kind: 'agent', modelLabel: 'm', prompt: 'next' },
          ],
        },
      }),
      NOW,
    );

    expect(attentionBadgeCount(items)).toBe(0);
  });
});
