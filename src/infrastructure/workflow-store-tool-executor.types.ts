import type { SavedWorkflow } from '../core/saved-workflow';

/** Where saved workflows live, which is workspace content like any other. */
export interface WorkflowStorePort {
  list(): Promise<readonly SavedWorkflow[]>;
  read(name: string): Promise<SavedWorkflow | undefined>;
  write(workflow: SavedWorkflow): Promise<void>;
}
