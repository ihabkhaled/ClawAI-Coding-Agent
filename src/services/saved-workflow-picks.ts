import type { SavedWorkflowPick } from './saved-workflow-picks.types';
import type { SavedWorkflow } from '../core/saved-workflow';
import type { WorkflowTemplate } from '../core/workflow-template';

/**
 * Saved graphs and user-defined templates in one picker. The icon, not a word,
 * tells them apart, so the list needs no text of its own to translate.
 */
export function savedWorkflowPicks(
  workflows: readonly SavedWorkflow[],
  templates: readonly WorkflowTemplate[],
): readonly SavedWorkflowPick[] {
  return [
    ...workflows.map((workflow) => ({
      label: `$(type-hierarchy) ${workflow.name}`,
      description: workflow.description,
      name: workflow.name,
    })),
    ...templates.map((template) => ({
      label: `$(list-ordered) ${template.name}`,
      description: template.description,
      name: template.name,
      template,
    })),
  ];
}
