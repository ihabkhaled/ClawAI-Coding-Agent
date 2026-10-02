import { describe, expect, it } from 'vitest';

import { OrchestrateEngine } from '../../src/sdk/orchestrate-engine';
import { validatePlan } from '../../src/sdk/orchestrate-validate';
import { agent, diamond, plan, scoped } from '../helpers/orchestrate-plans';

import type {
  AgentAttempt,
  AgentJob,
  AgentRunner,
  CheckResult,
  GateRunner,
  OrchestrateEvent,
} from '../../src/sdk/orchestrate.types';

const ok = (extra: Partial<AgentAttempt> = {}): AgentAttempt => ({
  state: 'completed',
  summary: 'done',
  toolCalls: 3,
  durationMs: 10,
  files: ['f.ts'],
  checks: [],
  ...extra,
});

const bad = (error = 'boom'): AgentAttempt => ({ ...ok(), state: 'failed', error, files: [] });

const passing: GateRunner = (checks) =>
  Promise.resolve(
    checks.map((check): CheckResult => ({
      label: check.label,
      ok: true,
      exitCode: 0,
      durationMs: 1,
      tail: '',
    })),
  );

const failing: GateRunner = (checks) =>
  Promise.resolve(
    checks.map((check): CheckResult => ({
      label: check.label,
      ok: false,
      exitCode: 1,
      durationMs: 1,
      tail: 'it broke',
    })),
  );

/** Runs a raw plan through the engine with a scripted runner; records start order and peak concurrency. */
async function run(
  raw: Record<string, unknown>,
  runner: (job: AgentJob) => Promise<AgentAttempt> | AgentAttempt,
  options: {
    gate?: GateRunner;
    signal?: AbortSignal;
    timeoutMs?: number;
    haltGraceMs?: number;
  } = {},
) {
  const checked = validatePlan(raw);
  if (!checked.ok) throw new Error(checked.problems.join('\n'));
  const events: OrchestrateEvent[] = [];
  const started: string[] = [];
  let live = 0;
  let peak = 0;
  const wrapped: AgentRunner = async (job) => {
    started.push(`${job.agent.name}#${String(job.attempt)}`);
    live += 1;
    peak = Math.max(peak, live);
    try {
      return await runner(job);
    } finally {
      live -= 1;
    }
  };
  const engine = new OrchestrateEngine({
    validated: checked.value,
    runner: wrapped,
    gate: options.gate ?? passing,
    emit: (event) => events.push(event),
    runId: 'run-1',
    signal: options.signal,
    timeoutMs: options.timeoutMs,
    haltGraceMs: options.haltGraceMs,
  });
  const report = await engine.run();
  const statuses = Object.fromEntries(report.stages.map((stage) => [stage.id, stage.status]));
  return { report, events, started, statuses, peak: () => peak };
}

const sleep = (ms: number) => new Promise<void>((resolve) => setTimeout(resolve, ms));
const untilAborted = (job: AgentJob) =>
  new Promise<AgentAttempt>((resolve) => {
    job.signal.addEventListener('abort', () => {
      resolve({ ...ok(), state: 'cancelled', files: [] });
    });
  });

