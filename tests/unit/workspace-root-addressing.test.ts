import { describe, expect, it } from 'vitest';

import {
  isSafeRelativeWorkspacePath,
  isSafeWorkspaceDirectoryPath,
  normalizeWorkspaceDirectoryPath,
  WORKSPACE_ROOT_PATH,
} from '../../src/core/workspace-path-policy';
import {
  advertisedWorkspaceRootIndex,
  advertisedWorkspaceRootKey,
} from '../../src/core/workspace-scope';

// Together these two defects made "gain context on this workspace" impossible.
// A run captured against the live backend showed the model calling
// workspace.files/list with {rootKey:"workspace", path:""} and the tool failing
// in 1ms — before any disk access — then retrying and stranding the run.
describe('addressing the workspace root', () => {
  it('accepts every spelling a model uses for the root', () => {
    // None of these could be expressed before: '' is empty, '.' trips the
    // trailing-dot rule, './' normalizes to empty and '/' is absolute. With no
    // value meaning "the root", an agent could not list the top level, and so
    // could not discover a subdirectory name to list instead.
    for (const alias of ['', '.', './', '/', '\\', '  .  ']) {
      expect(isSafeWorkspaceDirectoryPath(alias)).toBe(true);
      expect(normalizeWorkspaceDirectoryPath(alias)).toBe(WORKSPACE_ROOT_PATH);
    }
  });

  it('still accepts an ordinary relative directory', () => {
    expect(isSafeWorkspaceDirectoryPath('src/core')).toBe(true);
    expect(normalizeWorkspaceDirectoryPath('./src/core')).toBe('src/core');
  });

  it('keeps every containment and secrecy rule for non-root paths', () => {
    for (const unsafe of ['../outside', 'src/../../etc', 'C:/Windows', '/etc/passwd', '.env']) {
      expect(isSafeWorkspaceDirectoryPath(unsafe)).toBe(false);
    }
    // .git and friends stay denied even though they name a directory.
    expect(isSafeWorkspaceDirectoryPath('.git')).toBe(false);
    expect(isSafeWorkspaceDirectoryPath('config/secret')).toBe(false);
  });

  it('leaves the stricter file rule alone', () => {
    // Reads and mutations must not gain the root as a target: "write to the
    // root" is never a meaningful request.
    expect(isSafeRelativeWorkspacePath('')).toBe(false);
    expect(isSafeRelativeWorkspacePath('.')).toBe(false);
    expect(isSafeRelativeWorkspacePath('src/index.ts')).toBe(true);
  });
});

describe('advertised workspace root keys', () => {
  it('round-trips the key a runtime target advertises', () => {
    expect(advertisedWorkspaceRootKey(0)).toBe('workspace-1');
    expect(advertisedWorkspaceRootKey(2)).toBe('workspace-3');
    expect(advertisedWorkspaceRootIndex('workspace-1')).toBe(0);
    expect(advertisedWorkspaceRootIndex('workspace-3')).toBe(2);
  });

  it('rejects a near miss instead of resolving it to the first folder', () => {
    // The manifest advertised workspace-1 while the filesystem adapter resolved
    // only the SHA-256 folder key, so the advertised value was never approved.
    // Reconciling them must not become "anything vaguely workspace-shaped wins":
    // silently mapping a wrong key onto folder 0 would let a multi-root
    // workspace read the wrong tree.
    for (const key of ['workspace', 'workspace-', 'workspace-0', 'workspace-01', 'workspace-1x']) {
      expect(advertisedWorkspaceRootIndex(key)).toBeUndefined();
    }
  });
});
