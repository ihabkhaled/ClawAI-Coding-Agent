import type { WorkflowTemplate } from '../core/workflow-template';

/** One row of the Run Saved Workflow picker: a saved graph or a template. */
export interface SavedWorkflowPick {
  readonly label: string;
  readonly description: string;
  readonly name: string;
  readonly template?: WorkflowTemplate;
}