describe('engine: order and parallelism', () => {
  it('runs the diamond: a, then b and c together, then d', async () => {
    const { report, started, statuses, peak } = await run(diamond(), async () => {
      await sleep(15);
      return ok();
    });
    expect(report.status).toBe('passed');
    expect(statuses).toEqual({ a: 'passed', b: 'passed', c: 'passed', d: 'passed' });
    expect(started[0]).toBe('agent-a#1');
    expect(started.at(-1)).toBe('agent-d#1');
    expect(new Set(started.slice(1, 3))).toEqual(new Set(['agent-b#1', 'agent-c#1']));
    expect(peak()).toBe(2);
    expect(report.totals).toEqual({ agents: 4, toolCalls: 12, files: 1 });
  });

  it('never runs more agents than maxParallel across stages', async () => {
    const wide = plan(
      [{ id: 's', agents: ['a', 'b', 'c', 'd', 'e'].map((name) => scoped(name)) }],
      {
        maxParallel: 3,
      },
    );
    const { peak, report } = await run(wide, async () => {
      await sleep(10);
      return ok();
    });
    expect(peak()).toBe(3);
    expect(report.status).toBe('passed');
  });

  it('runs with one slot one agent at a time', async () => {
    const { peak } = await run(diamond({ maxParallel: 1 }), async () => ok());
    expect(peak()).toBe(1);
  });

  it('is deadlock free with more agents than slots and a long chain', async () => {
    const chain = plan(
      Array.from({ length: 12 }, (_, index) => ({
        id: `s${String(index)}`,
        dependsOn: index === 0 ? [] : [`s${String(index - 1)}`],
        agents: [scoped(`a${String(index)}`), scoped(`b${String(index)}`)],
      })),
      { maxParallel: 1 },
    );
    const { report } = await run(chain, () => ok());
    expect(report.status).toBe('passed');
    expect(report.stages).toHaveLength(12);
  });

  it('emits stage and agent events in a sensible order', async () => {
    const { events } = await run(diamond(), () => ok());
    const kinds = events.map((event) =>
      'stage' in event && 'name' in event
        ? `${event.type}:${event.name}`
        : event.type + ('stage' in event ? `:${event.stage}` : ''),
    );
    expect(kinds[0]).toBe('orchestrate.started');
    expect(kinds.indexOf('orchestrate.stage.started:b')).toBeGreaterThan(
      kinds.indexOf('orchestrate.stage.finished:a'),
    );
    expect(kinds.at(-1)).toBe('orchestrate.finished');
    expect(events.filter((event) => event.type === 'orchestrate.agent.finished')).toHaveLength(4);
  });
});

describe('engine: failure', () => {
  const failB = (job: AgentJob) => (job.agent.name === 'agent-b' ? bad('b broke') : ok());

  it('skips the dependents of a failed stage with a clear reason, and stops everything (stop)', async () => {
    const { report, statuses, started } = await run(diamond(), failB);
    expect(report.status).toBe('failed');
    expect(statuses.b).toBe('failed');
    expect(statuses.d).toBe('skipped');
    expect(report.stages.find((stage) => stage.id === 'd')?.reason).toMatch(
      /not started|skipped/iu,
    );
    expect(started).not.toContain('agent-d#1');
    expect(report.reason).toContain('b broke');
  });

  it('under continue, independent stages still run and only dependents are skipped', async () => {
    const { report, statuses, started } = await run(diamond({ onFailure: 'continue' }), failB);
    expect(statuses).toEqual({ a: 'passed', b: 'failed', c: 'passed', d: 'skipped' });
    expect(started).toContain('agent-c#1');
    expect(report.stages.find((stage) => stage.id === 'd')?.reason).toBe(
      'Skipped: stage "b" failed.',
    );
    expect(report.status).toBe('failed');
  });

  it('under stop, cancels the agents still running when one fails', async () => {
    const parallel = plan(
      [
        { id: 'x', agents: [scoped('fast')] },
        { id: 'y', agents: [scoped('slow')] },
      ],
      { maxParallel: 2 },
    );
    const { statuses, report } = await run(parallel, (job) =>
      job.agent.name === 'fast' ? bad() : untilAborted(job),
    );
    expect(statuses).toEqual({ x: 'failed', y: 'cancelled' });
    expect(report.stages[1]?.agents[0]?.state).toBe('cancelled');
  });

  it('retries a failing agent up to N times, rotating through a model pool', async () => {
    const raw = plan(
      [{ id: 's', agents: [agent({ name: 'flaky', model: 'pool:p', writeScope: ['f/**'] })] }],
      {
        onFailure: 'retry:2',
        modelPools: { p: ['m1', 'm2', 'm3'] },
      },
    );
    const models: (string | undefined)[] = [];
    const { report, events } = await run(raw, (job) => {
      models.push(job.model);
      return job.attempt < 3 ? bad(`fail ${String(job.attempt)}`) : ok();
    });
    expect(models).toEqual(['m1', 'm2', 'm3']);
    expect(report.status).toBe('passed');
    expect(report.stages[0]?.agents[0]?.attempts).toBe(3);
    expect(events.filter((event) => event.type === 'orchestrate.agent.retrying')).toHaveLength(2);
  });

  it('fails the stage once the retries are spent', async () => {
    const raw = plan([{ id: 's', agents: [scoped('flaky')] }], { onFailure: 'retry:1' });
    const { report, started } = await run(raw, () => bad());
    expect(started).toEqual(['flaky#1', 'flaky#2']);
    expect(report.status).toBe('failed');
    expect(report.stages[0]?.agents[0]?.attempts).toBe(2);
  });

  it('turns a crashing runner into a failed agent, not a rejected run', async () => {
    const { report } = await run(diamond(), () => {
      throw new Error('runner exploded');
    });
    expect(report.status).toBe('failed');
    expect(report.stages[0]?.agents[0]?.result?.error).toContain('runner exploded');
  });

  it('fails the stage when its gate fails, and skips what depends on it', async () => {
    const raw = plan(
      [
        {
          id: 'a',
          agents: [scoped('one')],
          gate: { doneChecks: [{ label: 'tests', command: 'npm test' }] },
        },
        { id: 'b', dependsOn: ['a'], agents: [scoped('two')] },
      ],
      { onFailure: 'continue' },
    );
    const { report, statuses, started } = await run(raw, () => ok(), { gate: failing });
    expect(statuses).toEqual({ a: 'failed', b: 'skipped' });
    expect(report.stages[0]?.gate).toMatchObject({ passed: false });
    expect(report.stages[0]?.reason).toContain('Gate failed: tests');
    expect(started).toEqual(['one#1']);
  });

  it('runs the gate only after every agent of the stage finished', async () => {
    const order: string[] = [];
    const raw = plan([
      {
        id: 'a',
        agents: [scoped('one'), scoped('two')],
        gate: { doneChecks: [{ label: 'g', command: 'node x' }] },
      },
    ]);
    const { report } = await run(
      raw,
      async (job) => {
        await sleep(job.agent.name === 'one' ? 5 : 25);
        order.push(`done-${job.agent.name}`);
        return ok();
      },
      {
        gate: (checks) => {
          order.push('gate');
          return passing(checks, new AbortController().signal);
        },
      },
    );
    expect(order).toEqual(['done-one', 'done-two', 'gate']);
    expect(report.stages[0]?.gate?.passed).toBe(true);
  });
});

