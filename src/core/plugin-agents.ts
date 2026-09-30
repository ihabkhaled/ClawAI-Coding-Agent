import { parseSkillFile } from './skill-definition';
import { subAgentDefinitionSchema } from './sub-agent-definitions';

import type { PluginAgentFile } from './plugin-agents.types';
import type { SubAgentDefinition } from './sub-agent-definitions';

/**
 * A plugin agent file as a sub-agent definition.
 *
 * The file reads like a skill: an optional `name:`/`description:` header and
 * a body. The body becomes the definition's system prompt. A definition only
 * adds instructions, never tools, model or budget, so a plugin agent cannot
 * widen what the task that names it was granted.
 */
export function pluginAgentDefinition(file: PluginAgentFile): SubAgentDefinition | undefined {
  const parsed = parseSkillFile(file.fileName, file.content);
  if (parsed === undefined) return undefined;
  const description =
    parsed.description.length > 0 ? parsed.description : `Agent from plugin ${file.pluginId}`;
  return subAgentDefinitionSchema.safeParse({
    name: parsed.name,
    description,
    systemPrompt: parsed.body,
  }).data;
}

/**
 * The project's own definitions, then plugin ones under names still free.
 *
 * A plugin adds agents; it does not replace one the project defined. Between
 * plugins the first one read wins, and plugins are read in id order.
 */
export function mergeSubAgentDefinitions(
  own: readonly SubAgentDefinition[],
  fromPlugins: readonly SubAgentDefinition[],
): SubAgentDefinition[] {
  const names = new Set(own.map((definition) => definition.name));
  const merged = [...own];
  for (const definition of fromPlugins) {
    if (names.has(definition.name)) continue;
    names.add(definition.name);
    merged.push(definition);
  }
  return merged;
}
