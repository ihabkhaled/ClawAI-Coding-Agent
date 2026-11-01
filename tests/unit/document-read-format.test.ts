import { describe, expect, it } from 'vitest';

import {
  documentFormatOf,
  unreadableMediaKind,
  unreadableMediaMessage,
  unreadableReadMessage,
} from '../../src/core/document-read-format';

describe('documentFormatOf', () => {
  it.each([
    ['a.pdf', 'pdf'],
    ['dir/Plan.DOCX', 'docx'],
    [String.raw`C:\work\sales.xlsx`, 'xlsx'],
    ['deck.pptx', 'pptx'],
    ['memo.rtf', 'rtf'],
  ])('reads %s as %s', (path, format) => {
    expect(documentFormatOf(path)).toBe(format);
  });

  it.each(['notes.txt', 'archive.docx.zip', 'docx', 'pdf', 'dir.pdf/readme', ''])(
    'does not claim %s',
    (path) => {
      expect(documentFormatOf(path)).toBeUndefined();
    },
  );
});

describe('unreadableMediaKind', () => {
  it.each([
    ['logo.PNG', 'image'],
    ['a/b/photo.jpeg', 'image'],
    ['song.flac', 'audio'],
    ['clip.mov', 'video'],
  ])('calls %s %s', (path, kind) => {
    expect(unreadableMediaKind(path)).toBe(kind);
  });

  it.each(['icon.svg', 'README.md', 'data.bin', 'png', ''])('leaves %s alone', (path) => {
    expect(unreadableMediaKind(path)).toBeUndefined();
  });
});

describe('unreadableMediaMessage', () => {
  it('names the file, its kind and what to do', () => {
    expect(unreadableMediaMessage('a.mp3', 'audio')).toContain('an audio file');
    expect(unreadableMediaMessage('a.mp3', 'audio')).toContain('cannot be read here');
    expect(unreadableMediaMessage('a.mp4', 'video')).toContain('can watch it');
    expect(unreadableMediaMessage('a.mp4', 'video')).not.toContain('vision.describe');
  });

  it('points a png, jpeg or webp at vision.describe with the exact path', () => {
    const message = unreadableMediaMessage('shots/a b.PNG', 'image');
    expect(message).toContain('Call vision.describe with {"path": "shots/a b.PNG"');
    expect(message).toContain('attach the image');
  });

  it('keeps a precise attach message for an image vision.describe cannot take', () => {
    const message = unreadableMediaMessage('anim.gif', 'image');
    expect(message).toContain('only takes png, jpeg or webp');
    expect(message).toContain('attach it');
    expect(message).not.toContain('Call vision.describe');
  });
});

describe('unreadableReadMessage', () => {
  it('names the media kind when it knows it', () => {
    expect(unreadableReadMessage('a.png')).toContain('an image file');
  });

  it('keeps the plain message for any other binary file', () => {
    expect(unreadableReadMessage('data.bin')).toBe('data.bin is not UTF-8 text and cannot be read');
  });
});
