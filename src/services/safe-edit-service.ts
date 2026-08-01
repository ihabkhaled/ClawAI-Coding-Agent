import { WorkspaceMutationGate } from '../core/workspace-mutation-gate';

import type { SessionControlPort } from './session-control.types';
import type { EditPlan, WorkspaceCommand } from '../core/edit-plan';

export interface EditPreview {
  path: string;
  rootKey?: string;
  rootUri?: string;
  before: string | null;
  after: string | null;
}

export interface EditReview {
  workspaceFolderUri: string;
  previews: EditPreview[];
}

export interface WorkspaceEditPort {
  execute?(
    command: WorkspaceCommand,
    signal: AbortSignal,
  ): Promise<{ exitCode: number | undefined }>;
  isTrusted(): boolean;
  preview(plan: EditPlan): Promise<EditReview>;
  applyAtomically(plan: EditPlan, review: EditReview, signal?: AbortSignal): Promise<boolean>;
  undoLast?(): Promise<boolean>;
}

export interface SafeEditResult {
  applied: boolean;
  previewId?: string;
  previews: EditPreview[];
}

export interface EditConfirmation {
  approved: boolean;
  previewId: string;
}

function confirmationResult(confirmation: boolean | EditConfirmation): {
  approved: boolean;
  previewId?: string;
} {
  return typeof confirmation === 'boolean'
    ? { approved: confirmation }
    : { approved: confirmation.approved, previewId: confirmation.previewId };
}

function editResult(applied: boolean, previews: EditPreview[], previewId?: string): SafeEditResult {
  return {
    applied,
    ...(previewId === undefined ? {} : { previewId }),
    previews,
  };
}

export class SafeEditService {
  constructor(
    private readonly workspace: WorkspaceEditPort,
    private readonly confirm: (
      previews: EditPreview[],
      summary: string,
      session?: SessionControlPort,
      signal?: AbortSignal,
    ) => Promise<boolean | EditConfirmation>,
    private readonly mutationGate = new WorkspaceMutationGate(),
  ) {}

  async previewAndApply(
    plan: EditPlan,
    signal?: AbortSignal,
    session?: SessionControlPort,
  ): Promise<SafeEditResult> {
    const operationSignal = signal ?? new AbortController().signal;
    return this.mutationGate.runExclusive(operationSignal, () =>
      this.previewAndApplyExclusive(plan, signal, session),
    );
  }

  execute(
    command: WorkspaceCommand,
    signal: AbortSignal,
  ): Promise<{ exitCode: number | undefined }> {
    return this.mutationGate.runExclusive(signal, () => {
      if (this.workspace.execute === undefined) {
        throw new Error('ClawAI command execution is unavailable.');
      }
      return this.workspace.execute(command, signal);
    });
  }

  undoLast(signal?: AbortSignal): Promise<boolean> {
    const operationSignal = signal ?? new AbortController().signal;
    return this.mutationGate.runExclusive(
      operationSignal,
      () => this.workspace.undoLast?.() ?? Promise.resolve(false),
    );
  }

  private async previewAndApplyExclusive(
    plan: EditPlan,
    signal?: AbortSignal,
    session?: SessionControlPort,
  ): Promise<SafeEditResult> {
    signal?.throwIfAborted();
    if (!this.workspace.isTrusted()) {
      throw new Error('Trust this workspace before applying ClawAI changes.');
    }
    const review = await this.workspace.preview(plan);
    const { previews } = review;
    signal?.throwIfAborted();
    const confirmation = await this.confirm(previews, plan.summary, session, signal);
    signal?.throwIfAborted();
    const { approved, previewId } = confirmationResult(confirmation);
    if (!approved) {
      return editResult(false, previews, previewId);
    }
    if (!this.workspace.isTrusted()) {
      throw new Error('Workspace trust changed before the edit could be applied.');
    }
    signal?.throwIfAborted();
    const applied = await this.workspace.applyAtomically(plan, review, signal);
    return editResult(applied, previews, previewId);
  }
}
