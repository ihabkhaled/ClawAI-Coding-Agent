import * as vscode from 'vscode';

import { BUILT_IN_SKILLS } from '../core/built-in-skills.constants';

import type { SkillDefinition } from '../core/skill-definition.types';

/**
 * The built-in skills with their descriptions in the editor's language.
 *
 * The definitions live in `core`, which does not import `vscode`, so the
 * translation happens here at the edge. Each description is a literal inside
 * `vscode.l10n.t` because the locale generator finds messages by scanning for
 * that call; a key built at run time would never be translated. Only the
 * description is localised: the name is the slash command a user types, and
 * the body is the instruction the model follows.
 */
export function localizedBuiltInSkills(
  skills: readonly SkillDefinition[] = BUILT_IN_SKILLS,
): readonly SkillDefinition[] {
  const descriptions: Readonly<Record<string, string>> = {
    'security-review': vscode.l10n.t(
      'Review the pending change for security issues and scan dependencies',
    ),
  };
  return skills.map((skill) => ({
    ...skill,
    description: descriptions[skill.name] ?? skill.description,
  }));
}
