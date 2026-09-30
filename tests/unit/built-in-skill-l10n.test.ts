import { readFileSync } from 'node:fs';
import { join } from 'node:path';

import { describe, expect, it, vi } from 'vitest';

const translate = vi.hoisted(() => vi.fn((message: string) => message));

vi.mock('vscode', () => ({ l10n: { t: translate } }));

import { BUILT_IN_SKILLS } from '../../src/core/built-in-skills.constants';
import { localizedBuiltInSkills } from '../../src/services/built-in-skill-l10n';

const LOCALES = ['ar', 'de', 'es', 'fa', 'fr', 'hi', 'it', 'ja', 'pt', 'ru', 'th', 'zh'];

function bundle(locale: string): Readonly<Record<string, string>> {
  const parsed: Record<string, string> = JSON.parse(
    readFileSync(join(__dirname, '..', '..', 'l10n', `bundle.l10n.${locale}.json`), 'utf8'),
  );
  return parsed;
}

describe('built-in skill descriptions', () => {
  it('uses the English description as the l10n key, so the two cannot drift', () => {
    translate.mockImplementation((message: string) => message);

    expect(localizedBuiltInSkills()).toEqual(BUILT_IN_SKILLS);
  });

  it('localises the description and leaves the name and body alone', () => {
    translate.mockImplementation((message: string) => `[de] ${message}`);

    const [review] = localizedBuiltInSkills();
    const [original] = BUILT_IN_SKILLS;

    expect(review?.description).toBe(`[de] ${original?.description ?? ''}`);
    expect(review?.name).toBe('security-review');
    expect(review?.body).toBe(original?.body);
  });

  it('keeps the English description for a built-in skill with no translation entry', () => {
    translate.mockImplementation((message: string) => `[x] ${message}`);
    const unknown = { name: 'not-a-built-in', description: 'Plain English', body: 'b' };

    expect(localizedBuiltInSkills([unknown])[0]?.description).toBe('Plain English');
  });

  it.each(LOCALES)('ships a real %s translation of every built-in description', (locale) => {
    const messages = bundle(locale);
    for (const skill of BUILT_IN_SKILLS) {
      const translated = messages[skill.description];
      expect(translated).toBeDefined();
      expect(translated).not.toBe(skill.description);
    }
  });
});
