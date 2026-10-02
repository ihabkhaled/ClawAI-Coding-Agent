import { describe, expect, it } from 'vitest';

import { describePlan } from '../../src/sdk/orchestrate-format';
import { failurePolicy, validatePlan } from '../../src/sdk/orchestrate-validate';
import { agent, diamond, plan } from '../helpers/orchestrate-plans';

type Ceiling = Parameters<typeof validatePlan>[1];

const one = (extra: Record<string, unknown> = {}, ...more: Record<string, unknown>[]) =>
  plan([{ id: 's', agents: [agent({ name: 'x', writeScope: ['x/**'], ...extra }), ...more] }]);

function problems(raw: unknown, ceiling?: Ceiling): string {
  const checked = validatePlan(raw, ceiling);
  return checked.ok ? '' : checked.problems.join('\n');
}

const BAD_QUOTE = 'node "x';

describe('validatePlan: refusals', () => {
  it.each([
    ['not an object', 'x', ''],
    ['an unknown top-level key', { ...diamond(), extra: 1 }, 'extra'],
    ['no stages', plan([]), 'stages'],
    ['a bad agent name', one({ name: 'Bad Name' }), 'name'],
    [
      'a missing budget',
      plan([{ id: 's', agents: [{ name: 'x', task: 't', tools: ['read'] }] }]),
      'budget',
    ],
    [
      'a budget over the limit',
      one({ budget: { maxToolCalls: 99_999, maxDurationSec: 60 } }),
      'maxToolCalls',
    ],
    ['an empty tools list', one({ tools: [] }), 'tools'],
    ['shell as a category', one({ tools: ['shell'] }), 'tools'],
    ['a bad onFailure', diamond({ onFailure: 'explode' }), 'onFailure'],
    ['maxParallel 99', diamond({ maxParallel: 99 }), 'maxParallel'],
  ])('%s', (_label, raw, expected) => {
    const text = problems(raw);
    expect(text.length).toBeGreaterThan(0);
    expect(text).toContain(expected);
  });

  it.each([
    [
      'a duplicate stage id',
      plan([
        { id: 's', agents: [agent({ name: 'a' })] },
        { id: 's', agents: [agent({ name: 'b' })] },
      ]),
      'used twice',
    ],
    [
      'a duplicate agent name across stages',
      plan([
        { id: 's', agents: [agent({ name: 'a', writeScope: ['a/**'] })] },
        { id: 't', agents: [agent({ name: 'a' })] },
      ]),
      'Agent name "a" is used twice',
    ],
    ['a reserved name', one({ name: 'lead' }), 'reserved'],
    [
      'a missing dependency',
      plan([{ id: 's', dependsOn: ['ghost'], agents: [agent({ name: 'a' })] }]),
      'not a stage',
    ],
    [
      'a self dependency',
      plan([{ id: 's', dependsOn: ['s'], agents: [agent({ name: 'a' })] }]),
      'itself',
    ],
    [
      'a cycle',
      plan([
        { id: 'p', dependsOn: ['q'], agents: [agent({ name: 'a' })] },
        { id: 'q', dependsOn: ['p'], agents: [agent({ name: 'b' })] },
      ]),
      'loop: p -> q -> p',
    ],
    ['an undefined model pool', one({ model: 'pool:cheap' }), 'pool "cheap"'],
    ['a pool inside a pool', diamond({ modelPools: { a: ['pool:b'] } }), 'not other pools'],
    [
      'http without hosts',
      one({ tools: ['read', 'http'], writeScope: [] }),
      'need http.allowHosts',
    ],
    ['hosts without http', one({ http: { allowHosts: ['example.com'] } }), 'without an http'],
    [
      'browser hosts without browser',
      one({ browser: { allowHosts: ['claw.local'] } }),
      'without the browser',
    ],
    [
      'a bad host rule',
      one({ tools: ['http'], http: { allowHosts: ['*'] }, writeScope: [] }),
      'wildcard',
    ],
    ['a write scope on a read-only agent', one({ tools: ['read'] }), 'no tool that changes files'],
    ['a bad glob', one({ writeScope: ['../x'] }), 'x'],
    [
      'an unterminated check quote',
      one({ doneChecks: [{ label: 'c', command: BAD_QUOTE }] }),
      'unterminated',
    ],
  ])('%s', (_label, raw, expected) => {
    expect(problems(raw)).toContain(expected);
  });

  it('refuses a gate whose command cannot be parsed', () => {
    const raw = plan([
      {
        id: 's',
        agents: [agent({ name: 'a' })],
        gate: { doneChecks: [{ label: 'g', command: BAD_QUOTE }] },
      },
    ]);
    expect(problems(raw)).toContain('s gate');
  });
});

