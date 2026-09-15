import { describe, expect, it } from 'vitest';

import { parseSkillFile, renderSkillPrompt } from '../../src/core/skill-definition';

import type { SkillDefinition } from '../../src/core/skill-definition.types';

function skill(body: string, overrides: Partial<SkillDefinition> = {}): SkillDefinition {
  return { name: 'review', description: '', body, ...overrides };
}

describe('parseSkillFile', () => {
  it('names a skill after its file when there is no header', () => {
    expect(parseSkillFile('typescript.md', '# TypeScript\n\nUse strict mode.')?.name).toBe(
      'typescript',
    );
  });

  it('reads the header when there is one', () => {
    const parsed = parseSkillFile(
      'anything.md',
      '---\nname: code-review\ndescription: Review a diff\nargument-hint: <path>\n---\nReview it.',
    );

    expect(parsed).toEqual({
      name: 'code-review',
      description: 'Review a diff',
      argumentHint: '<path>',
      body: 'Review it.',
    });
  });

  it('keeps the body free of the header', () => {
    expect(parseSkillFile('doc.md', '---\nname: docs\n---\nBody here.')?.body).toBe('Body here.');
  });

  it('leaves an unparseable header line alone rather than guessing', () => {
    const parsed = parseSkillFile('doc.md', '---\nname: docs\nnot a pair\n---\nBody.');

    expect(parsed?.name).toBe('docs');
  });

  it('refuses a skill whose body is empty, since it would prompt nothing', () => {
    expect(parseSkillFile('doc.md', '---\nname: docs\n---\n   ')).toBeUndefined();
  });

  it('refuses a name that is not command-shaped', () => {
    expect(parseSkillFile('doc.md', '---\nname: Not A Command\n---\nBody.')).toBeUndefined();
  });

  it('refuses a file whose name is not command-shaped either', () => {
    expect(parseSkillFile('My Skill.md', 'Body.')).toBeUndefined();
  });
});

describe('renderSkillPrompt', () => {
  it('substitutes everything the user typed', () => {
    expect(renderSkillPrompt(skill('Review $ARGUMENTS please'), 'src/app.ts')).toBe(
      'Review src/app.ts please',
    );
  });

  it('substitutes positional arguments', () => {
    expect(renderSkillPrompt(skill('Compare $1 with $2'), 'a.ts b.ts')).toBe(
      'Compare a.ts with b.ts',
    );
  });

  it('empties a placeholder the user did not fill rather than leaving it literal', () => {
    expect(renderSkillPrompt(skill('Use $1 and $3'), 'only')).toBe('Use only and ');
  });

  it('appends arguments to a body that has no placeholder, rather than dropping them', () => {
    expect(renderSkillPrompt(skill('Review the diff.'), 'src/app.ts')).toBe(
      'Review the diff.\n\nsrc/app.ts',
    );
  });

  it('leaves a body alone when there is nothing to append', () => {
    expect(renderSkillPrompt(skill('Review the diff.'), '   ')).toBe('Review the diff.');
  });
});
