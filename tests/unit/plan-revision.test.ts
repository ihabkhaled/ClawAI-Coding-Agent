import { describe, expect, it } from 'vitest';

import { renderImplementationPlanMarkdown } from '../../src/core/implementation-plan';
import {
  assertPlanRevision,
  describePlanRevisionChange,
  embedPlanRevision,
  parsePlanDocument,
  planningInvocationRevision,
  planRevisionHash,
} from '../../src/core/plan-revision';
import { examplePlan as plan } from '../helpers/implementation-plan';

import type { ImplementationPlan } from '../../src/core/implementation-plan';

describe('planRevisionHash', () => {
  it('is a sha256 digest', () => {
    expect(planRevisionHash(plan())).toMatch(/^sha256:[a-f0-9]{64}$/u);
  });

  it('ignores the order a plan happens to carry its keys in', () => {
    const { goal, title, releases, ...rest } = plan();
    const reordered: ImplementationPlan = { releases, title, goal, ...rest };

    expect(planRevisionHash(reordered)).toBe(planRevisionHash(plan()));
  });

  it('changes when the plan changes', () => {
    expect(planRevisionHash(plan({ goal: 'Reach parity twice' }))).not.toBe(
      planRevisionHash(plan()),
    );
  });
});

describe('parsePlanDocument', () => {
  it('reads a plan back out of an edited Markdown export', () => {
    const document = embedPlanRevision(renderImplementationPlanMarkdown(plan()), plan());
    const edited = document.replace('Goal: Reach parity', 'Goal: Reach parity, my note here');

    expect(parsePlanDocument(edited)).toEqual({
      plan: plan(),
      revision: planRevisionHash(plan()),
    });
  });

  it('honours an edit made inside the embedded block', () => {
    const document = embedPlanRevision(renderImplementationPlanMarkdown(plan()), plan());
    const edited = document.replace('"Reach parity"', '"Reach parity now"');

    expect(parsePlanDocument(edited).plan.goal).toBe('Reach parity now');
  });

  it('reads a plan back out of a JSON export', () => {
    expect(parsePlanDocument(`${JSON.stringify(plan(), undefined, 2)}\n`).plan).toEqual(plan());
  });

  it('refuses a document that carries no plan', () => {
    expect(() => parsePlanDocument('# Just some notes\n')).toThrow(/No implementation plan/u);
  });

  it('refuses an embedded block edited into an invalid plan', () => {
    const document = embedPlanRevision(renderImplementationPlanMarkdown(plan()), plan());

    expect(() => parsePlanDocument(document.replace('"feature"', '"guesswork"'))).toThrow();
  });
});

describe('describePlanRevisionChange', () => {
  it('is new when nothing is bound yet', () => {
    expect(describePlanRevisionChange(undefined, 'sha256:a')).toBe('new');
  });

  it('is unchanged when the user edited only prose', () => {
    expect(describePlanRevisionChange('sha256:a', 'sha256:a')).toBe('unchanged');
  });

  it('is revised when the plan itself moved', () => {
    expect(describePlanRevisionChange('sha256:a', 'sha256:b')).toBe('revised');
  });
});

describe('assertPlanRevision', () => {
  it('allows a caller that names no revision', () => {
    expect(() => {
      assertPlanRevision('sha256:a', undefined);
    }).not.toThrow();
  });

  it('allows the bound revision', () => {
    expect(() => {
      assertPlanRevision('sha256:a', 'sha256:a');
    }).not.toThrow();
  });

  it('refuses a stale revision', () => {
    expect(() => {
      assertPlanRevision('sha256:a', 'sha256:b');
    }).toThrow(/stale/u);
  });

  it('refuses a revision when none has been recorded', () => {
    expect(() => {
      assertPlanRevision(undefined, 'sha256:a');
    }).toThrow(/No plan revision/u);
  });
});

describe('planningInvocationRevision', () => {
  const document = embedPlanRevision(renderImplementationPlanMarkdown(plan()), plan());

  it('hashes the plan an export is writing', () => {
    expect(planningInvocationRevision('export', { plan: plan() })).toBe(planRevisionHash(plan()));
  });

  it('reads the revision out of the document an adopt is handing back', () => {
    expect(planningInvocationRevision('adopt', { document })).toBe(planRevisionHash(plan()));
  });

  it('takes the revision another operation names', () => {
    const revision = `sha256:${'a'.repeat(64)}`;

    expect(planningInvocationRevision('issue-payloads', { revision })).toBe(revision);
  });

  it('has no revision for a call that names none', () => {
    expect(planningInvocationRevision('list-tasks', {})).toBeUndefined();
  });

  it('records nothing rather than throwing on a call the tool will reject', () => {
    expect(planningInvocationRevision('export', { plan: { nope: true } })).toBeUndefined();
    expect(planningInvocationRevision('adopt', { document: '# no plan here' })).toBeUndefined();
    expect(planningInvocationRevision('validate', { revision: 'not-a-hash' })).toBeUndefined();
  });
});
