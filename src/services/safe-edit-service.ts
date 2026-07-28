import type { EditPlan, WorkspaceCommand } from '../core/edit-plan';

export interface EditPreview {
  path: string;
  before: string | null;
  after: string | null;
}

export interface WorkspaceEditPort {
  execute?(
    command: WorkspaceCommand,
    signal: AbortSignal,
  ): Promise<{ exitCode: number | undefined }>;
  isTrusted(): boolean;
  preview(plan: EditPlan): Promise<EditPreview[]>;
  applyAtomically(plan: EditPlan): Promise<boolean>;
}

export interface SafeEditResult {
  applied: boolean;
  previews: EditPreview[];
}

export class SafeEditService {
  constructor(
    private readonly workspace: WorkspaceEditPort,
    private readonly confirm: (previews: EditPreview[], summary: string) => Promise<boolean>,
  ) {}

  async previewAndApply(plan: EditPlan): Promise<SafeEditResult> {
    if (!this.workspace.isTrusted()) {
      throw new Error('Trust this workspace before applying ClawAI changes.');
    }
    const previews = await this.workspace.preview(plan);
    const approved = await this.confirm(previews, plan.summary);
    if (!approved) {
      return {
        applied: false,
        previews,
      };
    }
    if (!this.workspace.isTrusted()) {
      throw new Error('Workspace trust changed before the edit could be applied.');
    }
    const applied = await this.workspace.applyAtomically(plan);
    return {
      applied,
      previews,
    };
  }

  execute(
    command: WorkspaceCommand,
    signal: AbortSignal,
  ): Promise<{ exitCode: number | undefined }> {
    if (this.workspace.execute === undefined) {
      throw new Error('ClawAI command execution is unavailable.');
    }
    return this.workspace.execute(command, signal);
  }
}
