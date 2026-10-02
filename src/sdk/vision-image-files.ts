import { readFileSync, realpathSync, statSync, type Stats } from 'node:fs';
import path from 'node:path';

import { containedPath } from '../core/workspace-containment';
import { isSensitiveWorkspacePath } from '../core/workspace-path-policy';

import { declaredSize, sniffImageType, withoutMetadata } from './vision-image';
import {
  VISION_EXTENSION_TYPES,
  VISION_MAX_IMAGE_BYTES,
  VISION_MAX_SIDE_PIXELS,
  VISION_MAX_TOTAL_PIXELS,
} from './vision-tool.constants';

import type { VisionImage, VisionMimeType } from './vision-tool.types';

const EXTENSIONS = Object.keys(VISION_EXTENSION_TYPES).join(', ');

/**
 * An image the model named, read from inside the workspace.
 *
 * The path must stay in the workspace (links are not followed) and must not
 * look like a secret: a screenshot of an `.env` file is the same leak as the
 * file. Both refusals say why, so the model does not try the same path twice.
 */
export function readWorkspaceImage(workspace: string, requested: string): VisionImage {
  const absolute = containedPath(workspace, requested);
  const relative = path.relative(realpathSync(workspace), absolute).split(path.sep).join('/');
  if (looksSecret(relative)) {
    throw new Error(
      `Refused: "${relative}" looks like it holds secrets. Screenshots of credential files are never sent to a model.`,
    );
  }
  return readImageFile(absolute, relative, true);
}

/** Whether the path, or the path without its image extension (`id_rsa.png` is a picture of `id_rsa`), names a secret. */
function looksSecret(relative: string): boolean {
  return (
    isSensitiveWorkspacePath(relative) ||
    isSensitiveWorkspacePath(relative.slice(0, relative.length - path.extname(relative).length))
  );
}

/**
 * An image the operator named with `--image` or `images`: any readable path.
 * The operator chose it, so only its own file name is screened for secrets.
 */
export function readOperatorImage(absolute: string): VisionImage {
  const name = path.basename(absolute);
  if (looksSecret(name)) {
    throw new Error(
      `Refused: "${name}" looks like it holds secrets. Rename the file if it is safe to send.`,
    );
  }
  return readImageFile(absolute, name, false);
}

function readImageFile(absolute: string, shown: string, anonymous: boolean): VisionImage {
  const extension = path.extname(absolute).toLowerCase();
  const expected = VISION_EXTENSION_TYPES[extension];
  if (expected === undefined) {
    throw new Error(`"${shown}" is not a supported image. Use ${EXTENSIONS}.`);
  }
  const stats = statOrFail(absolute, shown);
  if (!stats.isFile()) throw new Error(`"${shown}" is not a file.`);
  if (stats.size === 0) throw new Error(`"${shown}" is empty.`);
  if (stats.size > VISION_MAX_IMAGE_BYTES) {
    throw new Error(
      `"${shown}" is ${String(stats.size)} bytes; the limit is ${String(VISION_MAX_IMAGE_BYTES)} (8 MB). Take a smaller screenshot.`,
    );
  }
  const bytes = readFileSync(absolute);
  const actual = sniffImageType(bytes);
  if (actual === undefined) {
    throw new Error(
      `"${shown}" is not a real png, jpeg or webp image (its content does not match).`,
    );
  }
  if (actual !== expected) {
    throw new Error(`"${shown}" has a ${extension} name but ${actual} content. Rename it.`);
  }
  assertReasonableSize(bytes, actual, shown);
  const clean = withoutMetadata(bytes, actual);
  return {
    bytes: clean,
    mimeType: actual,
    filename: anonymous ? anonymousName(extension) : path.basename(absolute),
    stripped: clean.length !== bytes.length,
  };
}

/** The name sent for an image the model chose: only its type, since a file name can carry a person, a project or a secret. */
function anonymousName(extension: string): string {
  return `image${extension === '.jpeg' ? '.jpg' : extension}`;
}

/** Refuses a file whose header declares a picture too big to decode safely. */
function assertReasonableSize(bytes: Buffer, type: VisionMimeType, shown: string): void {
  const size = declaredSize(bytes, type);
  if (size === undefined) return;
  if (
    size.width > VISION_MAX_SIDE_PIXELS ||
    size.height > VISION_MAX_SIDE_PIXELS ||
    size.width * size.height > VISION_MAX_TOTAL_PIXELS
  ) {
    throw new Error(
      `"${shown}" declares ${String(size.width)}x${String(size.height)} pixels, more than a screenshot can be; it is refused as a possible decompression bomb.`,
    );
  }
}

function statOrFail(absolute: string, shown: string): Stats {
  try {
    return statSync(absolute);
  } catch {
    throw new Error(`"${shown}" does not exist.`);
  }
}
