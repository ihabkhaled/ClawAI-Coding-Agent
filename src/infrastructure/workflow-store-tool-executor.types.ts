import type { SavedWorkflow } from '../core/saved-workflow';
import type { WorkflowTemplate } from '../core/workflow-template';

/** Whether a template was written, or refused because its file already exists. */
export type WorkflowTemplateWriteOutcome = 'saved' | 'exists';

/** Where saved workflows live, which is workspace content like any other. */
export interface WorkflowStorePort {
  list(): Promise<readonly SavedWorkflow[]>;
  read(name: string): Promise<SavedWorkflow | undefined>;
  write(workflow: SavedWorkflow): Promise<void>;
  /** Writes a template file; refuses an existing file unless `overwrite`. */
  writeTemplate(
    template: WorkflowTemplate,
    overwrite: boolean,
  ): Promise<WorkflowTemplateWriteOutcome>;
}
