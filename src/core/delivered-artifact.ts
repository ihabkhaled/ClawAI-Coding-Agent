import type { FileTransactionReceipt } from './file-transaction';

/**
 * A file the agent produced *for the user* rather than as a workspace edit.
 *
 * `fsPath` is carried alongside the workspace-relative `path` because the
 * whole point of the record is that something can open it later, and the view
 * that opens it has no root to resolve a relative path against.
 */
export interface DeliveredArtifact {
  readonly path: string;
  readonly fsPath: string;
}

/** The most recent deliveries kept; older ones fall off the end. */
export const MAX_DELIVERED_ARTIFACTS = 50;

/**
 * Reads the artifact writes out of an applied transaction receipt.
 *
 * A rolled-back or failed transaction delivers nothing: the file either never
 * existed or no longer does, and offering the user a link to it would be
 * offering a link to nothing.
 */
export function deliveredArtifactsFromReceipt(
  receipt: FileTransactionReceipt,
  resolveFsPath: (rootKey: string, path: string) => string | undefined,
): DeliveredArtifact[] {
  if (receipt.status !== 'applied') return [];
  const delivered: DeliveredArtifact[] = [];
  for (const touched of receipt.touched) {
    if (touched.operation !== 'artifact') continue;
    const fsPath = resolveFsPath(touched.rootKey, touched.path);
    if (fsPath === undefined) continue;
    delivered.push({ path: touched.path, fsPath });
  }
  return delivered;
}

/**
 * Newest first, one entry per path, bounded.
 *
 * Re-delivering the same path replaces the earlier entry rather than adding a
 * second: the file at that path is one artifact whose content changed, and two
 * rows pointing at one file would both open the same thing.
 */
export function mergeDeliveredArtifacts(
  existing: readonly DeliveredArtifact[],
  delivered: readonly DeliveredArtifact[],
): DeliveredArtifact[] {
  const merged: DeliveredArtifact[] = [];
  const seen = new Set<string>();
  for (const artifact of [...delivered].reverse().concat(existing)) {
    if (seen.has(artifact.path)) continue;
    seen.add(artifact.path);
    merged.push(artifact);
    if (merged.length >= MAX_DELIVERED_ARTIFACTS) break;
  }
  return merged;
}
