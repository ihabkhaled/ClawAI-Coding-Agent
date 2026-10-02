import { readFileSync, realpathSync, statSync, type Stats } from 'node:fs';
import path from 'node:path';

import { containedPath } from '../core/workspace-containment';
import { isSensitiveWorkspacePath } from '../core/workspace-path-policy';

import { sniffImageType, withoutMetadata } from './vision-image';
import { VISION_EXTENSION_TYPES, VISION_MAX_IMAGE_BYTES } from './vision-tool.constants';

import type { VisionImage } from './vision-tool.types';

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
  if (isSensitiveWorkspacePath(relative)) {
    throw new Error(
      `Refused: "${relative}" looks like it holds secrets. Screenshots of credential files are never sent to a model.`,
    );
  }
  return readImageFile(absolute, relative);
}

/**
 * An image the operator named with `--image` or `images`: any readable path.
 * The operator chose it, so only its own file name is screened for secrets.
 */
export function readOperatorImage(absolute: string): VisionImage {
  const name = path.basename(absolute);
  if (isSensitiveWorkspacePath(name)) {
    throw new Error(
      `Refused: "${name}" looks like it holds secrets. Rename the file if it is safe to send.`,
    );
  }
  return readImageFile(absolute, name);
}

function readImageFile(absolute: string, shown: string): VisionImage {
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
  const clean = withoutMetadata(bytes, actual);
  return {
    bytes: clean,
    mimeType: actual,
    filename: path.basename(absolute),
    stripped: clean.length !== bytes.length,
  };
}

function statOrFail(absolute: string, shown: string): Stats {
  try {
    return statSync(absolute);
  } catch {
    throw new Error(`"${shown}" does not exist.`);
  }
}
