import { z } from 'zod';

import {
  WORKFLOW_TEMPLATE_KIND,
  WORKFLOW_TEMPLATE_MAX_CHECKS,
  WORKFLOW_TEMPLATE_MAX_INSTRUCTION,
  WORKFLOW_TEMPLATE_MAX_REQUEST,
  WORKFLOW_TEMPLATE_MAX_REQUEST_PROMPT,
  WORKFLOW_TEMPLATE_MAX_STEP_LENGTH,
  WORKFLOW_TEMPLATE_MAX_STEPS,
} from './workflow-template.constants';

/**
 * A workflow kind a person defines for their own project.
 *
 * The seven built-in kinds (audit, docs, fix, generate, plan, review, tests)
 * are prompt templates this repository wrote. A template file in
 * `.clawai/workflows` is the same idea written by the people who work on the
 * code: an instruction, optional ordered steps, and the checks that decide when
 * it is done. It sits beside saved agent graphs and is told apart by `kind`,
 * so the graph loader keeps refusing it and it can never be run as a graph.
 */
export const workflowTemplateSchema = z
  .object({
    kind: z.literal(WORKFLOW_TEMPLATE_KIND),
    name: z.string().trim().min(1).max(80),
    description: z.string().trim().min(1).max(500),
    instruction: z.string().trim().min(1).max(WORKFLOW_TEMPLATE_MAX_INSTRUCTION),
    steps: z
      .array(z.string().trim().min(1).max(WORKFLOW_TEMPLATE_MAX_STEP_LENGTH))
      .max(WORKFLOW_TEMPLATE_MAX_STEPS)
      .default([]),
    acceptanceChecks: z
      .array(z.string().trim().min(1).max(2_000))
      .max(WORKFLOW_TEMPLATE_MAX_CHECKS)
      .default([]),
    requestPrompt: z.string().trim().min(1).max(WORKFLOW_TEMPLATE_MAX_REQUEST_PROMPT).optional(),
  })
  .strict();

export type WorkflowTemplate = z.infer<typeof workflowTemplateSchema>;

/**
 * What `runtime.workflows` `save-template` takes: a template without its
 * `kind` (the tool supplies it), plus whether an existing file may be
 * replaced. Replacing is off unless asked, because the file may be one a
 * person wrote by hand.
 */
export const workflowTemplateSaveSchema = workflowTemplateSchema
  .omit({ kind: true })
  .extend({ overwrite: z.boolean().default(false) });

function numbered(title: string, lines: readonly string[]): string[] {
  if (lines.length === 0) return [];
  return [title, ...lines.map((line, index) => `${String(index + 1)}. ${line}`)];
}

/**
 * The agent request that runs a template. The person picked the template and
 * typed the request, so both are their instruction; the steps and checks keep
 * the order and the finish line the template's author wrote down.
 */
export function workflowTemplateRunPrompt(template: WorkflowTemplate, request?: string): string {
  const trimmed = request?.trim().slice(0, WORKFLOW_TEMPLATE_MAX_REQUEST) ?? '';
  return [
    `Run the workflow "${template.name}" from .clawai/workflows.`,
    template.instruction,
    ...numbered('Follow these steps in order:', template.steps),
    ...numbered(
      'Do not report the workflow as done until each check holds, with evidence:',
      template.acceptanceChecks,
    ),
    ...(trimmed.length === 0 ? [] : [`Request: ${trimmed}`]),
  ].join('\n');
}
