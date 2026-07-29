import { realpath } from 'node:fs/promises';
import path from 'node:path';

export function resolveCanonicalWorkspacePath(workspacePath: string): Promise<string> {
  return realpath(workspacePath);
}

export async function isRealPathInsideWorkspace(
  canonicalWorkspacePath: string,
  candidatePath: string,
  resolveParent = false,
): Promise<boolean> {
  const pathToResolve = resolveParent ? path.dirname(candidatePath) : candidatePath;
  const resolvedCandidate = await nearestExistingRealpath(pathToResolve);
  const relative = path.relative(canonicalWorkspacePath, resolvedCandidate);
  return relative !== '..' && !relative.startsWith(`..${path.sep}`) && !path.isAbsolute(relative);
}

async function nearestExistingRealpath(candidatePath: string): Promise<string> {
  let current = candidatePath;
  for (;;) {
    try {
      return await realpath(current);
    } catch (error: unknown) {
      if (!isMissingPathError(error)) {
        throw error;
      }
      const parent = path.dirname(current);
      if (parent === current) {
        throw error;
      }
      current = parent;
    }
  }
}

function isMissingPathError(error: unknown): boolean {
  if (!(error instanceof Error) || !('code' in error)) {
    return false;
  }
  return error.code === 'ENOENT' || error.code === 'ENOTDIR';
}
