import { describe, expect, it } from 'vitest';

import { dropInsertion, resolveDrop } from '../../src/core/attachment-drop';

const ROOT = '/home/dev/project';

function drop(uriList: string, shiftKey = false) {
  return resolveDrop({ uriList, hasFiles: false, shiftKey }, ROOT);
}

describe('resolveDrop', () => {
  it('treats a drag carrying real file data as an attachment, as it always did', () => {
    expect(resolveDrop({ uriList: '', hasFiles: true, shiftKey: false }, ROOT)).toEqual({
      intent: 'attach',
      paths: [],
      refused: [],
    });
  });

  it('mentions a file dragged from the explorer', () => {
    expect(drop('file:///home/dev/project/src/app.ts')).toEqual({
      intent: 'mention',
      paths: ['src/app.ts'],
      refused: [],
    });
  });

  it('inserts the path only when Shift is held', () => {
    expect(drop('file:///home/dev/project/src/app.ts', true).intent).toBe('path-only');
  });

  it('decodes a percent-escaped path rather than mentioning a name nobody has', () => {
    expect(drop('file:///home/dev/project/src/my%20file.ts').paths).toEqual(['src/my file.ts']);
  });

  it('refuses a file outside the open folder', () => {
    const resolution = drop('file:///etc/passwd');

    expect(resolution.intent).toBe('ignore');
    expect(resolution.refused).toEqual(['file:///etc/passwd']);
  });

  it('refuses a scheme that is not a file, which an editor drag can carry', () => {
    expect(drop('untitled:Untitled-1').intent).toBe('ignore');
    expect(drop('https://example.test/x').intent).toBe('ignore');
  });

  it('is not fooled by a sibling folder with the same prefix', () => {
    expect(drop('file:///home/dev/project-other/secret.ts').intent).toBe('ignore');
  });

  it('takes several files in the order they were dropped, without repeating one', () => {
    const resolution = drop(
      [
        'file:///home/dev/project/a.ts',
        'file:///home/dev/project/b.ts',
        'file:///home/dev/project/a.ts',
      ].join('\n'),
    );

    expect(resolution.paths).toEqual(['a.ts', 'b.ts']);
  });

  it('skips the comment lines a uri-list is allowed to carry', () => {
    expect(drop('# a comment\nfile:///home/dev/project/a.ts').paths).toEqual(['a.ts']);
  });

  it('does nothing at all for an empty drag', () => {
    expect(drop('   ').intent).toBe('ignore');
  });
});

describe('dropInsertion', () => {
  it('writes a mention in the syntax the composer already parses', () => {
    expect(dropInsertion(drop('file:///home/dev/project/src/app.ts'))).toBe('@src/app.ts');
  });

  it('writes the bare path when Shift asked for the reference', () => {
    expect(dropInsertion(drop('file:///home/dev/project/src/app.ts', true))).toBe('src/app.ts');
  });

  it('writes nothing for a drop that resolved to nothing', () => {
    expect(dropInsertion(drop('file:///etc/passwd'))).toBe('');
  });
});
