import { describe, expect, it } from 'vitest';

import {
  buildWorkspaceScope,
  requireWorkspaceScopeCandidate,
  workspaceFolderKey,
} from '../../src/core/workspace-scope';

const folders = [
  { name: 'api', uri: 'file:///workspace/api' },
  { name: 'web', uri: 'file:///workspace/web' },
];

describe('workspace scope', () => {
  it('prefers the active editor folder until the user explicitly selects a scope', () => {
    const activeScope = buildWorkspaceScope(folders, undefined, folders[1]?.uri);
    const apiKey = workspaceFolderKey(folders[0]?.uri ?? '');

    expect(activeScope).toEqual({
      folders: [
        { key: apiKey, name: 'api' },
        { key: workspaceFolderKey(folders[1]?.uri ?? ''), name: 'web' },
      ],
      selectedFolderKey: workspaceFolderKey(folders[1]?.uri ?? ''),
      selectedFolderName: 'web',
    });
    expect(buildWorkspaceScope(folders, apiKey, folders[1]?.uri).selectedFolderName).toBe('api');
  });

  it('falls back to the first folder and represents an empty window without a fake scope', () => {
    expect(buildWorkspaceScope(folders, undefined, undefined).selectedFolderName).toBe('api');
    expect(buildWorkspaceScope([], undefined, undefined)).toEqual({
      folders: [],
    });
  });

  it('rejects arbitrary and stale folder keys instead of resolving them as paths', () => {
    expect(() => requireWorkspaceScopeCandidate(folders, 'file:///outside')).toThrow(
      'selected workspace folder is no longer available',
    );
    expect(
      requireWorkspaceScopeCandidate(folders, workspaceFolderKey(folders[1]?.uri ?? '')),
    ).toEqual(folders[1]);
  });
});
