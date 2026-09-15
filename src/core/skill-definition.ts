import { z } from 'zod';

import type { SkillDefinition } from './skill-definition.types';

/** A skill is named the way a command is: lowercase, hyphenated, no surprises. */
export const skillNameSchema = z.string().regex(/^[a-z][a-z0-9-]{1,63}$/u);

/** The placeholder that takes everything the user typed after the command. */
export const ALL_ARGUMENTS = '$ARGUMENTS';

const FRONTMATTER = /^---\r?\n([\s\S]*?)\r?\n---\r?\n?/u;

/**
 * Reads the `key: value` header a skill file may open with.
 *
 * Deliberately not a YAML parser. A skill file is workspace content, and a
 * full YAML parser is a large attack surface for a header that has three
 * fields. Anything it does not understand is left in the body rather than
 * guessed at, so a malformed header costs the header and not the skill.
 */
export function parseSkillFile(fileName: string, content: string): SkillDefinition | undefined {
  const derived = fileName.replace(/\.md$/u, '');
  const match = FRONTMATTER.exec(content);
  const body = match === null ? content : content.slice(match[0].length);
  const header = new Map<string, string>();
  for (const line of (match?.[1] ?? '').split(/\r?\n/u)) {
    const separator = line.indexOf(':');
    if (separator <= 0) continue;
    header.set(line.slice(0, separator).trim().toLowerCase(), line.slice(separator + 1).trim());
  }
  const name = skillNameSchema.safeParse(header.get('name') ?? derived);
  if (!name.success || body.trim().length === 0) return undefined;
  const description = header.get('description') ?? '';
  const argumentHint = header.get('argument-hint');
  return {
    name: name.data,
    description,
    ...(argumentHint === undefined || argumentHint.length === 0 ? {} : { argumentHint }),
    body: body.trim(),
  };
}

/**
 * The prompt a skill produces for the arguments it was given.
 *
 * `$1`…`$9` take one whitespace-separated argument each and `$ARGUMENTS` takes
 * the whole rest of the line. A placeholder with no argument becomes empty
 * rather than staying literal: a prompt containing `$3` would be asking the
 * model to reason about a placeholder the user never filled.
 *
 * A body with no placeholder at all gets the arguments appended, because a
 * skill that silently discarded what the user typed after it would look
 * broken in exactly the case where they bothered to type something.
 */
export function renderSkillPrompt(skill: SkillDefinition, argumentText: string): string {
  const trimmed = argumentText.trim();
  const positional = trimmed.length === 0 ? [] : trimmed.split(/\s+/u);
  const hasPlaceholder = /\$(?:ARGUMENTS|[1-9])/u.test(skill.body);
  const rendered = skill.body
    .replaceAll(ALL_ARGUMENTS, trimmed)
    .replaceAll(/\$([1-9])/gu, (_, index: string) => positional[Number(index) - 1] ?? '');
  if (hasPlaceholder || trimmed.length === 0) return rendered;
  return `${rendered}\n\n${trimmed}`;
}
