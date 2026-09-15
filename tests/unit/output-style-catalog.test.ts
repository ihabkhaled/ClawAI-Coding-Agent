import { describe, expect, it } from 'vitest';

import { OutputStyleCatalog } from '../../src/services/output-style-catalog';

import type { SkillFile } from '../../src/services/skill-catalog.types';

function catalog(global: SkillFile[] = [], project: SkillFile[] = []): OutputStyleCatalog {
  return new OutputStyleCatalog({ global: async () => global, project: async () => project });
}

describe('OutputStyleCatalog', () => {
  it('offers nothing when no styles are defined', async () => {
    expect(await catalog().list()).toEqual([]);
  });

  it('reads a style file as a named preamble', async () => {
    const styles = await catalog(
      [],
      [{ fileName: 'house.md', content: 'Follow the house style.' }],
    ).list();

    expect(styles).toEqual([{ name: 'house', preamble: 'Follow the house style.' }]);
  });

  it('reads the name from a header when there is one', async () => {
    const styles = await catalog(
      [],
      [{ fileName: 'anything.md', content: '---\nname: house-style\n---\nBe formal.' }],
    ).list();

    expect(styles[0]?.name).toBe('house-style');
  });

  it('lets a project style win over a profile-wide one', async () => {
    const styles = await catalog(
      [{ fileName: 'concise.md', content: 'Global concise.' }],
      [{ fileName: 'concise.md', content: 'Project concise.' }],
    ).list();

    expect(styles).toEqual([{ name: 'concise', preamble: 'Project concise.' }]);
  });

  it('skips a file that does not parse rather than failing the catalog', async () => {
    const styles = await catalog(
      [],
      [
        { fileName: 'house.md', content: 'Be formal.' },
        { fileName: 'empty.md', content: '   ' },
      ],
    ).list();

    expect(styles.map(({ name }) => name)).toEqual(['house']);
  });
});
