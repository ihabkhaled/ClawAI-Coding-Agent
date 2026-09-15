import { describe, expect, it, vi } from 'vitest';

import { runHeadlessSession } from '../../src/headless/headless-session';

import type {
  HeadlessSessionPorts,
  HeadlessStreamEvent,
} from '../../src/headless/headless-session.types';

function ports(
  events: readonly HeadlessStreamEvent[],
  overrides: Partial<HeadlessSessionPorts> = {},
): HeadlessSessionPorts {
  return {
    events: async function* stream() {
      for (const event of events) yield await Promise.resolve(event);
    },
    answerTool: async () => Promise.resolve(),
    now: () => 0,
    deadlineMs: 60_000,
    ...overrides,
  };
}

const toolRequest: HeadlessStreamEvent = {
  type: 'tool.requested',
  payload: { invocationId: 'invocation-1' },
};

describe('runHeadlessSession', () => {
  it('reports the outcome of the terminal event the run ended on', async () => {
    const report = await runHeadlessSession(ports([{ type: 'run.completed' }]));

    expect(report.outcome).toBe('completed');
    expect(report.terminalEvent).toBe('run.completed');
  });

  it('answers every tool the run asks for, and counts them', async () => {
    const answerTool = vi.fn(async () => Promise.resolve());

    const report = await runHeadlessSession(
      ports([toolRequest, toolRequest, { type: 'run.completed' }], { answerTool }),
    );

    expect(answerTool).toHaveBeenCalledTimes(2);
    expect(report.toolCalls).toBe(2);
  });

  it('stops at the terminal event instead of draining the rest of the stream', async () => {
    const answerTool = vi.fn(async () => Promise.resolve());

    await runHeadlessSession(ports([{ type: 'run.failed' }, toolRequest], { answerTool }));

    expect(answerTool).not.toHaveBeenCalled();
  });

  it('treats a stream that ends on nothing as failed, never as success', async () => {
    const report = await runHeadlessSession(ports([{ type: 'model.delta' }]));

    expect(report.outcome).toBe('failed');
    expect(report.terminalEvent).toBeUndefined();
  });

  it('separates every terminal event it knows', async () => {
    for (const [type, outcome] of [
      ['run.completed', 'completed'],
      ['run.failed', 'failed'],
      ['run.cancelled', 'cancelled'],
      ['run.blocked', 'blocked'],
    ] as const) {
      const report = await runHeadlessSession(ports([{ type }]));

      expect(report.outcome).toBe(outcome);
    }
  });

  it('calls a run that ran out of time exhausted, not failed', async () => {
    let clock = 0;
    const report = await runHeadlessSession(
      ports([{ type: 'model.delta' }, { type: 'model.delta' }, { type: 'run.completed' }], {
        now: () => {
          clock += 1_000;
          return clock;
        },
        deadlineMs: 1_500,
      }),
    );

    expect(report.outcome).toBe('exhausted');
  });

  it('keeps an answer that arrives as the deadline passes', async () => {
    let clock = 0;
    const report = await runHeadlessSession(
      ports([{ type: 'run.completed' }], {
        now: () => {
          clock += 10_000;
          return clock;
        },
        deadlineMs: 1,
      }),
    );

    expect(report.outcome).toBe('completed');
  });

  it('reports no tool calls for a run that needed none', async () => {
    expect((await runHeadlessSession(ports([{ type: 'run.completed' }]))).toolCalls).toBe(0);
  });
});
