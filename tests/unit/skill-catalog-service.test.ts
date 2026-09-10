import { describe, expect, it } from 'vitest';

import { SkillCatalogService } from '../../src/services/skill-catalog-service';

import type { SkillFile } from '../../src/services/skill-catalog.types';

function catalog(global: SkillFile[] = [], project: SkillFile[] = []): SkillCatalogService {
  return new SkillCatalogService({
    global: async () => global,
    project: async () => project,
  });
}

describe('SkillCatalogService', () => {
  it('offers nothing when there are no skill files', async () => {
    expect(await catalog().list()).toEqual([]);
  });

  it('reads a project skill', async () => {
    const skills = await catalog([], [{ fileName: 'review.md', content: 'Review it.' }]).list();

    expect(skills.map(({ name }) => name)).toEqual(['review']);
  });

  it('lets a project skill win over a profile-wide one of the same name', async () => {
    const skills = await catalog(
      [{ fileName: 'review.md', content: 'Global review.' }],
      [{ fileName: 'review.md', content: 'Project review.' }],
    ).list();

    expect(skills).toHaveLength(1);
    expect(skills[0]?.body).toBe('Project review.');
  });

  it('keeps a global skill the project does not override', async () => {
    const skills = await catalog(
      [{ fileName: 'audit.md', content: 'Audit it.' }],
      [{ fileName: 'review.md', content: 'Review it.' }],
    ).list();

    expect(skills.map(({ name }) => name)).toEqual(['audit', 'review']);
  });

  it('skips a file that does not parse rather than failing the catalog', async () => {
    const skills = await catalog(
      [],
      [
        { fileName: 'review.md', content: 'Review it.' },
        { fileName: 'half-written.md', content: '   ' },
      ],
    ).list();

    expect(skills.map(({ name }) => name)).toEqual(['review']);
  });

  it('sorts by name so the list does not reshuffle between reads', async () => {
    const skills = await catalog(
      [],
      [
        { fileName: 'zebra.md', content: 'Z.' },
        { fileName: 'alpha.md', content: 'A.' },
      ],
    ).list();

    expect(skills.map(({ name }) => name)).toEqual(['alpha', 'zebra']);
  });

  it('finds one skill by name', async () => {
    const found = await catalog([], [{ fileName: 'review.md', content: 'Review it.' }]).find(
      'review',
    );

    expect(found?.body).toBe('Review it.');
  });

  it('finds nothing for a name nobody defined', async () => {
    expect(await catalog().find('missing')).toBeUndefined();
  });
});
