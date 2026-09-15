import { z } from 'zod';

/**
 * Named, persisted sub-agent presets.
 *
 * A `SubAgentTask` (`multi-agent-dag.ts`) already carries every runtime
 * parameter a fork needs — goal, tools, model policy, budget, risk ceiling —
 * supplied fresh by the model on every graph. What it cannot carry is an
 * identity an author defines once and reuses: a reviewer with a house style,
 * a documenter with a fixed audience, a security reviewer with a standing
 * checklist. This is that identity. A task optionally names one by
 * `definitionName`; `RuntimeSubAgentExecutor` resolves it and prepends its
 * `systemPrompt` to the sub-agent's own prompt. Everything the task already
 * supplies — tools, model, budget — still comes from the task, unchanged: a
 * definition only ever adds instructions, never a runtime parameter, so it
 * cannot be used to smuggle a wider grant than the task itself declares.
 */
export const subAgentDefinitionNameSchema = z.string().regex(/^[a-z][a-z0-9-]{1,79}$/u);

export const subAgentDefinitionSchema = z
  .object({
    name: subAgentDefinitionNameSchema,
    description: z.string().min(1).max(2_000),
    systemPrompt: z.string().min(1).max(20_000),
  })
  .strict();

export type SubAgentDefinition = z.infer<typeof subAgentDefinitionSchema>;

export const subAgentDefinitionsFileSchema = z
  .array(subAgentDefinitionSchema)
  .max(200)
  .superRefine((definitions, context) => {
    const names = new Set<string>();
    for (const definition of definitions) {
      if (names.has(definition.name)) {
        context.addIssue({
          code: 'custom',
          message: `Duplicate sub-agent definition: ${definition.name}`,
        });
      }
      names.add(definition.name);
    }
  });

/** Pure exact-name lookup: an unresolved name is silently absent, never guessed. */
export function resolveSubAgentDefinition(
  definitions: readonly SubAgentDefinition[],
  definitionName: string | undefined,
): SubAgentDefinition | undefined {
  if (definitionName === undefined) return undefined;
  return definitions.find((definition) => definition.name === definitionName);
}