describe('engine: cancel and timeout', () => {
  it('cancelling the signal cancels running agents and skips the rest; the run ends cancelled', async () => {
    const controller = new AbortController();
    const finished = run(diamond(), untilAborted, { signal: controller.signal });
    await sleep(20);
    controller.abort();
    const { report, statuses, started } = await finished;
    expect(report.status).toBe('cancelled');
    expect(statuses.a).toBe('cancelled');
    expect(statuses.d).toBe('cancelled');
    expect(started).toEqual(['agent-a#1']);
  });

  it('an already-cancelled signal starts nothing', async () => {
    const controller = new AbortController();
    controller.abort();
    const { report, started } = await run(diamond(), () => ok(), { signal: controller.signal });
    expect(started).toEqual([]);
    expect(report.status).toBe('cancelled');
  });

  it('the plan timeout cancels everything and ends the run as timeout', async () => {
    const { report, statuses } = await run(diamond(), untilAborted, { timeoutMs: 30 });
    expect(report.status).toBe('timeout');
    expect(report.reason).toContain('time limit');
    expect(statuses.a).toBe('cancelled');
  });

  it('counts an agent that ignores the abort as cancelled after the grace period', async () => {
    const stubborn = (): Promise<AgentAttempt> => new Promise(() => undefined);
    const { report } = await run(diamond(), stubborn, { timeoutMs: 20, haltGraceMs: 30 });
    expect(report.status).toBe('timeout');
    expect(report.stages[0]?.agents[0]?.result?.error).toContain('did not stop');
  });

  it('cancels a gate in flight', async () => {
    const controller = new AbortController();
    const raw = plan([
      {
        id: 'a',
        agents: [scoped('one')],
        gate: { doneChecks: [{ label: 'g', command: 'node x' }] },
      },
    ]);
    const hang: GateRunner = (_checks, signal) =>
      new Promise((resolve) => {
        controller.abort();
        expect(signal.aborted).toBe(true);
        resolve([{ label: 'g', ok: false, exitCode: -1, durationMs: 1, tail: 'cancelled' }]);
      });
    const { report } = await run(raw, () => ok(), { gate: hang, signal: controller.signal });
    expect(report.status).toBe('cancelled');
    expect(report.stages[0]?.status).toBe('cancelled');
  });
});
