import { renderSkillPrompt } from '../core/skill-definition';
import { parseSlashInvocation } from '../core/slash-command';

import type { SkillCatalogService } from './skill-catalog-service';

/**
 * The prompt to actually send for what the user typed.
 *
 * A message that is not a command comes back unchanged, and so does a command
 * nobody defined. Refusing an unknown command would make a message beginning
 * with a slash unsendable, and the user may simply have meant the words.
 *
 * Expansion happens once, here, before the prompt reaches any transport. Doing
 * it deeper would mean every path that sends a prompt had to remember to, and
 * one of them would forget.
 */
export async function expandSkillPrompt(
  skills: SkillCatalogService,
  content: string,
): Promise<string> {
  const invocation = parseSlashInvocation(content.trim());
  if (invocation === undefined) return content;
  const skill = await skills.find(invocation.name);
  return skill === undefined ? content : renderSkillPrompt(skill, invocation.argumentText);
}
