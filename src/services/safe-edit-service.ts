import { applyPreviewEdits, type PreviewEdits } from '../core/preview-edits';
import { WorkspaceMutationGate } from '../core/workspace-mutation-gate';

import { assertSmallPatchIsNonDestructive, parseSmallPatchPolicy } from './small-patch-safety';

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
  /** Corrections the reviewer made in the preview, keyed by path. */
  edits?: PreviewEdits;
}

function confirmationResult(confirmation: boolean | EditConfirmation): {
  approved: boolean;
  previewId?: string;
  edits: PreviewEdits;
} {
  return typeof confirmation === 'boolean'
    ? { approved: confirmation, edits: new Map() }
    : {
        approved: confirmation.approved,
        previewId: confirmation.previewId,
        edits: confirmation.edits ?? new Map(),
      };
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
    prompt = '',
  ): Promise<SafeEditResult> {
    const operationSignal = signal ?? new AbortController().signal;
    return this.mutationGate.runExclusive(operationSignal, () =>
      this.previewAndApplyExclusive(plan, signal, session, prompt),
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
    prompt = '',
  ): Promise<SafeEditResult> {
    signal?.throwIfAborted();
    if (!this.workspace.isTrusted()) {
      throw new Error('Trust this workspace before applying ClawAI changes.');
    }
    const review = await this.workspace.preview(plan);
    const { previews } = review;
    const policy = parseSmallPatchPolicy(prompt);
    for (const preview of previews) {
      assertSmallPatchIsNonDestructive(preview.before, preview.after, preview.path, policy);
    }
    signal?.throwIfAborted();
    const confirmation = await this.confirm(previews, plan.summary, session, signal);
    signal?.throwIfAborted();
    const { approved, previewId, edits } = confirmationResult(confirmation);
    if (!approved) {
      return editResult(false, previews, previewId);
    }
    if (!this.workspace.isTrusted()) {
      throw new Error('Workspace trust changed before the edit could be applied.');
    }
    signal?.throwIfAborted();
    // Corrections made in the right-hand pane are folded in here, after the
    // approval and before the write: the approval was of what is on screen,
    // and what is on screen is what the reviewer edited.
    const edited = applyPreviewEdits(plan, edits);
    const review2 = edited === plan ? review : await this.workspace.preview(edited);
    const applied = await this.workspace.applyAtomically(edited, review2, signal);
    return editResult(applied, review2.previews, previewId);
  }
}
