import { describe, expect, it, vi } from 'vitest';

import {
  assertMonitorPattern,
  isConditionMet,
  monitorConditionSchema,
  nextPollDelay,
} from '../../src/core/monitor-condition';
import { MAX_POLL_MS, MIN_POLL_MS } from '../../src/core/monitor-condition.constants';
import {
  MonitorToolExecutor,
  monitorToolDefinition,
} from '../../src/infrastructure/monitor-tool-executor';

import type { MonitorObservation } from '../../src/core/monitor-condition.types';
import type { ToolInvocation } from '../../src/core/runtime/runtime-tool-contracts';

const ABSENT: MonitorObservation = { exists: false };

function invocation(args: Record<string, unknown>): ToolInvocation {
  return {
    toolName: monitorToolDefinition.name,
    operation: 'wait',
    arguments: args,
  } as ToolInvocation;
}

describe('nextPollDelay', () => {
  it('starts responsive', () => {
    expect(nextPollDelay(0)).toBe(MIN_POLL_MS);
  });

  it('doubles, so a long wait does not cost thousands of looks', () => {
    expect(nextPollDelay(MIN_POLL_MS)).toBe(MIN_POLL_MS * 2);
  });

  it('stops doubling at the ceiling', () => {
    expect(nextPollDelay(MAX_POLL_MS)).toBe(MAX_POLL_MS);
    expect(nextPollDelay(MAX_POLL_MS * 10)).toBe(MAX_POLL_MS);
  });
});

describe('isConditionMet', () => {
  it('answers exists and missing from the current look alone', () => {
    const present: MonitorObservation = { exists: true, digest: 'a' };

    expect(isConditionMet({ kind: 'exists', path: 'p' }, ABSENT, present)).toBe(true);
    expect(isConditionMet({ kind: 'exists', path: 'p' }, ABSENT, ABSENT)).toBe(false);
    expect(isConditionMet({ kind: 'missing', path: 'p' }, present, ABSENT)).toBe(true);
  });

  it('compares changed against the baseline, not the previous look', () => {
    const baseline: MonitorObservation = { exists: true, digest: 'a' };
    const rewritten: MonitorObservation = { exists: true, digest: 'b' };

    expect(isConditionMet({ kind: 'changed', path: 'p' }, baseline, baseline)).toBe(false);
    expect(isConditionMet({ kind: 'changed', path: 'p' }, baseline, rewritten)).toBe(true);
  });

  it('counts a file appearing or vanishing as a change', () => {
    expect(isConditionMet({ kind: 'changed', path: 'p' }, ABSENT, { exists: true })).toBe(true);
    expect(isConditionMet({ kind: 'changed', path: 'p' }, { exists: true }, ABSENT)).toBe(true);
  });

  it('matches a pattern against the file text', () => {
    const built: MonitorObservation = { exists: true, digest: 'a', text: 'Build succeeded' };

    expect(
      isConditionMet({ kind: 'matches', path: 'p', pattern: 'succeeded' }, ABSENT, built),
    ).toBe(true);
    expect(isConditionMet({ kind: 'matches', path: 'p', pattern: 'failed' }, ABSENT, built)).toBe(
      false,
    );
  });

  it('cannot match a file that is not there', () => {
    expect(isConditionMet({ kind: 'matches', path: 'p', pattern: '.' }, ABSENT, ABSENT)).toBe(
      false,
    );
  });
});

describe('assertMonitorPattern', () => {
  it('refuses a pattern up front rather than minutes into a wait', () => {
    expect(() => {
      assertMonitorPattern('([a-z');
    }).toThrow(/not a valid regular expression/u);
    expect(() => {
      assertMonitorPattern(undefined);
    }).not.toThrow();
  });
});

describe('monitorConditionSchema', () => {
  it('refuses a matches condition with no pattern', () => {
    expect(() => monitorConditionSchema.parse({ kind: 'matches', path: 'p' })).toThrow();
  });

  it('caps the timeout a caller can ask for', () => {
    expect(() =>
      monitorConditionSchema.parse({ kind: 'exists', path: 'p', timeoutMs: 60 * 60 * 1000 }),
    ).toThrow();
  });
});

describe('MonitorToolExecutor', () => {
  function harness(looks: MonitorObservation[], startAt = 0) {
    let clock = startAt;
    const queue = [...looks];
    let last = queue[queue.length - 1] ?? ABSENT;
    return {
      port: {
        observe: vi.fn(async () => {
          const next = queue.shift();
          if (next !== undefined) last = next;
          return last;
        }),
        wait: vi.fn(async (delayMs: number) => {
          clock += delayMs;
        }),
        now: () => clock,
      },
    };
  }

  it('returns immediately when the condition already holds', async () => {
    const seat = harness([{ exists: true, digest: 'a' }]);
    const executor = new MonitorToolExecutor(seat.port);

    const output = await executor.execute(invocation({ kind: 'exists', path: 'out.txt' }));

    expect(output.structured).toEqual({ path: 'out.txt', satisfied: true, waitedMs: 0, looks: 1 });
    expect(seat.port.wait).not.toHaveBeenCalled();
  });

  it('waits until the file appears and says how long it took', async () => {
    const seat = harness([ABSENT, ABSENT, { exists: true, digest: 'a' }]);
    const executor = new MonitorToolExecutor(seat.port);

    const output = await executor.execute(
      invocation({ kind: 'exists', path: 'out.txt', timeoutMs: 60_000 }),
    );

    expect(output.structured).toMatchObject({ satisfied: true, looks: 3 });
  });

  it('gives up on time and says so rather than throwing', async () => {
    const seat = harness([ABSENT]);
    const executor = new MonitorToolExecutor(seat.port);

    const output = await executor.execute(
      invocation({ kind: 'exists', path: 'never.txt', timeoutMs: 2_000 }),
    );

    expect(output.structured).toMatchObject({ satisfied: false });
  });

  it('backs off, so a long wait costs few looks', async () => {
    const seat = harness([ABSENT]);
    const executor = new MonitorToolExecutor(seat.port);

    await executor.execute(invocation({ kind: 'exists', path: 'never.txt', timeoutMs: 600_000 }));

    const delays = seat.port.wait.mock.calls.map((call) => call[0]);
    expect(delays[0]).toBe(MIN_POLL_MS);
    expect(delays[delays.length - 1]).toBe(MAX_POLL_MS);
    expect(delays.length).toBeLessThan(200);
  });

  it('is an inspect-class tool, because waiting changes nothing', () => {
    expect(monitorToolDefinition.riskClasses).toEqual(['inspect']);
  });
});
