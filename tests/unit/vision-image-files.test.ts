import { mkdirSync, mkdtempSync, rmSync, symlinkSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';

import { afterEach, describe, expect, it } from 'vitest';

import { readOperatorImage, readWorkspaceImage } from '../../src/sdk/vision-image-files';
import { VISION_MAX_IMAGE_BYTES } from '../../src/sdk/vision-tool.constants';
import { jpegWithMetadata, pngChunk, redRectanglePng } from '../helpers/png-fixture';

const created: string[] = [];

afterEach(() => {
  for (const directory of created.splice(0)) rmSync(directory, { force: true, recursive: true });
});

function workspace(): string {
  const made = mkdtempSync(path.join(tmpdir(), 'claw-vision-ws-'));
  created.push(made);
  return made;
}

function put(root: string, name: string, bytes: Buffer | string): void {
  const target = path.join(root, name);
  mkdirSync(path.dirname(target), { recursive: true });
  writeFileSync(target, bytes);
}

describe('readWorkspaceImage', () => {
  it('reads a png inside the workspace and strips its metadata', () => {
    const root = workspace();
    put(root, 'shots/home.png', redRectanglePng([pngChunk('tEXt', Buffer.from('a\0/home/ihab'))]));
    const image = readWorkspaceImage(root, 'shots/home.png');
    expect(image.mimeType).toBe('image/png');
    expect(image.filename).toBe('home.png');
    expect(image.stripped).toBe(true);
    expect(image.bytes.toString('latin1')).not.toContain('/home/ihab');
  });

  it('reads a jpeg whose extension is .jpeg', () => {
    const root = workspace();
    put(root, 'a.jpeg', jpegWithMetadata().bytes);
    expect(readWorkspaceImage(root, 'a.jpeg').mimeType).toBe('image/jpeg');
  });

  it('refuses a path that leaves the workspace', () => {
    const root = workspace();
    const outside = workspace();
    put(outside, 'x.png', redRectanglePng());
    const escape = path.relative(root, path.join(outside, 'x.png'));
    expect(() => readWorkspaceImage(root, escape)).toThrow(/escapes the workspace/u);
    expect(() => readWorkspaceImage(root, path.join(outside, 'x.png'))).toThrow(
      /escapes the workspace/u,
    );
  });

  it('refuses a symbolic link, which is how an image outside would be reached', () => {
    const root = workspace();
    const outside = workspace();
    put(outside, 'x.png', redRectanglePng());
    try {
      symlinkSync(path.join(outside, 'x.png'), path.join(root, 'link.png'));
    } catch {
      return; // Creating links needs a privilege some Windows accounts lack.
    }
    expect(() => readWorkspaceImage(root, 'link.png')).toThrow(/symbolic link/u);
  });

  it.each([
    '.env.png',
    'config/secrets.png',
    'private-key.png',
    'api-key-screenshot.png',
    '.ssh/a.png',
  ])('refuses %s because the name looks like it holds secrets', (name) => {
    const root = workspace();
    put(root, name, redRectanglePng());
    expect(() => readWorkspaceImage(root, name)).toThrow(/holds secrets/u);
  });

  it('refuses a type that is not png, jpeg or webp, and says which are', () => {
    const root = workspace();
    put(root, 'a.gif', 'GIF89a');
    put(root, 'b.svg', '<svg/>');
    expect(() => readWorkspaceImage(root, 'a.gif')).toThrow(/not a supported image/u);
    expect(() => readWorkspaceImage(root, 'b.svg')).toThrow(/\.png, \.jpg, \.jpeg, \.webp/u);
  });

  it('refuses a file that only has an image name', () => {
    const root = workspace();
    put(root, 'fake.png', 'this is just text, not an image');
    expect(() => readWorkspaceImage(root, 'fake.png')).toThrow(/does not match/u);
  });

  it('refuses a jpeg renamed to .png', () => {
    const root = workspace();
    put(root, 'wrong.png', jpegWithMetadata().bytes);
    expect(() => readWorkspaceImage(root, 'wrong.png')).toThrow(/image\/jpeg content/u);
  });

  it('refuses an image over 8 MB before reading it', () => {
    const root = workspace();
    put(root, 'big.png', Buffer.concat([redRectanglePng(), Buffer.alloc(VISION_MAX_IMAGE_BYTES)]));
    expect(() => readWorkspaceImage(root, 'big.png')).toThrow(/limit is 8388608/u);
  });

  it('names a missing file, an empty file and a directory plainly', () => {
    const root = workspace();
    put(root, 'empty.png', Buffer.alloc(0));
    mkdirSync(path.join(root, 'dir.png'));
    expect(() => readWorkspaceImage(root, 'nope.png')).toThrow(/does not exist/u);
    expect(() => readWorkspaceImage(root, 'empty.png')).toThrow(/is empty/u);
    expect(() => readWorkspaceImage(root, 'dir.png')).toThrow(/not a file/u);
  });
});

describe('readOperatorImage', () => {
  it('reads an image from anywhere the operator names', () => {
    const root = workspace();
    put(root, 'shot.png', redRectanglePng());
    expect(readOperatorImage(path.join(root, 'shot.png')).mimeType).toBe('image/png');
  });

  it('screens the file name only, so a folder called secrets does not block a plain name', () => {
    const root = workspace();
    put(root, 'secrets-run/shot.png', redRectanglePng());
    put(root, '.env.png', redRectanglePng());
    expect(readOperatorImage(path.join(root, 'secrets-run', 'shot.png')).filename).toBe('shot.png');
    expect(() => readOperatorImage(path.join(root, '.env.png'))).toThrow(/holds secrets/u);
  });
});
