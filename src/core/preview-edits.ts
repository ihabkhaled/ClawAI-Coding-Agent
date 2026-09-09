import type { EditPlan } from './edit-plan';

/** The content a reviewer left in the preview, keyed by the file's path. */
export type PreviewEdits = ReadonlyMap<string, string>;

/**
 * Folds a reviewer's edits back into the plan they were reviewing.
 *
 * Only `content` is replaced. The path, the operation and the root are the
 * shape of the change the user approved, and letting an edit in the right-hand
 * pane move a file or turn an update into a delete would mean the plan applied
 * was not the plan reviewed — which is the property the whole preview exists
 * to provide.
 *
 * A delete has no content to edit, so an edit against one is ignored rather
 * than turned into a write.
 */
export function applyPreviewEdits(plan: EditPlan, edits: PreviewEdits): EditPlan {
  if (edits.size === 0) return plan;
  return {
    ...plan,
    files: plan.files.map((file) => {
      const edited = edits.get(file.path);
      if (edited === undefined || file.operation === 'delete') return file;
      if (edited === file.content) return file;
      return { ...file, content: edited };
    }),
  };
}

/**
 * Which files a reviewer actually changed, for the record shown after the fact.
 *
 * Compared against the proposal rather than tracked as the user types: a file
 * edited and then edited back is not a change, and reporting it as one would
 * make the count untrustworthy in the one direction that matters.
 */
export function editedPreviewPaths(plan: EditPlan, edits: PreviewEdits): string[] {
  return plan.files
    .filter(
      (file) =>
        file.operation !== 'delete' &&
        edits.has(file.path) &&
        edits.get(file.path) !== file.content,
    )
    .map((file) => file.path);
}
