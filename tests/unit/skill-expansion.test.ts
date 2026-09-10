import { describe, expect, it } from 'vitest';

import { SkillCatalogService } from '../../src/services/skill-catalog-service';
import { expandSkillPrompt } from '../../src/services/skill-expansion';

const skills = new SkillCatalogService({
  global: async () => [],
  project: async () => [
    { fileName: 'review.md', content: 'Review $ARGUMENTS for correctness.' },
    { fileName: 'audit.md', content: 'Audit the workspace.' },
  ],
});

describe('expandSkillPrompt', () => {
  it('expands a command into its prompt', async () => {
    expect(await expandSkillPrompt(skills, '/review src/app.ts')).toBe(
      'Review src/app.ts for correctness.',
    );
  });

  it('leaves an ordinary message alone', async () => {
    expect(await expandSkillPrompt(skills, 'Review src/app.ts')).toBe('Review src/app.ts');
  });

  it('leaves an unknown command alone rather than refusing to send it', async () => {
    expect(await expandSkillPrompt(skills, '/nothing here')).toBe('/nothing here');
  });

  it('appends arguments for a skill with no placeholder', async () => {
    expect(await expandSkillPrompt(skills, '/audit be strict')).toBe(
      'Audit the workspace.\n\nbe strict',
    );
  });

  it('expands a bare command with no arguments', async () => {
    expect(await expandSkillPrompt(skills, '/audit')).toBe('Audit the workspace.');
  });

  it('is not fooled by a path in the middle of a message', async () => {
    expect(await expandSkillPrompt(skills, 'look at src/review.md')).toBe('look at src/review.md');
  });
});
