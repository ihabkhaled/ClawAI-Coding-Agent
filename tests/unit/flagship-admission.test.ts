import { describe, expect, it } from 'vitest';

import { flagshipAdmission, withFlagshipRequirement } from '../../src/core/flagship-admission';

const flagshipDefinition = {
  name: 'runtime.flagship',
  description: 'Execute a bounded evidence-first delivery.',
};
const filesDefinition = { name: 'workspace.files', description: 'Read and write workspace files.' };

describe('flagship admission', () => {
  it('admits a brief that enumerates several deliverables', () => {
    const admission = flagshipAdmission(
      [
        'Do all of the following.',
        '1. Rework the install prompt.',
        '2. Split profile from settings.',
        '3. Fix the plan card spacing.',
      ].join('\n'),
    );

    expect(admission.admit).toBe(true);
    expect(admission.enumeratedParts).toBe(3);
    expect(admission.reason).toContain('3');
  });

  it('admits the PART heading style a brief often uses', () => {
    const admission = flagshipAdmission(
      ['PART 1 — the panel', 'some prose', 'PART 2 — the page', 'PART 3 — the gates'].join('\n'),
    );

    expect(admission.admit).toBe(true);
    expect(admission.enumeratedParts).toBe(3);
  });

  it('refuses a single request however long the prose', () => {
    const admission = flagshipAdmission(
      `Fix the login redirect. ${'It has been broken since the last release. '.repeat(200)}`,
    );

    expect(admission.admit).toBe(false);
    expect(admission.enumeratedParts).toBe(0);
  });

  // A bullet list usually breaks one deliverable into steps. Counting bullets
  // would send every carefully written single request through the planner.
  it('does not treat the sub-points of one change as separate deliverables', () => {
    const admission = flagshipAdmission(
      [
        'Rename the field, keeping behaviour identical:',
        '- update the DTO',
        '- update the service',
        '- update the tests',
        '- update the docs',
      ].join('\n'),
    );

    expect(admission.admit).toBe(false);
  });

  it('refuses two deliverables, which are cheaper done in sequence', () => {
    const admission = flagshipAdmission(['1. Fix the panel.', '2. Fix the card.'].join('\n'));

    expect(admission.admit).toBe(false);
    expect(admission.enumeratedParts).toBe(2);
  });

  it('ignores an enumerator that appears mid sentence', () => {
    const admission = flagshipAdmission(
      'The regression landed in 1. of the spec, see 2. and 3. for context.',
    );

    expect(admission.admit).toBe(false);
  });

  it('states the requirement on the flagship tool and leaves other tools alone', () => {
    const admission = flagshipAdmission(['1. one', '2. two', '3. three'].join('\n'));

    const [flagship, files] = withFlagshipRequirement(
      [flagshipDefinition, filesDefinition],
      admission,
    );

    expect(flagship?.description).toContain('REQUIRED FOR THIS REQUEST');
    expect(flagship?.description).toContain('Execute a bounded evidence-first delivery.');
    expect(files).toEqual(filesDefinition);
  });

  it('leaves the catalog untouched when the brief is not admitted', () => {
    const definitions = [flagshipDefinition, filesDefinition];

    expect(withFlagshipRequirement(definitions, flagshipAdmission('Fix one thing.'))).toEqual(
      definitions,
    );
  });
});