describe('validatePlan: the run ceiling', () => {
  it('refuses a category the run does not grant, naming it and the grants', () => {
    const raw = one({
      tools: ['read', 'http'],
      http: { allowHosts: ['example.com'] },
      writeScope: [],
    });
    expect(problems(raw)).toContain('does not grant http');
  });

  it('refuses shell without both shell switches', () => {
    expect(problems(one({ shell: true }))).toContain('does not grant shell');
    const off: Ceiling = { allow: ['read', 'write', 'shell'], shell: false };
    expect(problems(one({ shell: true }), off)).toContain('does not grant shell');
    const on: Ceiling = { allow: ['read', 'write', 'shell'], shell: true };
    expect(problems(one({ shell: true }), on)).toBe('');
  });

  it('refuses hosts outside the hosts the run allows, and accepts those inside', () => {
    const raw = one({ tools: ['http'], http: { allowHosts: ['api.example.com'] }, writeScope: [] });
    const allow = ['read', 'http'] as const;
    expect(problems(raw, { allow, httpAllowHosts: ['other.com'] })).toContain(
      'not inside the hosts',
    );
    expect(problems(raw, { allow, httpAllowHosts: ['*.example.com'] })).toBe('');
    expect(problems(raw, { allow, httpAllowHosts: ['api.example.com'] })).toBe('');
    expect(problems(raw, { allow, httpAllowHosts: ['api.example.com:8443'] })).toContain(
      'not inside',
    );
  });

  it('refuses a browser host the run has not listed', () => {
    const raw = one({
      tools: ['read', 'browser'],
      browser: { allowHosts: ['claw.local'] },
      writeScope: [],
    });
    const allow = ['read', 'browser'] as const;
    expect(problems(raw, { allow, browserAllowHosts: [] })).toContain('browser host "claw.local"');
    expect(problems(raw, { allow, browserAllowHosts: ['CLAW.local'] })).toBe('');
  });
});

describe('validatePlan: file conflicts between parallel agents', () => {
  const sibling = (scope: string[], extra: Record<string, unknown> = {}) =>
    agent({ name: 'y', writeScope: scope, ...extra });

  it('refuses overlapping scopes in one stage and lists the overlap', () => {
    const text = problems(one({ writeScope: ['src/**'] }, sibling(['src/lib/**'])));
    expect(text).toContain('s/x');
    expect(text).toContain('s/y');
    expect(text).toContain('src/** and src/lib/**');
  });

  it('refuses an agent with no scope next to another writer', () => {
    expect(problems(one({ writeScope: [] }, sibling(['y/**'])))).toContain('overlap');
  });

  it('accepts disjoint scopes', () => {
    expect(problems(one({ writeScope: ['a/**'] }, sibling(['b/**'])))).toBe('');
  });

  it('accepts overlap between a reader and a writer', () => {
    const reader = agent({ name: 'y', tools: ['read'] });
    expect(problems(one({ writeScope: ['a/**'] }, reader))).toBe('');
  });

  it('accepts overlap when one agent works in its own worktree', () => {
    expect(problems(one({ writeScope: ['a/**'], isolation: 'worktree' }, sibling(['a/**'])))).toBe(
      '',
    );
  });

  it('refuses overlap between stages that do not wait for each other, but not ones that do', () => {
    const w = (name: string, scope: string) => agent({ name, writeScope: [scope] });
    const parallel = plan([
      { id: 'p', agents: [w('a', 'src/**')] },
      { id: 'q', agents: [w('b', 'src/**')] },
    ]);
    expect(problems(parallel)).toContain('overlap');
    const ordered = plan([
      { id: 'p', agents: [w('a', 'src/**')] },
      { id: 'q', dependsOn: ['p'], agents: [w('b', 'src/**')] },
    ]);
    expect(problems(ordered)).toBe('');
    const transitive = plan([
      { id: 'p', agents: [w('a', 'src/**')] },
      { id: 'q', dependsOn: ['p'], agents: [w('c', 'other/**')] },
      { id: 'r', dependsOn: ['q'], agents: [w('b', 'src/**')] },
    ]);
    expect(problems(transitive)).toBe('');
  });

  it('counts a command as a write', () => {
    const raw = one({ tools: ['read', 'command'], writeScope: [] }, sibling(['y/**']));
    expect(problems(raw)).toContain('overlap');
  });
});

describe('validatePlan: success', () => {
  it('orders the diamond into waves and lists what can run together', () => {
    const checked = validatePlan(diamond());
    if (!checked.ok) throw new Error(checked.problems.join('\n'));
    expect(checked.value.waves).toEqual([['a'], ['b', 'c'], ['d']]);
    expect(checked.value.order).toEqual(['a', 'b', 'c', 'd']);
    expect(checked.value.parallelPairs).toEqual([['b/agent-b', 'c/agent-c']]);
    expect(checked.value.plan.maxParallel).toBe(2);
    expect(checked.value.plan.stages[0]?.agents[0]?.isolation).toBe('none');
  });

  it('warns that a worktree agent in a later stage does not see uncommitted files', () => {
    const raw = plan([
      { id: 'p', agents: [agent({ name: 'a', writeScope: ['a/**'] })] },
      {
        id: 'q',
        dependsOn: ['p'],
        agents: [agent({ name: 'b', writeScope: ['b/**'], isolation: 'worktree' })],
      },
    ]);
    const checked = validatePlan(raw);
    expect(checked.ok && checked.value.warnings[0]).toContain('last commit');
  });

  it('describes the validated DAG for --dry-run', () => {
    const checked = validatePlan(diamond({ modelPools: { cheap: ['m1'] } }));
    if (!checked.ok) throw new Error('invalid');
    const text = describePlan(checked.value);
    expect(text).toContain('2. b + c (parallel)');
    expect(text).toContain('d (after b, c)');
    expect(text).toContain('agent-b: read,write; agent-b/**');
  });

  it('parses the failure policy', () => {
    expect(failurePolicy('stop')).toEqual({ mode: 'stop', retries: 0 });
    expect(failurePolicy('continue')).toEqual({ mode: 'continue', retries: 0 });
    expect(failurePolicy('retry:2')).toEqual({ mode: 'retry', retries: 2 });
  });
});
