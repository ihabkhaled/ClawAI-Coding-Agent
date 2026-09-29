import { describe, expect, it, vi } from 'vitest';

import { summarizeChecks } from '../../src/core/pull-request';
import { PullRequestMonitorService } from '../../src/services/pull-request-monitor-service';

import type { PullRequestCheckSummary } from '../../src/core/pull-request.types';

const pr = { url: 'https://github.com/o/r/pull/7', number: 7, rootKey: 'workspace-0', branch: 'b' };
const policy = {
  firstDelayMs: 10,
  maxDelayMs: 40,
  maxPolls: 3,
  maxConsecutiveErrors: 2,
  maxWatched: 1,
};

/** Timers the test fires by hand, recording each requested delay. */
function manualTimers() {
  const pending: { callback: () => void; delay: number }[] = [];
  return {
    pending,
    delays: [] as number[],
    set(callback: () => void, delay: number) {
      this.delays.push(delay);
      const entry = { callback, delay };
      pending.push(entry);
      return entry;
    },
    clear(handle: unknown) {
      const index = pending.indexOf(handle as (typeof pending)[number]);
      if (index >= 0) pending.splice(index, 1);
    },
    async fire() {
      const next = pending.shift();
      next?.callback();
      await new Promise((resolve) => setTimeout(resolve, 0));
    },
  };
}

function harness(answers: (PullRequestCheckSummary | Error)[], fixChosen = true) {
  const timers = manualTimers();
  const checks = {
    checks: vi.fn(async () => {
      const answer = answers.shift() ?? summarizeChecks([{ name: 'x', bucket: 'pending' }]);
      if (answer instanceof Error) throw answer;
      return answer;
    }),
    failureLogs: vi.fn(async () => ({
      summary: summarizeChecks([{ name: 'unit', bucket: 'fail' }]),
      logs: 'Error: boom',
    })),
  };
  const alerts = { failed: vi.fn(async () => fixChosen), passed: vi.fn() };
  const ended = vi.fn();
  const monitor = new PullRequestMonitorService({ checks, alerts, timers, policy }, ended);
  const fix = vi.fn(async () => undefined);
  monitor.bindFix(fix);
  return { monitor, timers, checks, alerts, ended, fix };
}

const pending = summarizeChecks([{ name: 'unit', bucket: 'pending' }]);

describe('PullRequestMonitorService', () => {
  it('backs off while pending and reports a pass once', async () => {
    const { monitor, timers, alerts, ended } = harness([
      pending,
      summarizeChecks([{ name: 'unit', bucket: 'pass' }]),
    ]);
    expect(monitor.watch(pr)).toBe(true);
    await timers.fire();
    await timers.fire();
    expect(timers.delays).toEqual([10, 20]);
    expect(alerts.passed).toHaveBeenCalledWith(pr);
    expect(ended).toHaveBeenCalledWith(pr, 'passed');
    expect(timers.pending).toHaveLength(0);
    expect(monitor.watching()).toEqual([]);
  });

  it('offers a fix on failure and starts a run with the failing logs', async () => {
    const { monitor, timers, fix, alerts } = harness([
      summarizeChecks([{ name: 'unit', bucket: 'fail' }]),
    ]);
    monitor.watch(pr);
    await timers.fire();
    expect(alerts.failed).toHaveBeenCalledOnce();
    expect(fix).toHaveBeenCalledOnce();
    const [prompt] = fix.mock.calls[0] as unknown as [string];
    expect(prompt).toContain('pull request #7');
    expect(prompt).toContain('Error: boom');
    expect(timers.pending).toHaveLength(0);
  });

  it('starts no run when the person declines', async () => {
    const { monitor, timers, fix } = harness(
      [summarizeChecks([{ name: 'u', bucket: 'fail' }])],
      false,
    );
    monitor.watch(pr);
    await timers.fire();
    expect(fix).not.toHaveBeenCalled();
  });

  it('gives up after the poll limit', async () => {
    const { monitor, timers, ended, checks } = harness([pending, pending, pending, pending]);
    monitor.watch(pr);
    for (let index = 0; index < 5; index += 1) await timers.fire();
    expect(checks.checks).toHaveBeenCalledTimes(3);
    expect(ended).toHaveBeenCalledWith(pr, 'gave-up');
    expect(timers.delays).toEqual([10, 20, 40]);
  });

  it('stops after consecutive errors', async () => {
    const { monitor, timers, ended } = harness([new Error('401'), new Error('401')]);
    monitor.watch(pr);
    await timers.fire();
    await timers.fire();
    expect(ended).toHaveBeenCalledWith(pr, 'errored');
  });

  it('refuses duplicates and watches beyond the limit, and dispose clears timers', () => {
    const { monitor, timers, ended } = harness([]);
    expect(monitor.watch(pr)).toBe(true);
    expect(monitor.watch(pr)).toBe(false);
    expect(monitor.watch({ ...pr, url: 'https://github.com/o/r/pull/8', number: 8 })).toBe(false);
    monitor.dispose();
    expect(timers.pending).toHaveLength(0);
    expect(ended).toHaveBeenCalledWith(pr, 'stopped');
    expect(monitor.watch(pr)).toBe(false);
  });
});
